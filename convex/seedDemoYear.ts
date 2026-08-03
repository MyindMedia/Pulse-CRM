import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/* ============================================================
   Demo year-fill. Generates a robust rolling 52-week dataset for a
   demo org (default: Myind Sound) so the app looks lived-in for
   pitching: bookings across rooms/engineers/artists, the matching
   staff schedule (session + standing shifts), and invoices for the
   completed work. Idempotent - everything it creates is tagged
   (sessions.source / shifts.createdBy = "demo_year", invoice numbers
   "DEMO-…") and wiped before a re-fill, so real data is untouched.
   ============================================================ */

const TAG = "demo_year";
const DAY = 86_400_000;
const HOUR = 3_600_000;

const SERVICES = [
  "recording",
  "mixing",
  "mastering",
  "production",
  "writing",
  "rehearsal",
  "consultation",
] as const;
type Service = (typeof SERVICES)[number];
// Hourly rate (cents) per service - drives session rate + invoice totals.
const RATE: Record<Service, number> = {
  recording: 8000,
  mixing: 6500,
  mastering: 5500,
  production: 10000,
  writing: 7000,
  rehearsal: 3500,
  consultation: 4500,
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Deterministic PRNG so re-runs produce a stable, sensible dataset. */
function makeRng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const pick = <T>(arr: T[], r: number) => arr[Math.floor(r * arr.length) % arr.length];

export const fillYear = internalMutation({
  args: {
    orgId: v.string(),
    perWeek: v.optional(v.number()), // sessions per week (default 6)
    weeksBack: v.optional(v.number()), // history depth (default 40)
    weeksFwd: v.optional(v.number()), // upcoming depth (default 12)
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = args.orgId;
    const now = args.nowMs ?? Date.now();
    const perWeek = args.perWeek ?? 6;
    const weeksBack = args.weeksBack ?? 40;
    const weeksFwd = args.weeksFwd ?? 12;

    const rooms = await ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const members = await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const artists = await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    if (members.length === 0 || artists.length === 0) {
      return { error: "Org has no members or artists to schedule. Seed the studio first." };
    }
    const engineers = members.slice(0, Math.max(1, Math.min(members.length, 5)));

    // ── Wipe prior demo_year content (idempotent re-fill) ──
    const oldSessions = await ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const oldSeededIds = new Set(oldSessions.filter((x) => x.source === TAG).map((x) => x._id as string));
    const oldNotes = await ctx.db.query("notifications").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    for (const n of oldNotes) {
      if (n.sessionId && oldSeededIds.has(n.sessionId as string)) await ctx.db.delete(n._id);
    }
    for (const s of oldSessions) if (s.source === TAG) await ctx.db.delete(s._id);
    const oldShifts = await ctx.db.query("shifts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    for (const sh of oldShifts) if (sh.createdBy === TAG) await ctx.db.delete(sh._id);
    const oldInv = await ctx.db.query("invoices").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    for (const iv of oldInv) if (iv.number.startsWith("DEMO-")) await ctx.db.delete(iv._id);
    const oldOpps = await ctx.db.query("opportunities").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    for (const o of oldOpps) if (o.source === TAG) await ctx.db.delete(o._id);

    // Monday of the earliest week in the window.
    const startMonday = (() => {
      const d = new Date(now - weeksBack * 7 * DAY);
      const dow = (d.getDay() + 6) % 7; // 0 = Monday
      d.setHours(0, 0, 0, 0);
      return d.getTime() - dow * DAY;
    })();
    const totalWeeks = weeksBack + weeksFwd;

    let sessionCount = 0;
    let shiftCount = 0;
    let invoiceCount = 0;
    let invSeq = 1000;

    for (let w = 0; w < totalWeeks; w++) {
      const weekStart = startMonday + w * 7 * DAY;

      // ── Standing staff schedule: each engineer works a few fixed days ──
      for (let e = 0; e < engineers.length; e++) {
        const eng = engineers[e];
        const days = [1 + (e % 2), 3, 5 - (e % 2)]; // Tue/Thu/Sat-ish, staggered
        for (const wd of days) {
          const start = weekStart + wd * DAY + 10 * HOUR; // 10:00
          await ctx.db.insert("shifts", {
            orgId,
            memberId: eng._id,
            startTime: start,
            endTime: start + 8 * HOUR, // 8h shift
            roomId: rooms.length ? pick(rooms, (e + wd) / 7)._id : undefined,
            kind: "scheduled",
            status: start < now ? "confirmed" : "scheduled",
            createdBy: TAG,
          });
          shiftCount++;
        }
      }

      // ── Bookings for the week ──
      const r = makeRng(weekStart);
      // The studio grows across the window and runs hottest in the current
      // month. Two reasons: the revenue trend should climb rather than wander,
      // and Revenue MTD is measured against a FULL prior month, so without a
      // lift the tile reads negative every day of every month.
      const growth = 0.7 + 0.6 * (w / Math.max(1, totalWeeks - 1));
      const wkDate = new Date(weekStart);
      const nowDate = new Date(now);
      const inCurrentMonth =
        wkDate.getFullYear() === nowDate.getFullYear() &&
        wkDate.getMonth() === nowDate.getMonth();
      const lift = inCurrentMonth ? 3.1 : 1;
      const count = Math.max(2, Math.round((perWeek + (r() - 0.5) * 4) * growth * lift));
      for (let i = 0; i < count; i++) {
        const a = pick(artists, r());
        const eng = pick(engineers, r());
        const room = rooms.length ? pick(rooms, r()) : undefined;
        const service = pick([...SERVICES], r());
        const wd = 1 + Math.floor(r() * 6); // Mon..Sat
        const hour = 10 + Math.floor(r() * 8); // 10..17 start
        const dur = 2 + Math.floor(r() * 5); // 2..6 h
        const start = weekStart + wd * DAY + hour * HOUR;
        const end = start + dur * HOUR;
        const past = end < now;

        let status: "completed" | "cancelled" | "no_show" | "confirmed" | "tentative";
        if (past) {
          const x = r();
          status = x < 0.82 ? "completed" : x < 0.93 ? "cancelled" : "no_show";
        } else {
          status = r() < 0.7 ? "confirmed" : "tentative";
        }
        const rateCents = RATE[service] * dur;
        const depositCents = Math.max(2500, Math.round(rateCents * 0.25));
        const depositPaid = status !== "tentative" && status !== "cancelled";
        const amountPaidCents =
          status === "completed" ? rateCents : depositPaid ? depositCents : 0;

        const sessionId = (await ctx.db.insert("sessions", {
          orgId,
          title: `${cap(service)} — ${a.name}`,
          artistId: a._id as Id<"artists">,
          serviceType: service,
          roomId: room?._id,
          engineerId: eng._id,
          startTime: start,
          endTime: end,
          status,
          rateCents,
          depositCents,
          depositPaid,
          intakeCompleted: status !== "tentative",
          amountPaidCents,
          source: TAG,
        })) as Id<"sessions">;
        sessionCount++;

        // Message log: confirmations, reminders and a short client thread on a
        // sample of bookings so the sheet's log demos real traffic.
        if (r() < 0.38) {
          const first = a.name.split(" ")[0];
          const when = new Date(start).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
          const at = new Date(start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
          const email = a.email ?? `${a.name.toLowerCase().replace(/[^a-z]+/g, ".")}@demo.mail`;
          await ctx.db.insert("notifications", {
            orgId, channel: "email", recipient: email,
            subject: `Booking confirmed - ${cap(service)} — ${a.name}`,
            body: `Hi ${first}, you're locked in for ${cap(service).toLowerCase()} on ${when} at ${at}${room ? ` in ${room.name}` : ""}. Deposit received - see you then.`,
            kind: "booking.confirmed", sessionId, status: "sent",
          });
          if (r() < 0.7) {
            await ctx.db.insert("notifications", {
              orgId, channel: "sms", recipient: a.phone ?? "+15550100200",
              subject: "Session reminder",
              body: `${cap(service)} session tomorrow at ${at}. Reply if anything changed - see you soon!`,
              kind: "session.reminder.24h", sessionId, status: "simulated",
            });
          }
          if (r() < 0.45) {
            const q = pick([
              `Can we start 30 min later? Traffic is rough on my end.`,
              `Is the U87 free for this one? Want it on lead vocals.`,
              `Cool to bring one extra writer to the session?`,
              `Do you have a session drummer we could add for an hour?`,
            ] as const, r());
            const reply = pick([
              `All good - adjusted on our side. See you soon.`,
              `Yes, reserved it for your session. Anything else you need?`,
              `Of course - front desk will check them in.`,
              `We'll have someone on call - confirm by tomorrow and it's set.`,
            ] as const, r());
            await ctx.db.insert("notifications", {
              orgId, channel: "sms", recipient: a.phone ?? "+15550100200",
              subject: `SMS from ${a.name}`,
              body: q, kind: "client.question", sessionId, status: "sent",
            });
            await ctx.db.insert("notifications", {
              orgId, channel: "sms", recipient: a.phone ?? "+15550100200",
              subject: "Front desk reply",
              body: reply, kind: "staff.reply", sessionId, status: "sent",
            });
          }
        }

        // Matching engineer shift for the booking.
        await ctx.db.insert("shifts", {
          orgId,
          memberId: eng._id,
          startTime: start,
          endTime: end,
          roomId: room?._id,
          kind: "session",
          sessionId,
          status: status === "cancelled" || status === "no_show" ? "cancelled" : "confirmed",
          createdBy: TAG,
        });
        shiftCount++;

        // Invoice for completed work (mostly paid; some sent/overdue).
        if (status === "completed") {
          const x = r();
          // Age matters: the dashboard counts any SENT invoice past its due
          // date as overdue, so a flat unpaid rate across 52 weeks piles up a
          // year of stragglers (45 of them, all red). Real studios collect old
          // work; only recent invoices are legitimately still in flight.
          const ageDays = (now - end) / DAY;
          const invStatus =
            ageDays > 21
              ? x < 0.985
                ? "paid"
                : "overdue"
              : x < 0.86
                ? "paid"
                : x < 0.94
                  ? "sent"
                  : "overdue";
          const dueDate = end + 7 * DAY;
          await ctx.db.insert("invoices", {
            orgId,
            number: `DEMO-${invSeq++}`,
            artistId: a._id as Id<"artists">,
            sessionId,
            status: invStatus as "paid" | "sent" | "overdue",
            lineItems: [{ label: `${cap(service)} session (${dur}h)`, amountCents: rateCents }],
            amountCents: rateCents,
            dueDate,
            paidAt: invStatus === "paid" ? end + Math.floor(r() * 6) * DAY : undefined,
          });
          invoiceCount++;
        }
      }
    }

    // ── Sales pipeline: open + closed opportunities across the stages ──
    const STAGES: { stage: "inquiry" | "qualified" | "proposal" | "booked" | "in_progress" | "delivered" | "won" | "lost"; n: number; prob: number }[] = [
      { stage: "inquiry", n: 8, prob: 0.2 },
      { stage: "qualified", n: 6, prob: 0.4 },
      { stage: "proposal", n: 5, prob: 0.55 },
      { stage: "booked", n: 5, prob: 0.75 },
      { stage: "in_progress", n: 4, prob: 0.85 },
      { stage: "delivered", n: 3, prob: 0.95 },
      { stage: "won", n: 7, prob: 1 },
      { stage: "lost", n: 3, prob: 0 },
    ];
    const pr = makeRng(now + 7);
    let oppCount = 0;
    for (const sg of STAGES) {
      for (let i = 0; i < sg.n; i++) {
        const a = pick(artists, pr());
        const service = pick([...SERVICES], pr());
        const valueCents = (2 + Math.floor(pr() * 14)) * 100_000; // $2k–$15k
        await ctx.db.insert("opportunities", {
          orgId,
          title: `${cap(service)} — ${a.name}`,
          artistId: a._id as Id<"artists">,
          stage: sg.stage,
          valueCents,
          serviceType: service,
          probability: sg.prob,
          source: TAG,
          updatedAt: now - Math.floor(pr() * 60) * DAY,
        });
        oppCount++;
      }
    }

    return {
      orgId,
      weeks: totalWeeks,
      sessions: sessionCount,
      shifts: shiftCount,
      invoices: invoiceCount,
      opportunities: oppCount,
    };
  },
});
