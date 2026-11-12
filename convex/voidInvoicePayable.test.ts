import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { refundIdempotencyKey } from "./strayPayments";

/* truth-void-invoice-payable: the public pay link opened a real Stripe
   Checkout for a cancelled (void) or unsent (draft) invoice, and the webhook
   then flipped the cancelled invoice to "paid". Now only a sent, viewed or
   overdue invoice opens Checkout; money that still lands on a void or draft
   invoice is refunded in full and the invoice keeps its status. */

const ORG = "org_inv";
const ACCT = "acct_inv";

const fake: {
  creates: { params: Record<string, unknown>; opts: Record<string, unknown> }[];
  refunds: { params: Record<string, unknown>; opts: Record<string, unknown> }[];
} = { creates: [], refunds: [] };

vi.mock("./lib/stripe", async (orig) => {
  const real = await orig<typeof import("./lib/stripe")>();
  return {
    ...real,
    stripeClient: () => ({
      checkout: {
        sessions: {
          create: async (params: Record<string, unknown>, opts: Record<string, unknown>) => {
            fake.creates.push({ params, opts });
            return { id: "cs_inv", url: "https://checkout.stripe.test/inv" };
          },
        },
      },
      refunds: {
        create: async (params: Record<string, unknown>, opts: Record<string, unknown>) => {
          fake.refunds.push({ params, opts });
          return { id: `re_${fake.refunds.length}`, status: "succeeded" };
        },
      },
    }),
  };
});

type T = ReturnType<typeof convexTest>;
const prevKey = process.env.STRIPE_SECRET_KEY;
beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  fake.creates = [];
  fake.refunds = [];
});
afterEach(() => {
  if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = prevKey;
});

type Status = "draft" | "sent" | "viewed" | "paid" | "overdue" | "void";

async function seed(t: T, status: Status, over: Record<string, unknown> = {}) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: ORG, name: "Skyline", slug: "skyline", tier: "growth", status: "active",
      ownerEmail: "owner@inv.test", stripeAccountId: ACCT, stripeChargesEnabled: true,
    } as never);
    await ctx.db.insert("orgs", { orgId: "org_x", name: "Other", slug: "other", tier: "growth", status: "active", stripeAccountId: "acct_x" } as never);
    await ctx.db.insert("members", { orgId: ORG, name: "Olive Owner", role: "owner", email: "owner@inv.test", clerkUserId: "u_own", skills: [] } as never);
    const artistId = await ctx.db.insert("artists", {
      orgId: ORG, name: "Nova", type: "artist", email: "nova@inv.test",
      genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    return (await ctx.db.insert("invoices", {
      orgId: ORG, number: "PLS-200", artistId, status, amountCents: 50_000,
      dueDate: Date.now() + 7 * 86_400_000, lineItems: [{ label: "Mixing", amountCents: 50_000 }],
      ...over,
    } as never)) as Id<"invoices">;
  });
}

function paidEvent(invoiceId: string, over: { id?: string; account?: string } = {}) {
  return {
    id: over.id ?? "evt_inv_1",
    type: "checkout.session.completed",
    account: over.account ?? ACCT,
    data: { object: { id: "cs_inv", metadata: { invoiceId }, payment_intent: "pi_inv_1", amount_total: 50_000 } },
  };
}

const strays = (t: T) => t.run((ctx) => ctx.db.query("strayPayments").collect());
const inv = (t: T, id: Id<"invoices">) => t.run((ctx) => ctx.db.get(id));
const notes = (t: T) => t.run((ctx) => ctx.db.query("notifications").collect());
const scheduledRefunds = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) => f.name.includes("strayPayments")),
  );

describe("which invoices open Checkout", () => {
  it("U-01: sent, viewed and overdue invoices still open Checkout on the studio's account", async () => {
    for (const [status, extra] of [["sent", {}], ["viewed", {}], ["overdue", {}], ["sent", { dueDate: Date.now() - 86_400_000 }]] as const) {
      const t = convexTest(schema);
      const id = await seed(t, status, extra);
      const res = await t.action(api.invoicePay.payViaStripe, { invoiceId: id });
      expect(res.url).toBe("https://checkout.stripe.test/inv");
    }
    expect(fake.creates).toHaveLength(4);
    expect(fake.creates.every((c) => c.opts.stripeAccount === ACCT)).toBe(true);
  });

  it("U-02: a void invoice returns no URL and makes no Stripe call", async () => {
    const t = convexTest(schema);
    const id = await seed(t, "void");
    expect(await t.action(api.invoicePay.payViaStripe, { invoiceId: id })).toEqual({ url: null });
    expect(fake.creates).toHaveLength(0);
  });

  it("U-03: a draft invoice returns no URL (decision 1a)", async () => {
    const t = convexTest(schema);
    const id = await seed(t, "draft");
    expect(await t.action(api.invoicePay.payViaStripe, { invoiceId: id })).toEqual({ url: null });
    expect(fake.creates).toHaveLength(0);
  });

  it("U-04: a paid invoice is still refused", async () => {
    const t = convexTest(schema);
    const id = await seed(t, "paid");
    expect(await t.action(api.invoicePay.payViaStripe, { invoiceId: id })).toEqual({ url: null });
    expect(fake.creates).toHaveLength(0);
  });

  it("U-08 (backend): a malformed or other-table id is 'not found', not a server error", async () => {
    const t = convexTest(schema);
    await seed(t, "sent");
    const otherTable = await t.run(async (ctx) => (await ctx.db.query("artists").first())!._id);
    for (const bad of ["not-an-id", otherTable as string]) {
      expect(await t.query(api.invoicePay.get, { invoiceId: bad })).toBeNull();
      await expect(t.action(api.invoicePay.payViaStripe, { invoiceId: bad })).rejects.toThrow(/Invoice not found/);
    }
    expect(fake.creates).toHaveLength(0);
  });

  it("the public query tells the page whether the invoice is open, and shows void and draft as such", async () => {
    const t = convexTest(schema);
    const v = await seed(t, "void");
    expect(await t.query(api.invoicePay.get, { invoiceId: v })).toMatchObject({ status: "void", open: false });
    const t2 = convexTest(schema);
    const d = await seed(t2, "draft");
    expect(await t2.query(api.invoicePay.get, { invoiceId: d })).toMatchObject({ status: "draft", open: false });
    const t3 = convexTest(schema);
    const s = await seed(t3, "sent");
    expect(await t3.query(api.invoicePay.get, { invoiceId: s })).toMatchObject({ status: "sent", open: true });
  });
});

describe("money that lands on a cancelled or unsent invoice", () => {
  it("U-05: a void invoice stays void, the team is alerted and one refund is scheduled", async () => {
    const t = convexTest(schema);
    const id = await seed(t, "void");
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id) });
    const i = await inv(t, id);
    expect(i?.status).toBe("void");
    expect(i?.paidAt).toBeUndefined();
    const [row] = await strays(t);
    expect(row).toMatchObject({ reason: "void_invoice", invoiceId: id, paymentIntent: "pi_inv_1", stripeAccountId: ACCT, amountCents: 50_000, status: "refund_pending" });
    expect(await scheduledRefunds(t)).toHaveLength(1);
    expect((await notes(t)).some((n) => n.kind === "invoice.paid")).toBe(false);

    await t.action(internal.strayPayments.refund, { strayId: row._id });
    expect(fake.refunds).toHaveLength(1);
    expect(fake.refunds[0].opts).toMatchObject({ stripeAccount: ACCT, idempotencyKey: refundIdempotencyKey("evt_inv_1") });
    expect(fake.refunds[0].params.payment_intent).toBe("pi_inv_1");
    const all = await notes(t);
    const client = all.find((n) => n.kind === "payment.late_refunded" && n.recipient === "nova@inv.test");
    expect(client?.body).toContain("Invoice PLS-200 was cancelled");
    expect(client?.body).toContain("You do not owe anything on it");
    expect(all.some((n) => n.kind === "payment.late_refunded" && n.recipient !== "nova@inv.test")).toBe(true);
    expect((await inv(t, id))?.status).toBe("void");
  });

  it("a draft invoice paid by an old link stays a draft and is refunded", async () => {
    const t = convexTest(schema);
    const id = await seed(t, "draft");
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id) });
    expect((await inv(t, id))?.status).toBe("draft");
    const [row] = await strays(t);
    expect(row).toMatchObject({ reason: "draft_invoice", status: "refund_pending" });
    await t.action(internal.strayPayments.refund, { strayId: row._id });
    expect(fake.refunds).toHaveLength(1);
  });

  it("U-06: a replayed webhook does nothing twice", async () => {
    const t = convexTest(schema);
    const id = await seed(t, "void");
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id) });
    expect(await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id) })).toEqual({ duplicate: true });
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id, { id: "evt_inv_retry" }) });
    expect(await strays(t)).toHaveLength(1);
    expect(await scheduledRefunds(t)).toHaveLength(1);
    const startedActs = await t.run(async (ctx) => (await ctx.db.query("activity").collect()).filter((a) => a.kind === "payment.refund_started"));
    expect(startedActs).toHaveLength(1);
    const [row] = await strays(t);
    await t.action(internal.strayPayments.refund, { strayId: row._id });
    await t.action(internal.strayPayments.refund, { strayId: row._id });
    expect(fake.refunds).toHaveLength(1);
  });

  it("U-07: another studio's connected account is refused and the invoice is untouched", async () => {
    const t = convexTest(schema);
    const id = await seed(t, "sent");
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id, { account: "acct_x" }) });
    expect((await inv(t, id))?.status).toBe("sent");
    expect(await strays(t)).toHaveLength(0);
    const marks = await t.run((ctx) => ctx.db.query("stripeEvents").collect());
    expect(marks[0].type).toBe("checkout.session.completed.account_mismatch");
  });

  it("must not break: a sent invoice paid by link is marked paid with receipt and team alert", async () => {
    const t = convexTest(schema);
    const id = await seed(t, "sent");
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id) });
    const i = await inv(t, id);
    expect(i?.status).toBe("paid");
    expect(i?.paymentMethod).toBe("card");
    expect(await strays(t)).toHaveLength(0);
    const n = await notes(t);
    expect(n.some((x) => x.kind === "invoice.paid" && x.recipient === "nova@inv.test")).toBe(true);
  });

  it("a second online payment on an already paid invoice is flagged for the studio, not dropped", async () => {
    const t = convexTest(schema);
    const id = await seed(t, "paid", { paidAt: 1, paymentMethod: "cash" });
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id) });
    expect((await inv(t, id))?.paymentMethod).toBe("cash");
    const [row] = await strays(t);
    expect(row).toMatchObject({ reason: "unmatched", status: "needs_review" });
    expect(await scheduledRefunds(t)).toHaveLength(0);
    expect((await notes(t)).some((n) => n.kind === "payment.needs_review")).toBe(true);
  });

  it("settleInvoice itself never marks a void or draft invoice paid", async () => {
    const { settleInvoice } = await import("./invoicePay");
    for (const status of ["void", "draft"] as const) {
      const t = convexTest(schema);
      const id = await seed(t, status);
      expect(await t.run((ctx) => settleInvoice(ctx, id))).toBe(status);
      expect((await inv(t, id))?.status).toBe(status);
    }
  });

  it("U-13: the no-show fee auto-charge still settles a draft fee invoice", async () => {
    const t = convexTest(schema);
    const id = await seed(t, "draft", { lineItems: [{ label: "Nova - no-show fee", amountCents: 50_000 }] });
    const sessionId = await t.run(async (ctx) => {
      const artistId = (await ctx.db.query("artists").first())!._id;
      return ctx.db.insert("sessions", {
        orgId: ORG, title: "Missed", artistId, serviceType: "recording", startTime: 1, endTime: 2,
        status: "no_show", rateCents: 100_000, depositCents: 0, depositPaid: false, intakeCompleted: false,
      } as never);
    });
    await t.mutation(internal.cardOnFile._markFeePaid, { sessionId, invoiceId: id, amountCents: 50_000, reference: "pi_fee" });
    const i = await inv(t, id);
    expect(i?.status).toBe("paid");
    expect(i?.paymentMethod).toBe("card");
  });
});
