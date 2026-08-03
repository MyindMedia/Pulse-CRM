import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { normalizePhone } from "./lib/phone";

/* Internal-only fixtures for live-testing the two-way SMS flows against prod.
   Run via `npx convex run smsTestFixtures:<fn>` with the deploy key; every row
   they create is tagged so teardown removes exactly what setup made. */

const TEST_TAG = "sms-flow-test";
const HOUR = 3_600_000;

/** Find the org whose member roster carries this cell (the tester's own org),
 *  upsert a test client with the same cell, and open a tentative session
 *  ~100 min out - inside the 2h confirm window, so the next sms-reminders run
 *  sends the YES/NO question. */
export const setupBookingTest = internalMutation({
  args: { phone: v.string(), title: v.optional(v.string()) },
  handler: async (ctx, { phone, title }) => {
    const normalized = normalizePhone(phone);
    if (!normalized) throw new Error("bad phone");
    const members = await ctx.db.query("members").collect();
    const member = members.find((m) => m.phone && normalizePhone(m.phone) === normalized);
    if (!member) throw new Error("no member with that cell - run from a phone on a roster");
    const orgId = member.orgId;

    const artists = await ctx.db
      .query("artists")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    let artist = artists.find((a) => a.tags.includes(TEST_TAG));
    if (!artist) {
      const id = await ctx.db.insert("artists", {
        orgId,
        name: "SMS Flow Test Client",
        type: "artist",
        phone: normalized,
        genres: [],
        tags: [TEST_TAG],
        status: "active",
        lifetimeValueCents: 0,
        sessionCount: 0,
        reliability: "solid",
      });
      artist = (await ctx.db.get(id))!;
    }

    const start = Date.now() + 100 * 60_000;
    const sessionId = await ctx.db.insert("sessions", {
      orgId,
      title: title ?? "SMS Flow Test Session",
      artistId: artist._id,
      serviceType: "recording",
      startTime: start,
      endTime: start + 2 * HOUR,
      status: "tentative",
      rateCents: 0,
      depositCents: 5000,
      depositPaid: true,
      intakeCompleted: true,
      source: "internal",
      notes: TEST_TAG,
    });
    return { orgId, org: member.orgId, artistId: artist._id, sessionId, startTime: start };
  },
});

/** Session + prompt state - poll this after each reply to verify the effect. */
export const bookingTestStatus = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const s = await ctx.db.get(sessionId);
    if (!s) return null;
    const prompts = await ctx.db
      .query("smsPrompts")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    return {
      status: s.status,
      clientDeclinedAt: s.clientDeclinedAt ?? null,
      rebookHoldUntil: s.rebookHoldUntil ?? null,
      smsRemindersSent: s.smsRemindersSent ?? [],
      prompts: prompts.map((p) => ({ kind: p.kind, status: p.status, answer: p.answer ?? null })),
    };
  },
});

/** Backdate-or-create an active time entry for the member with this cell so
 *  the next timeclock sweep fires the 8h overtime (or 4h intern) question. */
export const setupTimeclockTest = internalMutation({
  args: { phone: v.string(), hoursAgo: v.number() },
  handler: async (ctx, { phone, hoursAgo }) => {
    const normalized = normalizePhone(phone);
    const members = await ctx.db.query("members").collect();
    const member = members.find((m) => m.phone && normalizePhone(m.phone) === normalized);
    if (!member) throw new Error("no member with that cell");
    const open = await ctx.db
      .query("timeEntries")
      .withIndex("by_member_status", (q) => q.eq("memberId", member._id).eq("status", "active"))
      .first();
    if (open) {
      await ctx.db.patch(open._id, { clockInAt: Date.now() - hoursAgo * HOUR });
      return { entryId: open._id, memberId: member._id, orgId: member.orgId, reused: true };
    }
    const entryId = await ctx.db.insert("timeEntries", {
      orgId: member.orgId,
      memberId: member._id,
      clockInAt: Date.now() - hoursAgo * HOUR,
      status: "active",
      source: "manual",
      note: TEST_TAG,
    });
    return { entryId, memberId: member._id, orgId: member.orgId, reused: false };
  },
});

/** Create a throwaway intern (fake, undeliverable cell) with an active entry
 *  past the 4h mark, so the sweep opens the intern check-in. The EXTEND leg is
 *  then simulated via the webhook; the manager-approval text goes to the real
 *  managers. */
export const setupInternTest = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const fakePhone = "+15005550100";
    let intern = (
      await ctx.db
        .query("members")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
    ).find((m) => m.notes === TEST_TAG);
    if (!intern) {
      const id = await ctx.db.insert("members", {
        orgId,
        name: "SMS Test Intern",
        phone: fakePhone,
        role: "intern",
        skills: [],
        notes: TEST_TAG,
      });
      intern = (await ctx.db.get(id))!;
    }
    const entryId = await ctx.db.insert("timeEntries", {
      orgId,
      memberId: intern._id,
      clockInAt: Date.now() - 4.5 * HOUR,
      status: "active",
      source: "manual",
      note: TEST_TAG,
    });
    return { memberId: intern._id, entryId, internPhone: fakePhone };
  },
});

export const timeclockTestStatus = internalQuery({
  args: { entryId: v.id("timeEntries") },
  handler: async (ctx, { entryId }) => {
    const e = await ctx.db.get(entryId);
    if (!e) return null;
    const prompts = await ctx.db
      .query("smsPrompts")
      .withIndex("by_entry", (q) => q.eq("entryId", entryId))
      .collect();
    return {
      status: e.status,
      clockInAt: e.clockInAt,
      clockOutAt: e.clockOutAt ?? null,
      otPromptSentAt: e.otPromptSentAt ?? null,
      otStatus: e.otStatus ?? null,
      internExtension: e.internExtension ?? null,
      autoClosedReason: e.autoClosedReason ?? null,
      prompts: prompts.map((p) => ({ kind: p.kind, phone: p.phone, status: p.status, answer: p.answer ?? null })),
    };
  },
});

/** Remove everything the fixtures created (sessions/entries tagged, the test
 *  client, and any prompts hanging off them). */
export const teardown = internalMutation({
  args: {},
  handler: async (ctx) => {
    let removed = 0;
    for (const s of await ctx.db.query("sessions").collect()) {
      if (s.notes === TEST_TAG) {
        for (const p of await ctx.db
          .query("smsPrompts")
          .withIndex("by_session", (q) => q.eq("sessionId", s._id))
          .collect()) {
          await ctx.db.delete(p._id);
          removed++;
        }
        await ctx.db.delete(s._id);
        removed++;
      }
    }
    for (const e of await ctx.db.query("timeEntries").collect()) {
      if (e.note === TEST_TAG) {
        for (const p of await ctx.db
          .query("smsPrompts")
          .withIndex("by_entry", (q) => q.eq("entryId", e._id))
          .collect()) {
          await ctx.db.delete(p._id);
          removed++;
        }
        await ctx.db.delete(e._id);
        removed++;
      }
    }
    for (const a of await ctx.db.query("artists").collect()) {
      if (a.tags.includes(TEST_TAG)) {
        await ctx.db.delete(a._id);
        removed++;
      }
    }
    for (const m of await ctx.db.query("members").collect()) {
      if (m.notes === TEST_TAG) {
        await ctx.db.delete(m._id);
        removed++;
      }
    }
    return { removed };
  },
});
