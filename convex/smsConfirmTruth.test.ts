import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* "You are confirmed" is only texted for a booking that is confirmed.
   A pending request or an unpaid hold gets the plain 2h reminder, and a
   YES text never flips a tentative booking to confirmed. */
const ORG = "pulse-demo";
const HOUR = 3_600_000;

const MANAGER = "+14045550100";

async function setup(
  status: "tentative" | "confirmed" | "in_progress" | "completed",
  extra: Record<string, unknown> = {},
  opts: { managerPhone?: string } = {},
) {
  const t = convexTest(schema);
  const sessionId = await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: ORG, name: "Skyline", slug: "demo", tier: "growth", status: "active" });
    if (opts.managerPhone) {
      await ctx.db.insert("members", { orgId: ORG, name: "Mgr", role: "manager", skills: [], phone: opts.managerPhone } as never);
    }
    const artistId = await ctx.db.insert("artists", {
      orgId: ORG, name: "Nova", type: "artist", phone: "404-555-0101",
      genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    return await ctx.db.insert("sessions", {
      orgId: ORG, title: "Mix", artistId, serviceType: "mixing",
      startTime: Date.now() + HOUR, endTime: Date.now() + 2 * HOUR,
      status, rateCents: 20000, depositCents: 6000, depositPaid: status !== "tentative", intakeCompleted: true,
      ...extra,
    } as never);
  });
  return { t, sessionId: sessionId as Id<"sessions"> };
}

async function queuedTexts(t: ReturnType<typeof convexTest>) {
  const rows = await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return rows.map((r) => (r.args[0] as { body?: string })?.body ?? "");
}

async function queuedSends(t: ReturnType<typeof convexTest>) {
  const rows = await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return rows
    .map((r) => r.args[0] as { to?: string; body?: string })
    .filter((a) => a?.to && a?.body) as { to: string; body: string }[];
}

async function openConfirmPrompt(t: ReturnType<typeof convexTest>, sessionId: Id<"sessions">) {
  await t.run(async (ctx) => {
    await ctx.db.insert("smsPrompts", {
      orgId: ORG, phone: "+14045550101", kind: "booking_confirm", sessionId,
      status: "open", sentAt: Date.now(), expiresAt: Date.now() + HOUR,
    });
  });
}

describe("2h confirm text tells the truth", () => {
  it("asks a confirmed booking YES/NO", async () => {
    const { t } = await setup("confirmed");
    const due = await t.query(internal.sms._dueReminders, { orgId: ORG });
    expect(due[0].recipients[0].promptKind).toBe("booking_confirm");
  });

  it("sends an unpaid hold the plain reminder, not the YES/NO question", async () => {
    const { t } = await setup("tentative");
    const due = await t.query(internal.sms._dueReminders, { orgId: ORG });
    expect(due[0].recipients[0].promptKind).toBeUndefined();
    expect(due[0].recipients[0].body).toMatch(/Reminder/);
    expect(due[0].recipients[0].body).not.toMatch(/Reply YES/);
  });

  it("sends a pending request no reminder text at all", async () => {
    const { t } = await setup("tentative", { requestStatus: "pending" });
    expect(await t.query(internal.sms._dueReminders, { orgId: ORG })).toEqual([]);
  });

  it("YES on an unpaid hold does not confirm it and does not say confirmed", async () => {
    const { t, sessionId } = await setup("tentative");
    await openConfirmPrompt(t, sessionId);
    await t.mutation(internal.sms._handleInbound, { from: "+14045550101", body: "YES" });
    const s = await t.run((ctx) => ctx.db.get(sessionId));
    expect(s?.status).toBe("tentative");
    expect((await queuedTexts(t)).some((b) => /You are confirmed/.test(b))).toBe(false);
  });

  it("YES on a confirmed booking still gets the confirmed ack", async () => {
    const { t, sessionId } = await setup("confirmed");
    await openConfirmPrompt(t, sessionId);
    await t.mutation(internal.sms._handleInbound, { from: "+14045550101", body: "YES" });
    expect((await queuedTexts(t)).some((b) => /You are confirmed/.test(b))).toBe(true);
  });

  for (const status of ["in_progress", "completed"] as const) {
    it(`YES after the confirmed session moved on (${status}) gets the confirmed ack and no false alert`, async () => {
      const { t, sessionId } = await setup(status, {}, { managerPhone: MANAGER });
      await openConfirmPrompt(t, sessionId);
      await t.mutation(internal.sms._handleInbound, { from: "+14045550101", body: "YES" });
      const sends = await queuedSends(t);
      expect(sends.some((x) => x.to === "+14045550101" && /You are confirmed/.test(x.body))).toBe(true);
      expect(sends.some((x) => x.to === MANAGER && /not confirmed/.test(x.body))).toBe(false);
    });
  }

  it("YES on an unconfirmed booking answers the client and alerts the managers", async () => {
    const { t, sessionId } = await setup("tentative", {}, { managerPhone: MANAGER });
    await openConfirmPrompt(t, sessionId);
    await t.mutation(internal.sms._handleInbound, { from: "+14045550101", body: "YES" });
    const sends = await queuedSends(t);
    const toClient = sends.filter((x) => x.to === "+14045550101").map((x) => x.body);
    expect(toClient).toEqual(["Pulse: Thanks, we have passed this to Skyline."]);
    expect(sends.some((x) => x.to === MANAGER && /not confirmed yet/.test(x.body))).toBe(true);
  });

  it("YES on an unconfirmed booking with nobody to tell does not claim it was passed on", async () => {
    const { t, sessionId } = await setup("tentative");
    await openConfirmPrompt(t, sessionId);
    await t.mutation(internal.sms._handleInbound, { from: "+14045550101", body: "YES" });
    const toClient = (await queuedSends(t)).filter((x) => x.to === "+14045550101").map((x) => x.body);
    expect(toClient).toHaveLength(1);
    expect(toClient[0]).toMatch(/could not reach Skyline/);
  });

  it("NO then REBOOK never promises a held deposit, to the client or the managers", async () => {
    const { t, sessionId } = await setup("confirmed", {}, { managerPhone: MANAGER });
    await openConfirmPrompt(t, sessionId);
    await t.mutation(internal.sms._handleInbound, { from: "+14045550101", body: "NO" });
    await t.mutation(internal.sms._handleInbound, { from: "+14045550101", body: "REBOOK" });
    const sends = await queuedSends(t);
    for (const x of sends) {
      expect(x.body).not.toMatch(/on hold|held for rebooking/i);
    }
    const toClient = sends.filter((x) => x.to === "+14045550101").map((x) => x.body);
    expect(toClient.some((b) => /Thanks - we have let Skyline know you want a new time\. They will reach out about your deposit\./.test(b))).toBe(true);
    const toMgr = sends.filter((x) => x.to === MANAGER).map((x) => x.body);
    expect(toMgr.some((b) => /follow up with them about the deposit/.test(b))).toBe(true);
  });
});
