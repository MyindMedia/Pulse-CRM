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

async function setup(status: "tentative" | "confirmed", extra: Record<string, unknown> = {}) {
  const t = convexTest(schema);
  const sessionId = await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: ORG, name: "Skyline", slug: "demo", tier: "growth", status: "active" });
    const artistId = await ctx.db.insert("artists", {
      orgId: ORG, name: "Nova", type: "artist", phone: "404-555-0101",
      genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    return await ctx.db.insert("sessions", {
      orgId: ORG, title: "Mix", artistId, serviceType: "mixing",
      startTime: Date.now() + HOUR, endTime: Date.now() + 2 * HOUR,
      status, rateCents: 20000, depositCents: 6000, depositPaid: status === "confirmed", intakeCompleted: true,
      ...extra,
    } as never);
  });
  return { t, sessionId: sessionId as Id<"sessions"> };
}

async function queuedTexts(t: ReturnType<typeof convexTest>) {
  const rows = await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return rows.map((r) => (r.args[0] as { body?: string })?.body ?? "");
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

  it("sends a pending request the plain reminder, not the YES/NO question", async () => {
    const { t } = await setup("tentative", { requestStatus: "pending" });
    const due = await t.query(internal.sms._dueReminders, { orgId: ORG });
    expect(due[0].recipients[0].promptKind).toBeUndefined();
    expect(due[0].recipients[0].body).toMatch(/Reminder/);
    expect(due[0].recipients[0].body).not.toMatch(/Reply YES/);
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
});
