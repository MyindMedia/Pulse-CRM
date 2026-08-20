import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { payoutForSession, payoutTotals } from "./lib/payoutMath";
import type { Id } from "./_generated/dataModel";

/* The studio owes the engineer something the moment a session ends. These
   tests pin two rules: the arithmetic is explainable, and nothing pays itself. */

const OWNER = "u_own";
const HOUR = 3_600_000;

describe("payout math (pure)", () => {
  it("commission takes a percentage of the session rate", () => {
    const r = payoutForSession({ payType: "commission", commissionPct: 40, sessionRateCents: 50_000 })!;
    expect(r.basis).toBe("commission");
    expect(r.amountCents).toBe(20_000);
    expect(r.explanation).toBe("40% of the $500.00 session rate");
  });

  it("points multiply the org's point value", () => {
    const r = payoutForSession({
      payType: "points", pointsPerSession: 3, pointValueCents: 5_000, sessionRateCents: 50_000,
    })!;
    expect(r.amountCents).toBe(15_000);
    expect(r.explanation).toBe("3 points at $50.00 each");
  });

  it("hourly uses clocked hours, not session length", () => {
    const r = payoutForSession({
      payType: "hourly", payRateCents: 4_000, hours: 3.5, sessionRateCents: 50_000,
    })!;
    expect(r.amountCents).toBe(14_000);
    expect(r.explanation).toBe("3.5 hours at $40.00/hr");
  });

  it("never pays a session cut on top of a salary", () => {
    // Salary is already covered by payroll; paying again is the expensive
    // direction to get this wrong.
    expect(payoutForSession({ payType: "salary", payRateCents: 6_000_000, sessionRateCents: 50_000 })).toBeNull();
  });

  it("returns nothing rather than zero when nobody configured a basis", () => {
    // A zero payout row reads as "we owe you nothing", which is a different
    // and wrong claim from "nobody set this up".
    expect(payoutForSession({ sessionRateCents: 50_000 })).toBeNull();
    expect(payoutForSession({ payType: "commission", commissionPct: 0, sessionRateCents: 50_000 })).toBeNull();
    expect(payoutForSession({ payType: "points", pointsPerSession: 2, sessionRateCents: 50_000 })).toBeNull();
  });

  it("clamps a nonsense commission percentage", () => {
    const r = payoutForSession({ payType: "commission", commissionPct: 500, sessionRateCents: 10_000 })!;
    expect(r.amountCents).toBe(10_000);
  });

  it("totals split committed money from money already out", () => {
    const t = payoutTotals([
      { amountCents: 1000, status: "queued" },
      { amountCents: 2000, status: "approved" },
      { amountCents: 4000, status: "paid" },
      { amountCents: 9999, status: "void" },
    ]);
    expect(t).toEqual({ queuedCents: 1000, approvedCents: 2000, paidCents: 4000, owedCents: 3000 });
  });
});

async function studio(t: ReturnType<typeof convexTest>, opts: { auto?: boolean } = {}) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: "org1", name: "V", slug: "v", plan: "studio", tier: "pro", status: "active",
      autoPayouts: opts.auto ?? true, pointValueCents: 5_000,
    });
    await ctx.db.insert("members", {
      orgId: "org1", name: "Owner", role: "owner", skills: [], clerkUserId: OWNER,
    });
    const eng = await ctx.db.insert("members", {
      orgId: "org1", name: "Nia", role: "engineer", skills: [],
      payType: "commission", commissionPct: 40,
    });
    const artist = await ctx.db.insert("artists", {
      orgId: "org1", name: "Ari", type: "artist", genres: [], tags: [],
      status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    const room = await ctx.db.insert("rooms", {
      orgId: "org1", name: "A", hourlyRateCents: 10_000, status: "available",
    });
    return { eng, artist, room };
  });
}

async function makeSession(
  t: ReturnType<typeof convexTest>,
  ids: { eng: Id<"members">; artist: Id<"artists">; room: Id<"rooms"> },
) {
  const now = Date.now();
  return await t.run((ctx) =>
    ctx.db.insert("sessions", {
      orgId: "org1", title: "Ari - A", artistId: ids.artist, roomId: ids.room,
      serviceType: "recording", startTime: now - 4 * HOUR, endTime: now,
      status: "confirmed", rateCents: 50_000, depositCents: 25_000,
      depositPaid: true, amountPaidCents: 50_000, intakeCompleted: true,
      engineerId: ids.eng,
    }),
  );
}

describe("queueing", () => {
  it("queues the engineer's cut when a session completes", async () => {
    const t = convexTest(schema);
    const ids = await studio(t);
    const sessionId = await makeSession(t, ids);
    const asOwner = t.withIdentity({ subject: OWNER, orgId: "org1" });

    await asOwner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });

    const { items, totals } = await asOwner.query(api.payouts.list, {});
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      basis: "commission", amountCents: 20_000, status: "queued", memberName: "Nia",
    });
    expect(items[0].explanation).toContain("40%");
    expect(totals.owedCents).toBe(20_000);
  });

  it("does not queue twice if a session is completed again", async () => {
    const t = convexTest(schema);
    const ids = await studio(t);
    const sessionId = await makeSession(t, ids);
    const asOwner = t.withIdentity({ subject: OWNER, orgId: "org1" });
    await asOwner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    await asOwner.mutation(api.sessions.setStatus, { id: sessionId, status: "confirmed" });
    await asOwner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    const { items } = await asOwner.query(api.payouts.list, {});
    expect(items).toHaveLength(1);
  });

  it("stays out of the way when the studio has not opted in", async () => {
    const t = convexTest(schema);
    const ids = await studio(t, { auto: false });
    const sessionId = await makeSession(t, ids);
    const asOwner = t.withIdentity({ subject: OWNER, orgId: "org1" });
    await asOwner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    const { items } = await asOwner.query(api.payouts.list, {});
    expect(items).toHaveLength(0);
  });

  it("snapshots the rate, so a later raise does not rewrite what was earned", async () => {
    const t = convexTest(schema);
    const ids = await studio(t);
    const sessionId = await makeSession(t, ids);
    const asOwner = t.withIdentity({ subject: OWNER, orgId: "org1" });
    await asOwner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });

    await t.run((ctx) => ctx.db.patch(ids.eng, { commissionPct: 90 }));
    const { items } = await asOwner.query(api.payouts.list, {});
    expect(items[0].amountCents).toBe(20_000);
    expect(items[0].commissionPctSnapshot).toBe(40);
  });
});

describe("nothing pays itself", () => {
  async function queued(t: ReturnType<typeof convexTest>) {
    const ids = await studio(t);
    const sessionId = await makeSession(t, ids);
    const asOwner = t.withIdentity({ subject: OWNER, orgId: "org1" });
    await asOwner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    const { items } = await asOwner.query(api.payouts.list, {});
    return { asOwner, id: items[0]._id as Id<"payouts">, ids };
  }

  it("refuses to mark a queued payout paid without an approval", async () => {
    const t = convexTest(schema);
    const { asOwner, id } = await queued(t);
    await expect(asOwner.mutation(api.payouts.markPaid, { id })).rejects.toMatchObject({
      data: { code: "PAYOUT_STATE" },
    });
  });

  it("approves, then pays, and posts the cost into the P&L", async () => {
    const t = convexTest(schema);
    const { asOwner, id } = await queued(t);
    await asOwner.mutation(api.payouts.approve, { id });
    await asOwner.mutation(api.payouts.markPaid, { id, note: "Zelle" });

    const { items, totals } = await asOwner.query(api.payouts.list, {});
    expect(items[0].status).toBe("paid");
    expect(totals.paidCents).toBe(20_000);
    expect(totals.owedCents).toBe(0);

    const expenses = await t.run((ctx) => ctx.db.query("expenses").collect());
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ category: "payroll", amountCents: 20_000 });
  });

  it("cannot approve the same payout twice", async () => {
    const t = convexTest(schema);
    const { asOwner, id } = await queued(t);
    await asOwner.mutation(api.payouts.approve, { id });
    await expect(asOwner.mutation(api.payouts.approve, { id })).rejects.toMatchObject({
      data: { code: "PAYOUT_STATE" },
    });
  });

  it("will not void money already paid", async () => {
    const t = convexTest(schema);
    const { asOwner, id } = await queued(t);
    await asOwner.mutation(api.payouts.approve, { id });
    await asOwner.mutation(api.payouts.markPaid, { id });
    await expect(
      asOwner.mutation(api.payouts.voidPayout, { id, reason: "oops" }),
    ).rejects.toMatchObject({ data: { code: "PAYOUT_STATE" } });
  });

  it("voids without deleting, so the decision stays on the record", async () => {
    const t = convexTest(schema);
    const { asOwner, id } = await queued(t);
    await asOwner.mutation(api.payouts.voidPayout, { id, reason: "Session was comped" });
    const { items, totals } = await asOwner.query(api.payouts.list, {});
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("void");
    expect(items[0].note).toBe("Session was comped");
    expect(totals.owedCents).toBe(0);
  });
});

describe("visibility", () => {
  it("lets a teammate see their own payouts", async () => {
    const t = convexTest(schema);
    const ids = await studio(t);
    await t.run((ctx) => ctx.db.patch(ids.eng, { clerkUserId: "u_nia" }));
    const sessionId = await makeSession(t, ids);
    await t.withIdentity({ subject: OWNER, orgId: "org1" })
      .mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });

    const asNia = t.withIdentity({ subject: "u_nia", orgId: "org1" });
    const mine = await asNia.query(api.payouts.mine, {});
    expect(mine.items).toHaveLength(1);
    expect(mine.totals.owedCents).toBe(20_000);
  });
});
