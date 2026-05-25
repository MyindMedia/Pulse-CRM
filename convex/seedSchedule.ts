import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { DEMO_ORG } from "./lib/tenant";

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

    // ── Shifts across the next ~3 months: 2-3 crew per working day, rotating
    //    rooms. The next week is "confirmed", further out "scheduled". ──
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    const base = midnight.getTime();
    let shiftCount = 0;
    for (let d = 0; d < 92; d++) {
      const dayStart = base + d * DAY;
      const weekday = new Date(dayStart).getDay();
      if (weekday === 0) continue; // closed Sundays
      const howMany = weekday === 6 ? 2 : 3;
      for (let k = 0; k < howMany && k < crew.length; k++) {
        const m = crew[(d + k) % crew.length];
        const startHour = 10 + (k % 2) * 2; // 10:00 or 12:00
        const startTime = dayStart + startHour * 60 * MIN;
        const endTime = startTime + 8 * 60 * MIN;
        await ctx.db.insert("shifts", {
          orgId, memberId: m._id, startTime, endTime,
          roomId: room(d + k), kind: "scheduled",
          status: d <= 7 ? "confirmed" : "scheduled",
          note: k === 0 ? "Front desk + tracking" : undefined,
        });
        shiftCount++;
      }
    }

    // ── Time off: one pending (for the manager inbox) + one approved. ──
    if (crew.length) {
      await ctx.db.insert("timeOff", {
        orgId, memberId: crew[crew.length - 1]._id,
        startTime: base + 9 * DAY, endTime: base + 11 * DAY,
        reason: "Out of town - family", status: "pending",
      });
      await ctx.db.insert("timeOff", {
        orgId, memberId: crew[0]._id,
        startTime: base + 20 * DAY, endTime: base + 21 * DAY,
        reason: "Conference", status: "approved",
      });
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

    return { ok: true, availability: availCount, shifts: shiftCount, clientMessages: msgCount };
  },
});
