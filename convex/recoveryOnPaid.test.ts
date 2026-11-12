import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { settleInvoice } from "./invoicePay";
import { feeKindOf } from "./lib/recoveryOnPaid";

/* Truth audit B3 (money-reporting-money-won-back): "Pulse adds up kept
   deposits, late fees ... and bills paid after a reminder." Bills paid ONLINE
   after a reminder were never counted, and fees counted when billed rather
   than when paid. Every path into "paid" now records once. */

const ORG = "rec_org";

describe("won-back money is recorded when it is paid", () => {
  let t: ReturnType<typeof convexTest>;
  let artistId: Id<"artists">;
  let sessionId: Id<"sessions">;

  beforeEach(async () => {
    vi.useFakeTimers();
    t = convexTest(schema);
    ({ artistId, sessionId } = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Rec", slug: "rec", tier: "growth", status: "active" });
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Nova", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const sessionId = await ctx.db.insert("sessions", {
        orgId: ORG, title: "Nova - Studio A", artistId, serviceType: "recording",
        startTime: Date.now() - 3_600_000, endTime: Date.now(), status: "no_show",
        rateCents: 20_000, depositCents: 0, depositPaid: false, intakeCompleted: false, cancellationFeeCents: 20_000,
      });
      return { artistId, sessionId };
    }));
  });
  afterEach(() => { vi.useRealTimers(); });

  const invoice = (over: Record<string, unknown>) =>
    t.run((ctx) =>
      ctx.db.insert("invoices", {
        orgId: ORG, number: "PLS-1", artistId, status: "sent",
        lineItems: [{ label: "Mixing", amountCents: 40_000 }], amountCents: 40_000, dueDate: Date.now(),
        ...over,
      }));
  const events = () => t.run((ctx) => ctx.db.query("recoveryEvents").collect());

  it("an invoice paid online after a reminder counts as reminder_collected, once", async () => {
    const id = await invoice({ reminderStage: 2 });
    await t.run((ctx) => settleInvoice(ctx, id));
    await t.run((ctx) => settleInvoice(ctx, id)); // webhook retry
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: "reminder_collected", amountCents: 40_000, invoiceId: id });
  });

  it("an invoice paid online without any reminder is not won back", async () => {
    const id = await invoice({});
    await t.run((ctx) => settleInvoice(ctx, id));
    expect(await events()).toHaveLength(0);
  });

  it("a no-show fee paid online counts as no_show_fee", async () => {
    const id = await invoice({
      sessionId, lineItems: [{ label: "Nova - Studio A - no-show fee", amountCents: 20_000 }], amountCents: 20_000,
    });
    await t.run((ctx) => settleInvoice(ctx, id));
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: "no_show_fee", amountCents: 20_000, sessionId, invoiceId: id });
  });

  it("a late-cancel fee charged to a saved card counts as cancellation_fee", async () => {
    const id = await invoice({
      sessionId, status: "draft",
      lineItems: [{ label: "Nova - Studio A - late cancellation fee", amountCents: 8_000 }], amountCents: 8_000,
    });
    await t.mutation(internal.cardOnFile._markFeePaid, { sessionId, invoiceId: id, amountCents: 8_000, reference: "pi_1" });
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: "cancellation_fee", amountCents: 8_000 });
  });

  it("a fee already counted at billing time (before this change) is not counted again", async () => {
    const id = await invoice({
      sessionId, lineItems: [{ label: "Nova - Studio A - no-show fee", amountCents: 20_000 }], amountCents: 20_000,
    });
    await t.run((ctx) =>
      ctx.db.insert("recoveryEvents", { orgId: ORG, kind: "no_show_fee", amountCents: 20_000, at: 1, sessionId, invoiceId: id }));
    await t.run((ctx) => settleInvoice(ctx, id));
    expect(await events()).toHaveLength(1);
  });

  it("recognises only the shield's own fee invoices", () => {
    const sid = sessionId;
    expect(feeKindOf({ sessionId: sid, lineItems: [{ label: "X - no-show fee", amountCents: 1 }] })).toBe("no_show_fee");
    expect(feeKindOf({ sessionId: sid, lineItems: [{ label: "X - late cancellation fee", amountCents: 1 }] })).toBe("cancellation_fee");
    expect(feeKindOf({ sessionId: sid, lineItems: [{ label: "X - balance", amountCents: 1 }] })).toBeNull();
    expect(feeKindOf({ sessionId: undefined, lineItems: [{ label: "X - no-show fee", amountCents: 1 }] })).toBeNull();
  });
});

/* R28/R29: a fee "paid" with studio credit brought no money in (setStatus
   posts an offsetting adjustment), so it is not money won back. */
describe("studio credit is not money won back", () => {
  const DEMO = "pulse-demo"; // the no-identity demo viewer resolves here

  async function seedFee(t: ReturnType<typeof convexTest>, over: Record<string, unknown> = {}) {
    return t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: DEMO, name: "Skyline", slug: "demo", tier: "growth", status: "active" });
      const artistId = await ctx.db.insert("artists", {
        orgId: DEMO, name: "Nova", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const sessionId = await ctx.db.insert("sessions", {
        orgId: DEMO, title: "Nova - Studio A", artistId, serviceType: "recording",
        startTime: Date.now() - 3_600_000, endTime: Date.now(), status: "no_show",
        rateCents: 10_000, depositCents: 0, depositPaid: false, intakeCompleted: false,
      });
      return ctx.db.insert("invoices", {
        orgId: DEMO, number: "PLS-7", artistId, sessionId, status: "sent", dueDate: Date.now(),
        lineItems: [{ label: "Nova - Studio A - late cancellation fee", amountCents: 10_000 }], amountCents: 10_000,
        ...over,
      });
    });
  }

  it("a fee marked paid with studio credit records no recovery event", async () => {
    const t = convexTest(schema);
    const id = await seedFee(t);
    await t.mutation(api.invoices.setStatus, { id, status: "paid", paymentMethod: "credit" });
    expect(await t.run((ctx) => ctx.db.query("recoveryEvents").collect())).toHaveLength(0);
  });

  it("a bill paid with studio credit after a reminder is not reminder_collected", async () => {
    const t = convexTest(schema);
    const id = await seedFee(t, { lineItems: [{ label: "Mixing", amountCents: 10_000 }], reminderStage: 1 });
    await t.mutation(api.invoices.setStatus, { id, status: "paid", paymentMethod: "credit" });
    expect(await t.run((ctx) => ctx.db.query("recoveryEvents").collect())).toHaveLength(0);
  });

  it("the same fee marked paid in cash is counted", async () => {
    const t = convexTest(schema);
    const id = await seedFee(t);
    await t.mutation(api.invoices.setStatus, { id, status: "paid", paymentMethod: "cash" });
    const ev = await t.run((ctx) => ctx.db.query("recoveryEvents").collect());
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: "cancellation_fee", amountCents: 10_000 });
  });
});
