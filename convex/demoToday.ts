import { internalMutation } from "./functions";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/* ============================================================
   Demo "today" fill. The year seed spreads sessions at random across
   each week, so on any given demo day the next 24 hours can be empty
   and the Arrival prep card shows nothing. This guarantees a full
   day: one session in progress (wrap-up card), a run of confirmed and
   tentative bookings over the next 24 hours (Arrival prep), the
   matching engineer shifts, and a few prep checklists part done.

   Small on purpose so it fits one mutation. Idempotent: rows are
   tagged sessions.source / shifts.createdBy = "demo_today" and wiped
   before a re-fill, so real data is untouched.
   ============================================================ */

const TAG = "demo_today";
const HOUR = 3_600_000;
const HALF_HOUR = HOUR / 2;

type Service = "recording" | "mixing" | "mastering" | "production" | "writing" | "rehearsal";
const RATE: Record<Service, number> = {
  recording: 8000,
  mixing: 6500,
  mastering: 5500,
  production: 10000,
  writing: 7000,
  rehearsal: 3500,
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Offsets (hours from the next half hour), length, service, status, prep done.
const PLAN: {
  at: number;
  dur: number;
  service: Service;
  status: "in_progress" | "confirmed" | "tentative";
  prep: string[];
}[] = [
  { at: -2, dur: 3, service: "recording", status: "in_progress", prep: ["details", "parking", "room", "welcome"] },
  { at: 0.5, dur: 3, service: "mixing", status: "confirmed", prep: ["details", "parking", "room"] },
  { at: 2, dur: 4, service: "production", status: "confirmed", prep: ["details"] },
  { at: 4.5, dur: 2, service: "writing", status: "tentative", prep: [] },
  { at: 6, dur: 4, service: "recording", status: "confirmed", prep: ["details", "parking"] },
  { at: 9, dur: 3, service: "rehearsal", status: "confirmed", prep: [] },
  { at: 20, dur: 4, service: "recording", status: "confirmed", prep: [] },
  { at: 22, dur: 3, service: "mastering", status: "tentative", prep: [] },
];

export const fill = internalMutation({
  args: { orgId: v.string(), nowMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const orgId = args.orgId;
    const now = args.nowMs ?? Date.now();

    const rooms = await ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const members = await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const artists = await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    if (members.length === 0 || artists.length === 0) {
      return { error: "Org has no members or artists to schedule. Seed the studio first." };
    }
    const engineers = members.slice(0, Math.max(1, Math.min(members.length, 5)));

    // ── Wipe the previous demo_today rows (sessions only live a day or two). ──
    let removed = 0;
    const recent = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", now - 7 * 24 * HOUR))
      .collect();
    for (const s of recent) {
      if (s.source !== TAG) continue;
      const prep = await ctx.db
        .query("arrivalPrep")
        .withIndex("by_org_session", (q) => q.eq("orgId", orgId).eq("sessionId", s._id))
        .collect();
      for (const p of prep) await ctx.db.delete(p._id);
      const own = await ctx.db.query("shifts").withIndex("by_session", (q) => q.eq("sessionId", s._id)).collect();
      for (const sh of own) if (sh.createdBy === TAG) await ctx.db.delete(sh._id);
      await ctx.db.delete(s._id);
      removed++;
    }

    // ── Fill the next 24 hours. ──
    const base = Math.ceil(now / HALF_HOUR) * HALF_HOUR;
    let added = 0;
    for (let i = 0; i < PLAN.length; i++) {
      const p = PLAN[i];
      const a = artists[(i * 3) % artists.length];
      const eng = engineers[i % engineers.length];
      const room = rooms.length ? rooms[i % rooms.length] : undefined;
      const start = base + p.at * HOUR;
      const end = start + p.dur * HOUR;
      const rateCents = RATE[p.service] * p.dur;
      const depositCents = Math.max(2500, Math.round(rateCents * 0.25));
      const depositPaid = p.status !== "tentative";

      const sessionId = (await ctx.db.insert("sessions", {
        orgId,
        title: `${cap(p.service)} - ${a.name}`,
        artistId: a._id as Id<"artists">,
        serviceType: p.service,
        roomId: room?._id,
        engineerId: eng._id,
        startTime: start,
        endTime: end,
        status: p.status,
        rateCents,
        depositCents,
        depositPaid,
        intakeCompleted: p.status !== "tentative",
        amountPaidCents: depositPaid ? depositCents : 0,
        source: TAG,
      })) as Id<"sessions">;
      added++;

      await ctx.db.insert("shifts", {
        orgId,
        memberId: eng._id,
        startTime: start,
        endTime: end,
        roomId: room?._id,
        kind: "session",
        sessionId,
        status: "confirmed",
        createdBy: TAG,
      });

      if (p.prep.length) {
        const by = engineers[(i + 1) % engineers.length].name ?? "Front desk";
        await ctx.db.insert("arrivalPrep", {
          orgId,
          sessionId,
          done: p.prep,
          attribution: p.prep.map((step, k) => ({ step, by, at: now - (p.prep.length - k) * 20 * 60_000 })),
        });
      }
    }
    return { orgId, removed, added };
  },
});
