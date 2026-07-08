import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function seed(t: ReturnType<typeof convexTest>, now: number) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: "org_rem", name: "Reminder Studio", slug: "rem", plan: "studio", status: "active" });
    const eng = await ctx.db.insert("members", { orgId: "org_rem", name: "Eng", role: "engineer", email: "eng@studio.test", skills: [] });
    const artist = await ctx.db.insert("artists", {
      orgId: "org_rem", name: "Nova", type: "artist", email: "nova@client.test", genres: [], tags: [],
      status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    const session = await ctx.db.insert("sessions", {
      orgId: "org_rem", title: "Nova - mix", artistId: artist, serviceType: "mixing",
      startTime: now + 20 * HOUR, endTime: now + 23 * HOUR, status: "confirmed",
      rateCents: 30000, depositCents: 0, depositPaid: true, intakeCompleted: true,
      engineerId: eng,
    });
    const shift = await ctx.db.insert("shifts", {
      orgId: "org_rem", memberId: eng, startTime: now + 20 * HOUR, endTime: now + 26 * HOUR,
      kind: "scheduled", status: "scheduled",
    });
    return { eng, artist, session, shift };
  });
}

describe("email reminder sweep", () => {
  it("sends 24h session reminders to client + engineer and a shift reminder, idempotently", async () => {
    const t = convexTest(schema);
    const now = Date.now();
    const { session, shift } = await seed(t, now);

    const first = await t.mutation(internal.reminders.sweep, { nowMs: now });
    expect(first.sent).toBe(3); // client + engineer + shift

    const notifs = await t.run((ctx) => ctx.db.query("notifications").collect());
    const kinds = notifs.map((n) => n.kind).sort();
    expect(kinds).toEqual(["session.reminder_24h", "session.reminder_24h", "shift.reminder_24h"]);
    expect(notifs.some((n) => n.recipient === "nova@client.test")).toBe(true);
    expect(notifs.some((n) => n.recipient === "eng@studio.test")).toBe(true);

    // markers set + second sweep sends nothing
    const s = await t.run((ctx) => ctx.db.get(session));
    expect(s!.emailRemindersSent).toEqual(["24h"]);
    const sh = await t.run((ctx) => ctx.db.get(shift));
    expect(sh!.reminderSentAt).toBeDefined();
    const second = await t.mutation(internal.reminders.sweep, { nowMs: now });
    expect(second.sent).toBe(0);
  });

  it("escalates to the 2h reminder as the session approaches", async () => {
    const t = convexTest(schema);
    const now = Date.now();
    const { session } = await seed(t, now);
    await t.mutation(internal.reminders.sweep, { nowMs: now }); // 24h pass

    // 18.5 hours later the session is ~1.5h away -> 2h reminder fires once.
    const later = now + 18.5 * HOUR;
    const res = await t.mutation(internal.reminders.sweep, { nowMs: later });
    expect(res.sent).toBe(2); // client + engineer (shift already reminded)
    const s = await t.run((ctx) => ctx.db.get(session));
    expect(s!.emailRemindersSent).toEqual(["24h", "2h"]);
    expect((await t.mutation(internal.reminders.sweep, { nowMs: later })).sent).toBe(0);
  });

  it("skips cancelled sessions and cancelled shifts", async () => {
    const t = convexTest(schema);
    const now = Date.now();
    const { session, shift } = await seed(t, now);
    await t.run(async (ctx) => {
      await ctx.db.patch(session, { status: "cancelled" });
      await ctx.db.patch(shift, { status: "cancelled" });
    });
    const res = await t.mutation(internal.reminders.sweep, { nowMs: now });
    expect(res.sent).toBe(0);
  });
});
