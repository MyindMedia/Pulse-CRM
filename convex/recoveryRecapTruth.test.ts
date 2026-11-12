import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

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
