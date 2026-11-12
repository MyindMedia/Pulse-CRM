import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { refundIdempotencyKey } from "./strayPayments";
import * as stray from "./strayPayments";
import * as booking from "./booking";

/* truth-paid-after-release: a client could finish paying in a Stripe Checkout
   tab after their hold was released. The webhook swallowed the error, so the
   studio kept money for nothing and nobody was told. Now the Checkout closes
   with the hold, a released booking cannot start a Checkout, and a payment
   that still lands on a released booking is refunded in full on the studio's
   connected account, once, with the client and the team told. */

const HOUR = 3_600_000;
const ORG = "org_late";
const ACCT = "acct_studio_late";

const fake: {
  creates: { params: Record<string, unknown>; opts: Record<string, unknown> }[];
  refunds: { params: Record<string, unknown>; opts: Record<string, unknown> }[];
  refundError: Error | null;
  refundKeys: Set<string>;
} = { creates: [], refunds: [], refundError: null, refundKeys: new Set() };

vi.mock("./lib/stripe", async (orig) => {
  const real = await orig<typeof import("./lib/stripe")>();
  return {
    ...real,
    stripeClient: () => ({
      checkout: {
        sessions: {
          create: async (params: Record<string, unknown>, opts: Record<string, unknown>) => {
            fake.creates.push({ params, opts });
            return { id: `cs_${fake.creates.length}`, url: `https://checkout.stripe.test/${fake.creates.length}` };
          },
        },
      },
      refunds: {
        create: async (params: Record<string, unknown>, opts: Record<string, unknown>) => {
          if (fake.refundError) throw fake.refundError;
          // Stripe dedupes on the idempotency key: a repeat returns the same refund.
          const key = String(opts.idempotencyKey);
          if (!fake.refundKeys.has(key)) {
            fake.refundKeys.add(key);
            fake.refunds.push({ params, opts });
          }
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
  fake.refundError = null;
  fake.refundKeys = new Set();
});
afterEach(() => {
  if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = prevKey;
});

async function seed(t: T, session: Record<string, unknown> = {}) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: ORG, name: "Late Studio", slug: "late", tier: "growth", status: "active",
      ownerEmail: "owner@late.test", stripeAccountId: ACCT, stripeChargesEnabled: true,
    } as never);
    await ctx.db.insert("orgs", {
      orgId: "org_other", name: "Other", slug: "other", tier: "growth", status: "active",
      stripeAccountId: "acct_other", stripeChargesEnabled: true,
    } as never);
    await ctx.db.insert("members", { orgId: ORG, name: "Olive Owner", role: "owner", email: "owner@late.test", clerkUserId: "u_own", skills: [] } as never);
    const artistId = await ctx.db.insert("artists", {
      orgId: ORG, name: "Nova", type: "artist", email: "nova@late.test",
      genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    return (await ctx.db.insert("sessions", {
      orgId: ORG, title: "Night Session", artistId, serviceType: "recording", source: "public_booking",
      startTime: Date.now() + 48 * HOUR, endTime: Date.now() + 50 * HOUR,
      status: "tentative", holdExpiresAt: Date.now() + 50 * 60 * 1000,
      rateCents: 20_000, depositCents: 6_000, depositPaid: false, intakeCompleted: false,
      ...session,
    } as never)) as Id<"sessions">;
  });
}

function paidEvent(sessionId: string, over: { id?: string; account?: string; pi?: string | null; kind?: string; amount?: number } = {}) {
  return {
    id: over.id ?? "evt_late_1",
    type: "checkout.session.completed",
    account: over.account ?? ACCT,
    data: {
      object: {
        id: "cs_late_1",
        metadata: { sessionId, kind: over.kind ?? "deposit" },
        ...(over.pi === null ? {} : { payment_intent: over.pi ?? "pi_late_1" }),
        amount_total: over.amount ?? 6_000,
      },
    },
  };
}

const strays = (t: T) => t.run((ctx) => ctx.db.query("strayPayments").collect());
const payments = (t: T, sessionId: Id<"sessions">) =>
  t.run(async (ctx) => (await ctx.db.query("payments").collect()).filter((p) => p.sessionId === sessionId));
const scheduledRefunds = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) => f.name.includes("strayPayments")),
  );
const notesOfKind = (t: T, kind: string) =>
  t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.kind === kind));

async function runRefunds(t: T) {
  for (const s of await strays(t)) await t.action(internal.strayPayments.refund, { strayId: s._id });
}

describe("Checkout for a held booking closes with the hold", () => {
  it("U-01: expires_at equals the hold's end when more than 30 minutes remain", async () => {
    const t = convexTest(schema);
    const id = await seed(t);
    const hold = (await t.run((ctx) => ctx.db.get(id)))!.holdExpiresAt!;
    const res = await t.action(api.booking.payViaStripe, { sessionId: id, kind: "deposit" });
    expect(res.url).toContain("checkout.stripe.test");
    expect(fake.creates).toHaveLength(1);
    expect(fake.creates[0].params.expires_at).toBe(Math.floor(hold / 1000));
    expect(fake.creates[0].opts.stripeAccount).toBe(ACCT);
    expect((await t.run((ctx) => ctx.db.get(id)))!.holdExpiresAt).toBe(hold);
  });

  it("U-01: with under 31 minutes left the hold is extended to cover Stripe's 30-minute minimum", async () => {
    const t = convexTest(schema);
    const id = await seed(t, { holdExpiresAt: Date.now() + 10 * 60 * 1000 });
    const before = Date.now();
    await t.action(api.booking.payViaStripe, { sessionId: id, kind: "deposit" });
    const hold = (await t.run((ctx) => ctx.db.get(id)))!.holdExpiresAt!;
    expect(hold).toBeGreaterThanOrEqual(before + 31 * 60 * 1000);
    expect(fake.creates[0].params.expires_at).toBe(Math.floor(hold / 1000));
    expect((fake.creates[0].params.expires_at as number) * 1000).toBeGreaterThan(Date.now() + 30 * 60 * 1000);
  });

  it("a hold already past its end (not yet swept) cannot start a Checkout and is not revived", async () => {
    const t = convexTest(schema);
    const past = Date.now() - 60_000;
    const id = await seed(t, { holdExpiresAt: past });
    await expect(t.action(api.booking.payViaStripe, { sessionId: id, kind: "deposit" })).rejects.toThrow(/expired/);
    expect(fake.creates).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(id)))!.holdExpiresAt).toBe(past);
  });

  it("U-02: payViaStripe refuses a cancelled booking with no Stripe call", async () => {
    const t = convexTest(schema);
    const id = await seed(t, { status: "cancelled" });
    await expect(t.action(api.booking.payViaStripe, { sessionId: id, kind: "deposit" })).rejects.toThrow(/released/);
    await expect(t.action(api.booking.payViaStripe, { sessionId: id, kind: "full" })).rejects.toThrow(/released/);
    expect(fake.creates).toHaveLength(0);
  });

  it("a confirmed booking's balance Checkout is unchanged (no hold, no expiry set)", async () => {
    const t = convexTest(schema);
    const id = await seed(t, { status: "confirmed", holdExpiresAt: undefined, depositPaid: true, amountPaidCents: 6_000 });
    await t.action(api.booking.payViaStripe, { sessionId: id, kind: "balance" });
    expect(fake.creates[0].params.expires_at).toBeUndefined();
    expect((fake.creates[0].params.line_items as { price_data: { unit_amount: number } }[])[0].price_data.unit_amount).toBe(14_000);
  });
});

describe("a payment that lands on a released booking is refunded", () => {
  it("U-03: a normal payment inside the hold still confirms the booking", async () => {
    const t = convexTest(schema);
    const id = await seed(t);
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id) });
    const s = await t.run((ctx) => ctx.db.get(id));
    expect(s?.status).toBe("confirmed");
    expect(await payments(t, id)).toHaveLength(1);
    expect(await strays(t)).toHaveLength(0);
    expect(await scheduledRefunds(t)).toHaveLength(0);
  });

  it("U-04: a payment after release schedules exactly one refund and records no booking payment", async () => {
    const t = convexTest(schema);
    const id = await seed(t, { status: "cancelled" });
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id) });
    const rows = await strays(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reason: "released_booking", sessionId: id, paymentIntent: "pi_late_1",
      stripeAccountId: ACCT, amountCents: 6_000, status: "refund_pending",
    });
    expect(await scheduledRefunds(t)).toHaveLength(1);
    expect(await payments(t, id)).toHaveLength(0);
    const s = await t.run((ctx) => ctx.db.get(id));
    expect(s?.status).toBe("cancelled");
    expect(s?.amountPaidCents ?? 0).toBe(0);
  });

  it("U-05: a replayed webhook (same event, or the same payment on a new event) does not refund twice", async () => {
    const t = convexTest(schema);
    const id = await seed(t, { status: "cancelled" });
    const first = await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id) });
    const again = await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id) });
    expect(first).toEqual({ ok: true });
    expect(again).toEqual({ duplicate: true });
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id, { id: "evt_late_other" }) });
    expect(await strays(t)).toHaveLength(1);
    expect(await scheduledRefunds(t)).toHaveLength(1);
    await runRefunds(t);
    await runRefunds(t); // the action itself run twice
    expect(fake.refunds).toHaveLength(1);
    expect(fake.refunds[0].opts.idempotencyKey).toBe(refundIdempotencyKey("evt_late_1"));
  });

  it("U-06: the refund goes to the studio's own connected account, for that payment", async () => {
    const t = convexTest(schema);
    const id = await seed(t, { status: "cancelled" });
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id) });
    await runRefunds(t);
    expect(fake.refunds).toHaveLength(1);
    expect(fake.refunds[0].opts.stripeAccount).toBe(ACCT);
    expect(fake.refunds[0].params.payment_intent).toBe("pi_late_1");
    expect(fake.refunds[0].params.amount).toBeUndefined(); // in full
    const [row] = await strays(t);
    expect(row.status).toBe("refunded");
    expect(row.refundId).toBe("re_1");
  });

  it("U-07: an event from another studio's connected account is ignored, nothing refunded", async () => {
    const t = convexTest(schema);
    const id = await seed(t, { status: "cancelled" });
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id, { account: "acct_other" }) });
    await t.mutation(internal.billingWebhooks.handle, { event: { ...paidEvent(id, { id: "evt_noacct" }), account: undefined } });
    expect(await strays(t)).toHaveLength(0);
    expect(await scheduledRefunds(t)).toHaveLength(0);
    const marks = await t.run((ctx) => ctx.db.query("stripeEvents").collect());
    expect(marks.map((m) => m.type)).toEqual([
      "checkout.session.completed.account_mismatch",
      "checkout.session.completed.account_mismatch",
    ]);
  });

  it("U-08: after the refund the client gets a refund email and the team an alert", async () => {
    const t = convexTest(schema);
    const id = await seed(t, { status: "cancelled" });
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id) });
    await runRefunds(t);
    const notes = await notesOfKind(t, "payment.late_refunded");
    const client = notes.find((n) => n.recipient === "nova@late.test");
    expect(client?.body).toContain("refunded the $60 in full");
    expect(client?.sessionId).toBe(id);
    const team = notes.filter((n) => n.recipient !== "nova@late.test");
    expect(team.length).toBeGreaterThan(0);
    expect(team[0].body).toContain("refunded it in full");
    const act = await t.run((ctx) => ctx.db.query("activity").collect());
    expect(act.map((a) => a.kind)).toEqual(expect.arrayContaining(["payment.refund_started", "payment.refunded"]));
  });

  it("U-09: a second payment on a booking already paid in full alerts the team and is not refunded automatically", async () => {
    const t = convexTest(schema);
    const id = await seed(t, { status: "confirmed", holdExpiresAt: undefined, depositPaid: true, amountPaidCents: 20_000 });
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id, { kind: "full", amount: 20_000, pi: "pi_dup" }) });
    const [row] = await strays(t);
    expect(row).toMatchObject({ reason: "unmatched", status: "needs_review", paymentIntent: "pi_dup", amountCents: 20_000 });
    expect(row.note).toContain("already paid in full");
    expect(await scheduledRefunds(t)).toHaveLength(0);
    const alerts = await notesOfKind(t, "payment.needs_review");
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.every((n) => n.recipient !== "nova@late.test")).toBe(true);
    expect(alerts[0].body).toContain("pi_dup");
    expect(await payments(t, id)).toHaveLength(0);
  });

  it("U-12 (webhook side): two deposit Checkouts paid for one hold - the second counts toward the balance, nothing is lost", async () => {
    const t = convexTest(schema);
    const id = await seed(t);
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id, { id: "evt_a", pi: "pi_a" }) });
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id, { id: "evt_b", pi: "pi_b" }) });
    const s = await t.run((ctx) => ctx.db.get(id));
    expect(s?.status).toBe("confirmed");
    expect(s?.amountPaidCents).toBe(12_000);
    expect(await payments(t, id)).toHaveLength(2);
    expect(await strays(t)).toHaveLength(0);
  });

  it("a stale full-price Checkout paid after the deposit: the extra the client paid is flagged for the studio", async () => {
    const t = convexTest(schema);
    const id = await seed(t);
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id, { id: "evt_dep", pi: "pi_dep" }) });
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id, { id: "evt_full", pi: "pi_full", kind: "full", amount: 20_000 }) });
    const s = await t.run((ctx) => ctx.db.get(id));
    expect(s?.amountPaidCents).toBe(20_000);
    const [row] = await strays(t);
    expect(row).toMatchObject({ reason: "unmatched", status: "needs_review", paymentIntent: "pi_full", amountCents: 6_000 });
    expect(await scheduledRefunds(t)).toHaveLength(0);
    expect((await notesOfKind(t, "payment.needs_review")).length).toBeGreaterThan(0);
  });

  it("U-10: a failed refund is recorded and the team is told to refund by hand", async () => {
    const t = convexTest(schema);
    const id = await seed(t, { status: "cancelled" });
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id) });
    fake.refundError = new Error("Your card's balance is insufficient");
    await runRefunds(t);
    const [row] = await strays(t);
    expect(row.status).toBe("refund_failed");
    expect(row.error).toContain("insufficient");
    const failed = await notesOfKind(t, "payment.refund_failed");
    expect(failed.some((n) => n.recipient !== "nova@late.test" && n.subject.startsWith("Refund failed - refund by hand"))).toBe(true);
    expect(failed.some((n) => n.recipient === "nova@late.test" && n.body.includes("asked to refund you"))).toBe(true);
    // A retry of the action after the failure does not suddenly refund or re-alert.
    fake.refundError = null;
    await runRefunds(t);
    expect(fake.refunds).toHaveLength(0);
    expect((await notesOfKind(t, "payment.refund_failed")).length).toBe(failed.length);
  });

  it("a payment with no payment id cannot be refunded automatically: recorded as failed, team told", async () => {
    const t = convexTest(schema);
    const id = await seed(t, { status: "cancelled" });
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id, { pi: null }) });
    const [row] = await strays(t);
    expect(row.status).toBe("refund_failed");
    expect(await scheduledRefunds(t)).toHaveLength(0);
    expect((await notesOfKind(t, "payment.refund_failed")).length).toBeGreaterThan(0);
  });

  it("the refund action does nothing for a row that is not waiting for a refund", async () => {
    const t = convexTest(schema);
    const id = await seed(t, { status: "confirmed", holdExpiresAt: undefined, amountPaidCents: 20_000, depositPaid: true });
    await t.mutation(internal.billingWebhooks.handle, { event: paidEvent(id, { kind: "full" }) });
    await runRefunds(t);
    expect(fake.refunds).toHaveLength(0);
  });

  it("the stray-payment functions are internal only (no client can call them)", () => {
    for (const fn of [stray.refund, stray._finishRefund, stray._get, booking._extendHoldForCheckout]) {
      expect((fn as unknown as { isInternal?: boolean }).isInternal).toBe(true);
    }
  });
});
