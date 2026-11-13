import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* Round 2 of pull request #206 (bookings and payments): the review findings
   H206-01 to H206-06.
   - H206-01: a Checkout paid after its invoice or booking was deleted was
     dropped silently; a sent invoice could be deleted while its pay link was
     open.
   - H206-02/03: a booking payment was recorded at what Pulse said was owed,
     not what Stripe collected, so a Checkout opened at an older price marked
     the booking paid with money that never arrived.
   - H206-04: a refund call that threw (perhaps after Stripe already refunded)
     was marked failed with no retry; a refund left "refund_pending" by a
     dead action was never looked at again.
   - H206-05/06: a refund Stripe returned as "pending" was recorded as
     refunded and the client told so, and a later failure never surfaced. */

const HOUR = 3_600_000;
const ORG = "org_r2";
const ACCT = "acct_r2";

type RefundReply = { id?: string; status: string } | Error;
const fake: {
  refundCalls: { params: Record<string, unknown>; opts: Record<string, unknown> }[];
  replies: RefundReply[];
  retrieve: Record<string, string>;
  retrieveCalls: { id: string; opts: Record<string, unknown> }[];
} = { refundCalls: [], replies: [], retrieve: {}, retrieveCalls: [] };

vi.mock("./lib/stripe", async (orig) => {
  const real = await orig<typeof import("./lib/stripe")>();
  return {
    ...real,
    stripeClient: () => ({
      checkout: { sessions: { create: async () => ({ id: "cs_x", url: "https://checkout.stripe.test/x" }) } },
      refunds: {
        create: async (params: Record<string, unknown>, opts: Record<string, unknown>) => {
          fake.refundCalls.push({ params, opts });
          const next = fake.replies.length > 1 ? fake.replies.shift()! : fake.replies[0] ?? { status: "succeeded" };
          if (next instanceof Error) throw next;
          return { id: next.id ?? "re_1", status: next.status };
        },
        retrieve: async (id: string, _params: unknown, opts: Record<string, unknown>) => {
          fake.retrieveCalls.push({ id, opts });
          return { id, status: fake.retrieve[id] ?? "pending" };
        },
      },
    }),
  };
});

type T = ReturnType<typeof convexTest>;
const prevKey = process.env.STRIPE_SECRET_KEY;
beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  fake.refundCalls = [];
  fake.replies = [];
  fake.retrieve = {};
  fake.retrieveCalls = [];
});
afterEach(() => {
  if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = prevKey;
});

async function seed(t: T, session: Record<string, unknown> = {}) {
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: ORG, name: "Round Two", slug: "r2", tier: "growth", status: "active",
      ownerEmail: "owner@r2.test", stripeAccountId: ACCT, stripeChargesEnabled: true,
    } as never);
    await ctx.db.insert("orgs", { orgId: "org_x", name: "Other", slug: "other", tier: "growth", status: "active", stripeAccountId: "acct_x" } as never);
    await ctx.db.insert("members", { orgId: ORG, name: "Olive Owner", role: "owner", email: "owner@r2.test", clerkUserId: "u_own", skills: [] } as never);
    await ctx.db.insert("members", { orgId: "org_x", name: "Xavier", role: "owner", email: "x@x.test", clerkUserId: "u_x", skills: [] } as never);
    const artistId = await ctx.db.insert("artists", {
      orgId: ORG, name: "Nova", type: "artist", email: "nova@r2.test",
      genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    const sessionId = await ctx.db.insert("sessions", {
      orgId: ORG, title: "Night Session", artistId, serviceType: "recording", source: "public_booking",
      startTime: Date.now() + 48 * HOUR, endTime: Date.now() + 50 * HOUR,
      status: "confirmed", rateCents: 30_000, depositCents: 10_000, depositPaid: true, amountPaidCents: 10_000,
      intakeCompleted: false,
      ...session,
    } as never);
    return { sessionId: sessionId as Id<"sessions">, artistId };
  });
  const invoice = (status: string) =>
    t.run(async (ctx) => (await ctx.db.insert("invoices", {
      orgId: ORG, number: `PLS-${status}`, artistId: ids.artistId, status, amountCents: 50_000,
      dueDate: Date.now() + 7 * 86_400_000, lineItems: [{ label: "Mixing", amountCents: 50_000 }],
    } as never)) as Id<"invoices">);
  return { ...ids, invoice };
}

function checkoutEvent(meta: Record<string, string>, over: { id?: string; account?: string; pi?: string; amount?: number | null } = {}) {
  return {
    id: over.id ?? "evt_r2_1",
    type: "checkout.session.completed",
    account: over.account ?? ACCT,
    data: {
      object: {
        id: "cs_r2_1",
        metadata: meta,
        payment_intent: over.pi ?? "pi_r2_1",
        ...(over.amount === null ? {} : { amount_total: over.amount ?? 20_000 }),
      },
    },
  };
}

function refundEvent(strayId: string, over: { id?: string; account?: string; refundId?: string; status?: string; type?: string; pi?: string } = {}) {
  return {
    id: over.id ?? "evt_refund_1",
    type: over.type ?? "refund.updated",
    account: over.account ?? ACCT,
    data: {
      object: {
        object: "refund",
        id: over.refundId ?? "re_pending",
        status: over.status ?? "succeeded",
        payment_intent: over.pi ?? "pi_r2_1",
        metadata: { pulseStrayPaymentId: strayId },
      },
    },
  };
}

const strays = (t: T) => t.run((ctx) => ctx.db.query("strayPayments").collect());
const notes = (t: T, kind: string) =>
  t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.kind === kind));
const marks = (t: T) => t.run(async (ctx) => (await ctx.db.query("stripeEvents").collect()).map((m) => m.type));

/** A released booking paid late: one stray row waiting for its refund. */
async function pendingStray(t: T) {
  const { sessionId } = await seed(t, { status: "cancelled", amountPaidCents: 0, depositPaid: false });
  await t.mutation(internal.billingWebhooks.handle, {
    event: checkoutEvent({ sessionId, kind: "deposit" }, { amount: 10_000 }),
  });
  const [row] = await strays(t);
  expect(row.status).toBe("refund_pending");
  // Each test runs the refund itself: cancel the one the webhook scheduled so
  // it cannot race the test (or stand in for a refund action that died).
  await t.run(async (ctx) => {
    for (const f of await ctx.db.system.query("_scheduled_functions").collect()) {
      if (f.name.includes("strayPayments") && f.state.kind === "pending") await ctx.scheduler.cancel(f._id);
    }
  });
  return { sessionId, strayId: row._id };
}

describe("H206-01: a payment on a deleted invoice or booking is never dropped", () => {
  it("a Checkout paid after its invoice was deleted is recorded for the studio to review", async () => {
    const t = convexTest(schema);
    const { invoice } = await seed(t);
    // A sent invoice the studio deleted while the client had its pay link open
    // (before this fix a sent invoice could be deleted).
    const invId = await invoice("sent");
    await t.run((ctx) => ctx.db.delete(invId));
    await t.mutation(internal.billingWebhooks.handle, { event: checkoutEvent({ invoiceId: invId }, { amount: 50_000 }) });
    const rows = await strays(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orgId: ORG, reason: "unmatched", status: "needs_review", amountCents: 50_000, paymentIntent: "pi_r2_1" });
    expect(rows[0].note).toContain("invoice it paid for was deleted");
    expect(await marks(t)).toEqual(["checkout.session.completed.deleted_invoice"]);
    const alerts = await notes(t, "payment.needs_review");
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.every((n) => n.orgId === ORG && n.recipient !== "nova@r2.test")).toBe(true);
    expect(alerts[0].body).toContain("was deleted");
    expect(fake.refundCalls).toHaveLength(0); // review, not an automatic refund
  });

  it("a Checkout paid after its booking was deleted is recorded for the studio to review", async () => {
    const t = convexTest(schema);
    const { sessionId } = await seed(t);
    await t.run((ctx) => ctx.db.delete(sessionId));
    await t.mutation(internal.billingWebhooks.handle, { event: checkoutEvent({ sessionId, kind: "balance" }) });
    const [row] = await strays(t);
    expect(row).toMatchObject({ orgId: ORG, reason: "unmatched", status: "needs_review", amountCents: 20_000 });
    expect(row.note).toContain("booking it paid for was deleted");
    expect(await marks(t)).toEqual(["checkout.session.completed.deleted_booking"]);
  });

  it("a replay of that event records nothing twice", async () => {
    const t = convexTest(schema);
    const { sessionId } = await seed(t);
    await t.run((ctx) => ctx.db.delete(sessionId));
    await t.mutation(internal.billingWebhooks.handle, { event: checkoutEvent({ sessionId, kind: "balance" }) });
    const again = await t.mutation(internal.billingWebhooks.handle, { event: checkoutEvent({ sessionId, kind: "balance" }) });
    expect(again).toEqual({ duplicate: true });
    await t.mutation(internal.billingWebhooks.handle, { event: checkoutEvent({ sessionId, kind: "balance" }, { id: "evt_r2_other" }) });
    expect(await strays(t)).toHaveLength(1);
  });

  it("a deleted row with an account no studio owns, or no account, stays account_mismatch and records nothing", async () => {
    const t = convexTest(schema);
    const { sessionId } = await seed(t);
    await t.run((ctx) => ctx.db.delete(sessionId));
    await t.mutation(internal.billingWebhooks.handle, { event: checkoutEvent({ sessionId }, { account: "acct_nobody" }) });
    await t.mutation(internal.billingWebhooks.handle, { event: { ...checkoutEvent({ sessionId }, { id: "evt_noacct" }), account: undefined } });
    expect(await strays(t)).toHaveLength(0);
    expect(await marks(t)).toEqual([
      "checkout.session.completed.account_mismatch",
      "checkout.session.completed.account_mismatch",
    ]);
  });

  it("the stray row goes to the studio that owns the paying account, never to another studio", async () => {
    const t = convexTest(schema);
    const { sessionId } = await seed(t);
    await t.run((ctx) => ctx.db.delete(sessionId));
    await t.mutation(internal.billingWebhooks.handle, { event: checkoutEvent({ sessionId }, { account: "acct_x" }) });
    const [row] = await strays(t);
    expect(row.orgId).toBe("org_x");
    expect(row.stripeAccountId).toBe("acct_x");
  });

  it("a sent, viewed or overdue invoice cannot be deleted (void it instead); draft, void and paid still can", async () => {
    const t = convexTest(schema);
    const { invoice } = await seed(t);
    const ids: Record<string, Id<"invoices">> = {};
    for (const s of ["sent", "viewed", "overdue", "draft", "void", "paid"]) {
      ids[s] = await invoice(s);
    }
    const owner = t.withIdentity({ subject: "u_own", name: "Olive" });
    for (const s of ["sent", "viewed", "overdue"]) {
      await expect(owner.mutation(api.invoices.remove, { id: ids[s] })).rejects.toThrow(/Void it instead/);
      expect(await t.run((ctx) => ctx.db.get(ids[s]))).not.toBeNull();
    }
    for (const s of ["draft", "void", "paid"]) {
      await owner.mutation(api.invoices.remove, { id: ids[s] });
      expect(await t.run((ctx) => ctx.db.get(ids[s]))).toBeNull();
    }
  });

  it("another studio cannot delete this studio's invoice", async () => {
    const t = convexTest(schema);
    const { invoice } = await seed(t);
    const id = await invoice("draft");
    const other = t.withIdentity({ subject: "u_x", name: "Xavier" });
    await expect(other.mutation(api.invoices.remove, { id })).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.get(id))).not.toBeNull();
  });
});

describe("H206-02/03: a booking payment records what Stripe collected, never more", () => {
  it("a balance Checkout opened at an older price: only the money that arrived is recorded, the rest stays due, the team is told", async () => {
    const t = convexTest(schema);
    // $300 booking, $100 deposit paid; the client opened a $200 balance
    // Checkout, then staff added $100 of extras (rate now $400).
    const { sessionId } = await seed(t, { rateCents: 40_000 });
    await t.mutation(internal.billingWebhooks.handle, {
      event: checkoutEvent({ sessionId, kind: "balance" }, { amount: 20_000 }),
    });
    const s = await t.run((ctx) => ctx.db.get(sessionId));
    expect(s?.amountPaidCents).toBe(30_000);
    const pays = await t.run(async (ctx) => (await ctx.db.query("payments").collect()).filter((p) => p.sessionId === sessionId));
    expect(pays).toHaveLength(1);
    expect(pays[0].amountCents).toBe(20_000);
    const short = await notes(t, "payment.short");
    expect(short.length).toBeGreaterThan(0);
    expect(short.every((n) => n.recipient !== "nova@r2.test")).toBe(true);
    expect(short[0].body).toContain("$100 remains due");
    // The client is not told they are paid in full.
    const full = await notes(t, "payment.full");
    expect(full).toHaveLength(0);
    const client = (await t.run((ctx) => ctx.db.query("notifications").collect())).find((n) => n.recipient === "nova@r2.test");
    expect(client?.body).toContain("$100 is still due");
    expect(client?.body).not.toContain("fully paid");
    expect(await strays(t)).toHaveLength(0);
  });

  it("a full-price Checkout on a tentative hold that was repriced upward does not confirm on a deposit shortfall", async () => {
    const t = convexTest(schema);
    // Deposit went from $100 to $150 after the client opened a $100 deposit Checkout.
    const { sessionId } = await seed(t, {
      status: "tentative", holdExpiresAt: Date.now() + HOUR, depositCents: 15_000, depositPaid: false, amountPaidCents: 0,
    });
    await t.mutation(internal.billingWebhooks.handle, {
      event: checkoutEvent({ sessionId, kind: "deposit" }, { amount: 10_000 }),
    });
    const s = await t.run((ctx) => ctx.db.get(sessionId));
    expect(s?.amountPaidCents).toBe(10_000);
    expect(s?.status).toBe("tentative");
    expect(s?.depositPaid).toBe(false);
    expect((await notes(t, "payment.short")).length).toBeGreaterThan(0);
  });

  it("an exact payment records the full amount with no shortfall alert (unchanged)", async () => {
    const t = convexTest(schema);
    const { sessionId } = await seed(t);
    await t.mutation(internal.billingWebhooks.handle, { event: checkoutEvent({ sessionId, kind: "balance" }, { amount: 20_000 }) });
    const s = await t.run((ctx) => ctx.db.get(sessionId));
    expect(s?.amountPaidCents).toBe(30_000);
    expect(await notes(t, "payment.short")).toHaveLength(0);
    expect((await notes(t, "payment.full")).length).toBe(1);
  });

  it("an overpayment still records only what was owed and flags the extra (unchanged)", async () => {
    const t = convexTest(schema);
    const { sessionId } = await seed(t);
    await t.mutation(internal.billingWebhooks.handle, { event: checkoutEvent({ sessionId, kind: "full" }, { amount: 30_000 }) });
    const s = await t.run((ctx) => ctx.db.get(sessionId));
    expect(s?.amountPaidCents).toBe(30_000);
    const [row] = await strays(t);
    expect(row).toMatchObject({ reason: "unmatched", amountCents: 10_000, status: "needs_review" });
  });

  it("a Stripe event with no amount_total keeps the old behavior (applies what is owed)", async () => {
    const t = convexTest(schema);
    const { sessionId } = await seed(t);
    await t.mutation(internal.billingWebhooks.handle, { event: checkoutEvent({ sessionId, kind: "balance" }, { amount: null }) });
    expect((await t.run((ctx) => ctx.db.get(sessionId)))?.amountPaidCents).toBe(30_000);
  });

  it("a zero collected amount records no payment and flags it for review", async () => {
    const t = convexTest(schema);
    const { sessionId } = await seed(t);
    await t.mutation(internal.billingWebhooks.handle, { event: checkoutEvent({ sessionId, kind: "balance" }, { amount: 0 }) });
    expect((await t.run((ctx) => ctx.db.get(sessionId)))?.amountPaidCents).toBe(10_000);
    const [row] = await strays(t);
    expect(row).toMatchObject({ reason: "unmatched", status: "needs_review" });
  });

  it("the staff 'record payment' path (no Stripe amount) is unchanged", async () => {
    const t = convexTest(schema);
    const { sessionId } = await seed(t);
    const owner = t.withIdentity({ subject: "u_own", name: "Olive" });
    await owner.mutation(api.payments.record, { sessionId, kind: "balance" });
    expect((await t.run((ctx) => ctx.db.get(sessionId)))?.amountPaidCents).toBe(30_000);
  });
});

describe("same class (invoice side): an invoice is marked paid only when Stripe collected its amount", () => {
  it("a short invoice payment leaves the invoice open and goes to the studio to review", async () => {
    const t = convexTest(schema);
    const { invoice } = await seed(t);
    const id = await invoice("sent");
    await t.mutation(internal.billingWebhooks.handle, { event: checkoutEvent({ invoiceId: id }, { amount: 30_000 }) });
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("sent");
    const [row] = await strays(t);
    expect(row).toMatchObject({ reason: "unmatched", status: "needs_review", invoiceId: id, amountCents: 30_000 });
    expect(row.note).toContain("not marked paid");
    expect(fake.refundCalls).toHaveLength(0);
  });

  it("an exact invoice payment settles it with no stray row (unchanged)", async () => {
    const t = convexTest(schema);
    const { invoice } = await seed(t);
    const id = await invoice("sent");
    await t.mutation(internal.billingWebhooks.handle, { event: checkoutEvent({ invoiceId: id }, { amount: 50_000 }) });
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("paid");
    expect(await strays(t)).toHaveLength(0);
  });

  it("an invoice overpayment settles it and flags the extra", async () => {
    const t = convexTest(schema);
    const { invoice } = await seed(t);
    const id = await invoice("overdue");
    await t.mutation(internal.billingWebhooks.handle, { event: checkoutEvent({ invoiceId: id }, { amount: 55_000 }) });
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("paid");
    const [row] = await strays(t);
    expect(row).toMatchObject({ reason: "unmatched", status: "needs_review", amountCents: 5_000 });
  });
});
