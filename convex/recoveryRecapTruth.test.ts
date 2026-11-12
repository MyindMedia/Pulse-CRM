import { describe, it, expect, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { settleInvoice } from "./invoicePay";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* client-messages-recovery-recap: the monthly recap said "Pulse recovered $X
   ... No action needed" while fee invoices were still drafts nobody had sent,
   and it listed waitlist backfills that nothing records. A fee counts once
   its invoice is paid; an unpaid one is listed as waiting. */
const ORG = "recap_org";
const START = Date.UTC(2026, 9, 1);
const END = Date.UTC(2026, 10, 1);

async function seed(t: ReturnType<typeof convexTest>, feeInvoiceStatus: "draft" | "paid") {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: ORG, name: "Recap Studio", slug: "recap", tier: "growth", status: "active", ownerEmail: "owner@r.test" } as never);
    const artistId = await ctx.db.insert("artists", {
      orgId: ORG, name: "Client", type: "artist", genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    const invoiceId = await ctx.db.insert("invoices", {
      orgId: ORG, number: "PLS-1", artistId, status: feeInvoiceStatus,
      lineItems: [{ label: "No-show fee", amountCents: 15_000 }], amountCents: 15_000, dueDate: END,
    } as never);
    const at = START + 86_400_000;
    await ctx.db.insert("recoveryEvents", { orgId: ORG, kind: "deposit_forfeited", amountCents: 5_000, at });
    await ctx.db.insert("recoveryEvents", { orgId: ORG, kind: "no_show_fee", amountCents: 15_000, at, invoiceId });
  });
}

async function recap(t: ReturnType<typeof convexTest>) {
  const res = await t.mutation(internal.recoveryRecap.recapForOrg, { orgId: ORG, periodStart: START, periodEnd: END });
  const mail = await t.run(async (ctx) =>
    (await ctx.db.query("notifications").collect()).find((n) => n.kind === "recovery.recap"),
  );
  return { res, mail };
}

describe("monthly recovery recap", () => {
  it("does not count a fee sitting on a draft invoice as recovered, and says action is needed", async () => {
    const t = convexTest(schema);
    await seed(t, "draft");
    const { mail } = await recap(t);
    expect(mail?.subject).toContain("Pulse recovered $50 ");
    expect(mail?.body).toContain("Not collected yet: $150");
    expect(mail?.body).not.toContain("No action needed");
    expect(mail?.body).not.toMatch(/waitlist/i);
  });

  it("counts the fee once its invoice is paid", async () => {
    const t = convexTest(schema);
    await seed(t, "paid");
    const { mail } = await recap(t);
    expect(mail?.subject).toContain("Pulse recovered $200 ");
    expect(mail?.body).toContain("forfeited deposits and no-show fees");
    expect(mail?.body).toContain("No action needed");
  });
});

/* R05/R06: a fee billed in one month and paid in the next must show up in the
   month it was paid, and a month with only unpaid fees must still send the
   "follow up" prompt. */
describe("monthly recovery recap across months", () => {
  const NOV_END = Date.UTC(2026, 11, 1);
  afterEach(() => { vi.useRealTimers(); });

  async function seedClient(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Recap Studio", slug: "recap", tier: "growth", status: "active", ownerEmail: "owner@r.test" } as never);
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Client", type: "artist", genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const sessionId = await ctx.db.insert("sessions", {
        orgId: ORG, title: "Client - Studio A", artistId, serviceType: "recording",
        startTime: START, endTime: START + 3_600_000, status: "no_show",
        rateCents: 15_000, depositCents: 0, depositPaid: false, intakeCompleted: false,
      });
      return { artistId, sessionId };
    });
  }
  const feeInvoice = (t: ReturnType<typeof convexTest>, artistId: Id<"artists">, sessionId: Id<"sessions">) =>
    t.run((ctx) => ctx.db.insert("invoices", {
      orgId: ORG, number: "PLS-9", artistId, sessionId, status: "draft",
      lineItems: [{ label: "Client - Studio A - no-show fee", amountCents: 15_000 }], amountCents: 15_000, dueDate: END,
    }));
  async function recapFor(t: ReturnType<typeof convexTest>, periodStart: number, periodEnd: number) {
    vi.setSystemTime(periodEnd + 3_600_000);
    await t.mutation(internal.recoveryRecap.recapForOrg, { orgId: ORG, periodStart, periodEnd });
    return t.run(async (ctx) =>
      (await ctx.db.query("notifications").collect()).filter((n) => n.kind === "recovery.recap" && n._creationTime >= periodEnd));
  }

  it("a fee billed in October and paid in November is counted in November", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 28));
    const t = convexTest(schema);
    const { artistId, sessionId } = await seedClient(t);
    const invoiceId = await feeInvoice(t, artistId, sessionId);

    const oct = await recapFor(t, START, END);
    expect(oct).toHaveLength(1);
    expect(oct[0].body).toContain("Not collected yet: $150");

    vi.setSystemTime(Date.UTC(2026, 10, 3));
    // The studio sends the fee invoice; a draft cannot be paid by link (truth-void-invoice-payable).
    await t.run((ctx) => ctx.db.patch(invoiceId, { status: "sent" }));
    await t.run((ctx) => settleInvoice(ctx, invoiceId));

    const nov = await recapFor(t, END, NOV_END);
    expect(nov).toHaveLength(1);
    expect(nov[0].subject).toContain("Pulse recovered $150 ");
    expect(nov[0].body).toContain("No action needed");
  });

  it("a fee logged at billing (before fees were counted on payment) moves to the month it is paid", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 28));
    const t = convexTest(schema);
    const { artistId, sessionId } = await seedClient(t);
    const invoiceId = await feeInvoice(t, artistId, sessionId);
    await t.run((ctx) => ctx.db.insert("recoveryEvents", {
      orgId: ORG, kind: "no_show_fee", amountCents: 15_000, at: Date.now(), sessionId, invoiceId, note: "Client - Studio A - no-show fee",
    }));

    const oct = await recapFor(t, START, END);
    expect(oct[0].body).toContain("Not collected yet: $150");

    vi.setSystemTime(Date.UTC(2026, 10, 10));
    // The studio sends the fee invoice; a draft cannot be paid by link (truth-void-invoice-payable).
    await t.run((ctx) => ctx.db.patch(invoiceId, { status: "sent" }));
    await t.run((ctx) => settleInvoice(ctx, invoiceId));
    const ev = await t.run((ctx) => ctx.db.query("recoveryEvents").collect());
    expect(ev).toHaveLength(1);
    expect(ev[0].at).toBe(Date.UTC(2026, 10, 10));

    const nov = await recapFor(t, END, NOV_END);
    expect(nov[0].subject).toContain("Pulse recovered $150 ");
  });

  it("a month with only unpaid fees still sends the follow-up prompt", async () => {
    const t = convexTest(schema);
    await seed(t, "draft");
    await t.run(async (ctx) => {
      for (const e of await ctx.db.query("recoveryEvents").collect()) {
        if (e.kind === "deposit_forfeited") await ctx.db.delete(e._id);
      }
    });
    const { res, mail } = await recap(t);
    expect(res).toMatchObject({ sent: true });
    expect(mail?.body).toContain("Not collected yet: $150");
    expect(mail?.body).not.toContain("Pulse recovered $0");
  });
});

describe("monthly recovery recap and studio credit", () => {
  it("does not count a fee settled with studio credit (R28/R29)", async () => {
    const t = convexTest(schema);
    await seed(t, "paid");
    await t.run(async (ctx) => {
      for (const inv of await ctx.db.query("invoices").collect()) await ctx.db.patch(inv._id, { paymentMethod: "credit" });
    });
    const { mail } = await recap(t);
    expect(mail?.subject).toContain("Pulse recovered $50 ");
    expect(mail?.body).not.toContain("no-show fees");
  });
});

/* R30/R31: nothing records a waitlist_fill recovery, so the won-back copy
   must not claim resold canceled hours. */
describe("won-back copy claims only what is counted", () => {
  it("does not claim canceled hours it resold", () => {
    const root = join(__dirname, "..");
    for (const f of ["convex/lib/pricing.ts", "src/app/mypulse/features.ts"]) {
      expect(readFileSync(join(root, f), "utf8"), f).not.toMatch(/canceled hours it resold/i);
    }
    expect(readFileSync(join(root, "convex/recoveryRecap.ts"), "utf8")).not.toMatch(/waitlist backfills/i);
  });
});
