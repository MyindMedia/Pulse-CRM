import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { settlePayment } from "./payments";
import { r2Env, setupStudios, clientEmails } from "./testing/sessionDelivery.fixture";

/* R-02: settlePayment as it behaves today, with no session delivery on the
   booking. Pinned before the delivery trigger was added. */

describe("settlePayment (pinned behavior)", () => {
  let s: Awaited<ReturnType<typeof setupStudios>>;
  beforeEach(async () => { r2Env(); s = await setupStudios(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("R-02 a deposit on an unpaid booking records the deposit, confirms a tentative booking and emails the client once", async () => {
    const id = s.A.otherSessionId;
    await s.t.run(async (ctx) => { await ctx.db.patch(id, { status: "tentative", holdExpiresAt: Date.now() + 3_600_000 }); });
    const res = await s.t.run(async (ctx) => await settlePayment(ctx, { sessionId: id, kind: "deposit" }));
    expect(res).toMatchObject({ paidTotal: 10000, fullyPaid: false, balance: 10000 });
    const row = await s.t.run(async (ctx) => await ctx.db.get(id));
    expect(row).toMatchObject({ amountPaidCents: 10000, depositPaid: true, status: "confirmed" });
    expect(row!.holdExpiresAt).toBeUndefined();
    const mails = await clientEmails(s.t, id);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ subject: "Deposit received - Mix review", kind: "payment.deposit", recipient: "jordan.ellis@example.com" });
    const payments = await s.t.run(async (ctx) => await ctx.db.query("payments").withIndex("by_session", (q) => q.eq("sessionId", id)).take(10));
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ kind: "deposit", amountCents: 10000, provider: "simulated", status: "paid" });
  });

  it("R-02 a balance payment pays the booking in full and emails the client once, and the team is alerted", async () => {
    const id = s.A.sessionId;
    const res = await s.t.run(async (ctx) => await settlePayment(ctx, { sessionId: id, kind: "balance", provider: "stripe", reference: "pi_123" }));
    expect(res).toMatchObject({ paidTotal: 36000, fullyPaid: true, balance: 0 });
    const row = await s.t.run(async (ctx) => await ctx.db.get(id));
    expect(row!.amountPaidCents).toBe(36000);
    const mails = await clientEmails(s.t, id);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ subject: "Paid in full - Vocal tracking", kind: "payment.full" });
    const team = await s.t.run(async (ctx) =>
      (await ctx.db.query("notifications").withIndex("by_session", (q) => q.eq("sessionId", id)).take(20)).filter((n) => n.kind === "payment.received"),
    );
    expect(team).toHaveLength(1);
    expect(team[0].recipient).toBe("owner@studio-a.example.com");
  });

  it("R-02 settling a fully paid booking throws", async () => {
    const id = s.A.sessionId;
    await s.t.run(async (ctx) => { await ctx.db.patch(id, { amountPaidCents: 36000 }); });
    await expect(s.t.run(async (ctx) => await settlePayment(ctx, { sessionId: id, kind: "balance" }))).rejects.toThrow(
      "This booking is already paid in full.",
    );
  });

  it("R-02 a cancelled booking throws", async () => {
    const id = s.A.sessionId;
    await s.t.run(async (ctx) => { await ctx.db.patch(id, { status: "cancelled" }); });
    await expect(s.t.run(async (ctx) => await settlePayment(ctx, { sessionId: id, kind: "balance" }))).rejects.toThrow(
      "This booking was released.",
    );
  });
});
