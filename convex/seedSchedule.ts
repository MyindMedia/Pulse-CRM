import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { DEMO_ORG } from "./lib/tenant";
import { HOLIDAYS, ymd } from "./lib/holidays";

/* ============================================================
   Demo top-up: fills the modules the main seed leaves empty so
   every surface has something to show in a prospect demo -
   staff Schedule (shifts, availability, time-off), client
   Messages, and the Agent's memory + automations. Idempotent:
   clears the tables it owns for the org, then rebuilds.
     npx convex run seedSchedule:run '{"orgId":"<org>"}'
   ============================================================ */

const DAY = 86_400_000;
const MIN = 60_000;

export const run = mutation({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const orgId = args.orgId ?? DEMO_ORG;
    const now = Date.now();

    // Wipe the tables this seeder owns (so re-runs don't duplicate).
    for (const table of ["shifts", "availability", "timeOff", "clientMessages", "agentMemories", "agentAutomations"] as const) {
      const rows = await ctx.db.query(table).withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
      for (const r of rows) await ctx.db.delete(r._id);
    }

    const members = await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const rooms = await ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const artists = await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    if (members.length === 0) return { ok: false, reason: "no members - run seed:run first" };

    // Staff we schedule: everyone except the owner sits the desk less.
    const staff = members.filter((m) => m.role !== "owner");
    const crew = staff.length ? staff : members;
    const bookable = rooms.filter((r) => r.status !== "retired");
    const room = (i: number) => bookable[i % Math.max(1, bookable.length)]?._id;

    // ── Weekly availability: Mon-Fri 10-18 for managers, Tue-Sat 12-22 for the
    //    rest, so the availability grid is full. ──
    let availCount = 0;
    for (const [i, m] of crew.entries()) {
      const days = m.role === "manager" ? [1, 2, 3, 4, 5] : i % 2 === 0 ? [1, 2, 3, 4, 5] : [2, 3, 4, 5, 6];
      const start = m.role === "manager" ? 600 : 720; // 10:00 or 12:00
      const end = m.role === "manager" ? 1080 : 1320; // 18:00 or 22:00
      for (const weekday of days) {
        await ctx.db.insert("availability", { orgId, memberId: m._id, weekday, startMinutes: start, endMinutes: end });
        availCount++;
      }
    }

    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    const base = midnight.getTime();
    const holidayYmds = new Set(HOLIDAYS.map((h) => h.ymd));
    const holidayName = (ts: number) => HOLIDAYS.find((h) => h.ymd === ymd(ts))?.name;

    // ── Time off (built first so shifts can avoid scheduling people who are
    //    out): holiday closures (whole studio off), plus personal days. ──
    // memberId -> [start,end] ranges they're unavailable.
    const off = new Map<string, { start: number; end: number }[]>();
    const addOff = (memberId: string, start: number, end: number) => {
      const list = off.get(memberId) ?? [];
      list.push({ start, end });
      off.set(memberId, list);
    };
    let timeOffCount = 0;

    // Holiday closures inside the window: every crew member marked off.
    for (let d = 0; d < 92; d++) {
      const dayStart = base + d * DAY;
      const name = holidayName(dayStart);
      if (!name) continue;
      for (const m of crew) {
        await ctx.db.insert("timeOff", {
          orgId, memberId: m._id, startTime: dayStart, endTime: dayStart + DAY,
          reason: `Studio closed - ${name}`, status: "approved",
        });
        addOff(m._id, dayStart, dayStart + DAY);
        timeOffCount++;
      }
    }

    // Personal days off: 2 per crew member, spread across the quarter.
    const reasons = ["Vacation", "Personal day", "Out of town - family", "Medical", "Studio offsite"];
    for (const [i, m] of crew.entries()) {
      for (let n = 0; n < 2; n++) {
        const dayOffset = 8 + ((i * 17 + n * 41) % 80); // spread, deterministic
        const start = base + dayOffset * DAY;
        const span = n === 0 ? 1 : 2; // a single day and a 2-day block
        await ctx.db.insert("timeOff", {
          orgId, memberId: m._id, startTime: start, endTime: start + span * DAY,
          reason: reasons[(i + n) % reasons.length], status: "approved",
        });
        addOff(m._id, start, start + span * DAY);
        timeOffCount++;
      }
    }
    // One pending request so the manager approval inbox has something.
    if (crew.length) {
      await ctx.db.insert("timeOff", {
        orgId, memberId: crew[crew.length - 1]._id,
        startTime: base + 47 * DAY, endTime: base + 49 * DAY,
        reason: "Trip - pending approval", status: "pending",
      });
      timeOffCount++;
    }

    const isOff = (memberId: string, dayStart: number) =>
      (off.get(memberId) ?? []).some((r) => dayStart < r.end && dayStart + DAY > r.start);

    // ── Shifts across the next ~3 months: 2-3 crew per working day, rotating
    //    the lineup weekly. Closed Sundays + holidays get no shifts, and nobody
    //    is scheduled on a day they're off. ──
    let shiftCount = 0;
    for (let d = 0; d < 92; d++) {
      const dayStart = base + d * DAY;
      const weekday = new Date(dayStart).getDay();
      if (weekday === 0 || holidayYmds.has(ymd(dayStart))) continue; // closed
      const weekIndex = Math.floor(d / 7);
      const howMany = weekday === 6 ? 2 : 3;
      let placed = 0;
      for (let attempt = 0; attempt < crew.length && placed < howMany; attempt++) {
        // Rotate the lineup each week so a given weekday is staffed by
        // different people week to week across the quarter.
        const m = crew[(weekday + placed + weekIndex + attempt) % crew.length];
        if (isOff(m._id, dayStart)) continue; // respect their day off
        const startHour = 10 + (placed % 2) * 2; // 10:00 or 12:00
        const startTime = dayStart + startHour * 60 * MIN;
        const endTime = startTime + 8 * 60 * MIN;
        await ctx.db.insert("shifts", {
          orgId, memberId: m._id, startTime, endTime,
          roomId: room(d + placed), kind: "scheduled",
          status: d <= 7 ? "confirmed" : "scheduled",
          note: placed === 0 ? "Front desk + tracking" : undefined,
        });
        placed++;
        shiftCount++;
      }
    }

    // ── Client messages: a short thread per a couple of artists. ──
    let msgCount = 0;
    for (const a of artists.slice(0, 2)) {
      await ctx.db.insert("clientMessages", {
        orgId, artistId: a._id, direction: "out", subject: "Your upcoming session",
        body: "Hey! Confirming your session this week. Bring any reference tracks and we'll be set up and ready.",
        channel: "internal", status: "sent",
      });
      await ctx.db.insert("clientMessages", {
        orgId, artistId: a._id, direction: "in", subject: "Text message",
        body: "Perfect, see you then. Excited!", channel: "sms", status: "received",
      });
      msgCount += 2;
    }

    // ── Agent memory + automations so those surfaces aren't empty. ──
    const mem = (memoryType: "studio_profile" | "tone_preferences" | "business_rules", summary: string) =>
      ctx.db.insert("agentMemories", { orgId, memoryType, summary, confidence: 1, source: "user", status: "active", createdAt: now, updatedAt: now });
    await mem("studio_profile", "Independent label and studio focused on vocal-forward R&B and hip-hop; strong in tracking, mixing, and artist development.");
    await mem("business_rules", "Require a 50% deposit before a session is confirmed. Balance due before stems are delivered.");
    await mem("tone_preferences", "Client messages are warm, concise, and confident - never stiff or corporate.");

    await ctx.db.insert("agentAutomations", {
      orgId, name: "Weekly collections sweep", prompt: "Find overdue invoices and draft polite payment reminders for each.",
      cadence: "weekly", weekday: 1, enabled: true, runCount: 0, createdBy: "demo", createdAt: now,
    });
    await ctx.db.insert("agentAutomations", {
      orgId, name: "Daily session prep check", prompt: "Check tomorrow's sessions for missing deposits, files, or references and flag anything at risk.",
      cadence: "daily", enabled: true, runCount: 0, createdBy: "demo", createdAt: now,
    });

    return { ok: true, availability: availCount, shifts: shiftCount, timeOff: timeOffCount, clientMessages: msgCount };
  },
});
