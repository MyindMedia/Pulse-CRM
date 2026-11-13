import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { refundIdempotencyKey, REFUND_ATTEMPTS, STUCK_AFTER_MS } from "./strayPayments";
import * as stray from "./strayPayments";

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

describe("H206-04: a refund call that errors is retried, and a stuck refund is never silent", () => {
  it("Stripe errors twice then answers: refunded once, every attempt uses the same idempotency key", async () => {
    const t = convexTest(schema);
    const { strayId } = await pendingStray(t);
    fake.replies = [new Error("socket hang up"), new Error("socket hang up"), { id: "re_ok", status: "succeeded" }];
    await t.action(internal.strayPayments.refund, { strayId });
    expect(fake.refundCalls).toHaveLength(3);
    expect(new Set(fake.refundCalls.map((c) => c.opts.idempotencyKey))).toEqual(new Set([refundIdempotencyKey("evt_r2_1")]));
    const [row] = await strays(t);
    expect(row).toMatchObject({ status: "refunded", refundId: "re_ok" });
    expect(await notes(t, "payment.refund_failed")).toHaveLength(0);
  });

  it("Stripe never answers: the row stays refund_pending for the sweep, nobody is told it failed (H206-R2-02)", async () => {
    const t = convexTest(schema);
    const { strayId } = await pendingStray(t);
    fake.replies = [new Error("ECONNRESET")];
    await t.action(internal.strayPayments.refund, { strayId });
    expect(fake.refundCalls).toHaveLength(REFUND_ATTEMPTS);
    const [row] = await strays(t);
    // Round 2 marked this refund_failed and emailed the client "the studio has
    // been asked to refund you", though Stripe may already have refunded.
    expect(row.status).toBe("refund_pending");
    expect(row.refundId).toBeUndefined();
    expect(await notes(t, "payment.refund_failed")).toHaveLength(0);
    // Later the sweep retries with the same key and Stripe answers succeeded.
    await t.run((ctx) => ctx.db.patch(strayId, { createdAt: Date.now() - STUCK_AFTER_MS - 60_000 }));
    fake.replies = [{ id: "re_late", status: "succeeded" }];
    await t.action(internal.strayPayments.sweepStuck, {});
    expect(new Set(fake.refundCalls.map((c) => c.opts.idempotencyKey))).toEqual(new Set([refundIdempotencyKey("evt_r2_1")]));
    expect((await strays(t))[0]).toMatchObject({ status: "refunded", refundId: "re_late" });
    expect((await notes(t, "payment.late_refunded")).some((n) => n.recipient === "nova@r2.test")).toBe(true);
    expect(await notes(t, "payment.refund_failed")).toHaveLength(0);
  });

  it("Stripe never answers and the sweep cannot reach it either: the team is told once to check Stripe, the client is told nothing", async () => {
    const t = convexTest(schema);
    const { strayId } = await pendingStray(t);
    fake.replies = [new Error("ECONNRESET")];
    await t.action(internal.strayPayments.refund, { strayId });
    await t.run((ctx) => ctx.db.patch(strayId, { createdAt: Date.now() - STUCK_AFTER_MS - 60_000 }));
    await t.action(internal.strayPayments.sweepStuck, {});
    expect((await strays(t))[0].status).toBe("refund_pending");
    const stuck = await notes(t, "payment.refund_stuck");
    expect(stuck.length).toBeGreaterThan(0);
    expect(stuck.every((n) => n.recipient !== "nova@r2.test")).toBe(true);
    expect(stuck[0].body).toContain("if no refund shows, refund it by hand");
    expect((await t.run((ctx) => ctx.db.query("notifications").collect())).filter((n) => n.recipient === "nova@r2.test")).toHaveLength(0);
  });

  it("a Stripe refusal (status failed) is not retried and says refund by hand", async () => {
    const t = convexTest(schema);
    const { strayId } = await pendingStray(t);
    fake.replies = [{ id: "re_f", status: "failed" }];
    await t.action(internal.strayPayments.refund, { strayId });
    expect(fake.refundCalls).toHaveLength(1);
    const [row] = await strays(t);
    expect(row).toMatchObject({ status: "refund_failed", refundId: "re_f" });
    const team = (await notes(t, "payment.refund_failed")).find((n) => n.recipient !== "nova@r2.test");
    expect(team?.body).toContain("Refund it by hand");
  });

  it("a row left refund_pending by a dead action is refunded by the sweep with the same key", async () => {
    const t = convexTest(schema);
    const { strayId } = await pendingStray(t);
    await t.run((ctx) => ctx.db.patch(strayId, { createdAt: Date.now() - STUCK_AFTER_MS - 60_000 }));
    fake.replies = [{ id: "re_sw", status: "succeeded" }];
    await t.action(internal.strayPayments.sweepStuck, {});
    expect(fake.refundCalls).toHaveLength(1);
    expect(fake.refundCalls[0].opts.idempotencyKey).toBe(refundIdempotencyKey("evt_r2_1"));
    expect((await strays(t))[0]).toMatchObject({ status: "refunded", refundId: "re_sw" });
  });

  it("the sweep leaves a fresh row alone", async () => {
    const t = convexTest(schema);
    await pendingStray(t);
    await t.action(internal.strayPayments.sweepStuck, {});
    expect(fake.refundCalls).toHaveLength(0);
    expect((await strays(t))[0].status).toBe("refund_pending");
  });

  it("the sweep cannot reach Stripe: the team is told once, the row is not marked failed, the client gets nothing yet", async () => {
    const t = convexTest(schema);
    const { strayId } = await pendingStray(t);
    await t.run((ctx) => ctx.db.patch(strayId, { createdAt: Date.now() - STUCK_AFTER_MS - 60_000 }));
    fake.replies = [new Error("ETIMEDOUT")];
    await t.action(internal.strayPayments.sweepStuck, {});
    await t.action(internal.strayPayments.sweepStuck, {});
    const [row] = await strays(t);
    expect(row.status).toBe("refund_pending");
    expect(row.staleAlertedAt).toBeDefined();
    const stuck = await notes(t, "payment.refund_stuck");
    expect(stuck.length).toBeGreaterThan(0);
    expect(stuck.every((n) => n.recipient !== "nova@r2.test")).toBe(true);
    const perRecipient = new Set(stuck.map((n) => `${n.channel}:${n.recipient}`));
    expect(perRecipient.size).toBe(stuck.length); // one alert per team member, not one per sweep
    expect(await notes(t, "payment.refund_failed")).toHaveLength(0);
  });
});

describe("H206-05/06: a pending refund is not reported as refunded until Stripe says so", () => {
  it("a 'pending' refund keeps the row refund_pending with the refund id; the team hears it is in progress, the client hears nothing yet", async () => {
    const t = convexTest(schema);
    const { strayId } = await pendingStray(t);
    fake.replies = [{ id: "re_pending", status: "pending" }];
    await t.action(internal.strayPayments.refund, { strayId });
    const [row] = await strays(t);
    expect(row).toMatchObject({ status: "refund_pending", refundId: "re_pending" });
    expect(row.resolvedAt).toBeUndefined();
    const prog = await notes(t, "payment.refund_in_progress");
    expect(prog.length).toBeGreaterThan(0);
    expect(prog.every((n) => n.recipient !== "nova@r2.test")).toBe(true);
    expect(await notes(t, "payment.late_refunded")).toHaveLength(0);
    // Running the action again does not start a second refund.
    await t.action(internal.strayPayments.refund, { strayId });
    expect(fake.refundCalls).toHaveLength(1);
  });

  it("'requires_action' is treated the same as pending", async () => {
    const t = convexTest(schema);
    const { strayId } = await pendingStray(t);
    fake.replies = [{ id: "re_ra", status: "requires_action" }];
    await t.action(internal.strayPayments.refund, { strayId });
    expect((await strays(t))[0]).toMatchObject({ status: "refund_pending", refundId: "re_ra" });
    expect(await notes(t, "payment.late_refunded")).toHaveLength(0);
  });

  it("refund.updated succeeded finishes the row and only then tells the client", async () => {
    const t = convexTest(schema);
    const { strayId } = await pendingStray(t);
    fake.replies = [{ id: "re_pending", status: "pending" }];
    await t.action(internal.strayPayments.refund, { strayId });
    await t.mutation(internal.billingWebhooks.handle, { event: refundEvent(strayId) });
    expect((await strays(t))[0]).toMatchObject({ status: "refunded", refundId: "re_pending" });
    const client = (await notes(t, "payment.late_refunded")).find((n) => n.recipient === "nova@r2.test");
    expect(client?.body).toContain("refunded the $100 in full");
    // A replay does nothing more.
    const again = await t.mutation(internal.billingWebhooks.handle, { event: refundEvent(strayId) });
    expect(again).toEqual({ duplicate: true });
    await t.mutation(internal.billingWebhooks.handle, { event: refundEvent(strayId, { id: "evt_refund_2" }) });
    expect((await notes(t, "payment.late_refunded")).filter((n) => n.recipient === "nova@r2.test")).toHaveLength(1);
  });

  it("refund.failed after pending: the row is refund_failed and the team is told to refund by hand", async () => {
    const t = convexTest(schema);
    const { strayId } = await pendingStray(t);
    fake.replies = [{ id: "re_pending", status: "pending" }];
    await t.action(internal.strayPayments.refund, { strayId });
    await t.mutation(internal.billingWebhooks.handle, {
      event: refundEvent(strayId, { type: "refund.failed", status: "failed" }),
    });
    expect((await strays(t))[0]).toMatchObject({ status: "refund_failed", refundId: "re_pending" });
    const failed = await notes(t, "payment.refund_failed");
    expect(failed.some((n) => n.recipient !== "nova@r2.test" && n.subject.startsWith("Refund failed - refund by hand"))).toBe(true);
    expect(await notes(t, "payment.late_refunded")).toHaveLength(0);
  });

  it("a refund event from another connected account, for another refund, or another payment is ignored", async () => {
    const t = convexTest(schema);
    const { strayId } = await pendingStray(t);
    fake.replies = [{ id: "re_pending", status: "pending" }];
    await t.action(internal.strayPayments.refund, { strayId });
    await t.mutation(internal.billingWebhooks.handle, { event: refundEvent(strayId, { id: "e1", account: "acct_x" }) });
    await t.mutation(internal.billingWebhooks.handle, { event: refundEvent(strayId, { id: "e2", refundId: "re_other" }) });
    await t.mutation(internal.billingWebhooks.handle, { event: refundEvent(strayId, { id: "e3", pi: "pi_other" }) });
    await t.mutation(internal.billingWebhooks.handle, { event: { ...refundEvent(strayId, { id: "e4" }), account: undefined } });
    await t.mutation(internal.billingWebhooks.handle, { event: refundEvent("not-an-id", { id: "e5" }) });
    expect((await strays(t))[0].status).toBe("refund_pending");
    expect(await marks(t)).toEqual(expect.arrayContaining([
      "refund.updated.ignored", "refund.updated.ignored", "refund.updated.ignored", "refund.updated.ignored", "refund.updated.ignored",
    ]));
  });

  it("charge.refund.updated (the older event name) is handled the same way", async () => {
    const t = convexTest(schema);
    const { strayId } = await pendingStray(t);
    fake.replies = [{ id: "re_pending", status: "pending" }];
    await t.action(internal.strayPayments.refund, { strayId });
    await t.mutation(internal.billingWebhooks.handle, { event: refundEvent(strayId, { type: "charge.refund.updated" }) });
    expect((await strays(t))[0].status).toBe("refunded");
  });

  it("with no refund webhook, the sweep asks Stripe about a pending refund and finishes it", async () => {
    const t = convexTest(schema);
    const { strayId } = await pendingStray(t);
    fake.replies = [{ id: "re_pending", status: "pending" }];
    await t.action(internal.strayPayments.refund, { strayId });
    await t.run((ctx) => ctx.db.patch(strayId, { createdAt: Date.now() - STUCK_AFTER_MS - 60_000 }));
    fake.retrieve.re_pending = "succeeded";
    await t.action(internal.strayPayments.sweepStuck, {});
    expect(fake.retrieveCalls).toEqual([{ id: "re_pending", opts: { stripeAccount: ACCT } }]);
    expect(fake.refundCalls).toHaveLength(1); // no new refund created
    expect((await strays(t))[0].status).toBe("refunded");
  });

  it("a refund still pending at the sweep is reported to the team once", async () => {
    const t = convexTest(schema);
    const { strayId } = await pendingStray(t);
    fake.replies = [{ id: "re_pending", status: "pending" }];
    await t.action(internal.strayPayments.refund, { strayId });
    await t.run((ctx) => ctx.db.patch(strayId, { createdAt: Date.now() - STUCK_AFTER_MS - 60_000 }));
    await t.action(internal.strayPayments.sweepStuck, {});
    const first = (await notes(t, "payment.refund_stuck")).length;
    await t.action(internal.strayPayments.sweepStuck, {});
    expect(first).toBeGreaterThan(0);
    expect((await notes(t, "payment.refund_stuck")).length).toBe(first);
    expect((await strays(t))[0].status).toBe("refund_pending");
  });

  it("the new stray-payment functions are internal only", () => {
    for (const fn of [stray._applyOutcome, stray._stuck, stray.sweepStuck, stray._reportStuck]) {
      expect((fn as unknown as { isInternal?: boolean }).isInternal).toBe(true);
    }
  });
});

/* Round 3 (re-review H206-R2-01 to H206-R2-04). */
describe("H206-R2-01: a short-paid booking is never forfeited automatically; staff decide", () => {
  async function shortPaid(t: T, startInHours: number) {
    // $300 booking, $100 deposit paid; the client opened a $200 balance
    // Checkout, then staff added $100 of extras (rate now $400).
    const { sessionId } = await seed(t, {
      rateCents: 40_000, startTime: Date.now() + startInHours * HOUR, endTime: Date.now() + (startInHours + 2) * HOUR,
    });
    await t.mutation(internal.billingWebhooks.handle, {
      event: checkoutEvent({ sessionId, kind: "balance" }, { amount: 20_000 }),
    });
    return sessionId;
  }

  it("the short payment is marked on the booking and the forfeit sweep leaves it confirmed inside 2h of start", async () => {
    const t = convexTest(schema);
    const sessionId = await shortPaid(t, 1);
    const before = await t.run((ctx) => ctx.db.get(sessionId));
    expect(before?.shortPaidAt).toBeDefined();
    await t.mutation(internal.automation.tick, {});
    const s = await t.run((ctx) => ctx.db.get(sessionId));
    expect(s?.status).toBe("confirmed");
    expect(s?.amountPaidCents).toBe(30_000);
    expect(await notes(t, "booking.forfeited")).toHaveLength(0);
  });

  it("the team is told the shortfall and that they decide; the client is not given a deadline Pulse will enforce", async () => {
    const t = convexTest(schema);
    await shortPaid(t, 3);
    const team = (await notes(t, "payment.short")).find((n) => n.recipient !== "nova@r2.test");
    expect(team?.body).toContain("Pulse will not cancel or forfeit this booking automatically");
    const client = (await t.run((ctx) => ctx.db.query("notifications").collect())).find((n) => n.recipient === "nova@r2.test");
    expect(client?.body).toContain("$100 is still due");
    expect(client?.body).not.toMatch(/kept by the studio|2 hours before/);
  });

  it("a short deposit tells the client what is still due, not that the session is held", async () => {
    const t = convexTest(schema);
    const { sessionId } = await seed(t, {
      status: "tentative", holdExpiresAt: Date.now() + HOUR, depositCents: 15_000, depositPaid: false, amountPaidCents: 0,
    });
    await t.mutation(internal.billingWebhooks.handle, { event: checkoutEvent({ sessionId, kind: "deposit" }, { amount: 10_000 }) });
    const client = (await t.run((ctx) => ctx.db.query("notifications").collect())).find((n) => n.recipient === "nova@r2.test");
    expect(client?.body).toContain("is still due");
    expect(client?.body).not.toContain("Your session is held");
    expect((await t.run((ctx) => ctx.db.get(sessionId)))?.shortPaidAt).toBeDefined();
  });

  it("an unpaid confirmed booking that was never short-paid is still forfeited (unchanged)", async () => {
    const t = convexTest(schema);
    const { sessionId } = await seed(t, { startTime: Date.now() + HOUR, endTime: Date.now() + 3 * HOUR });
    await t.mutation(internal.automation.tick, {});
    expect((await t.run((ctx) => ctx.db.get(sessionId)))?.status).toBe("cancelled");
  });

  it("the public checkout query does not return the staff-only shortPaidAt marker", async () => {
    const t = convexTest(schema);
    const sessionId = await shortPaid(t, 3);
    const pub = await t.query(api.booking.booking, { sessionId });
    expect(pub).not.toBeNull();
    expect((pub as Record<string, unknown>).shortPaidAt).toBeUndefined();
  });

  it("an exact payment does not mark the booking short-paid", async () => {
    const t = convexTest(schema);
    const { sessionId } = await seed(t);
    await t.mutation(internal.billingWebhooks.handle, { event: checkoutEvent({ sessionId, kind: "balance" }, { amount: 20_000 }) });
    expect((await t.run((ctx) => ctx.db.get(sessionId)))?.shortPaidAt).toBeUndefined();
  });
});
