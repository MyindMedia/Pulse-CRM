import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { notify } from "./lib/notify";

/* ============================================================
   Email reminders - the channel that works TODAY (Resend is live;
   SMS reminders stay simulated until Twilio A2P clears).
   - Booked sessions: client (artist email) + assigned engineer get a
     24h-before and a 2h-before reminder (mirrors the SMS windows).
   - Staff schedules: teammates get a reminder 24h before a
     "scheduled"-kind shift (session-kind shifts are covered by the
     session reminder to the engineer).
   Idempotent via per-entity sent markers; swept every 30 minutes.
   All bodies deliver through the branded studio-framed layout.
   ============================================================ */

const DAY = 86_400_000;
const TWO_HOURS = 2 * 3_600_000;

function whenLabel(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const sweep = internalMutation({
  args: { nowMs: v.optional(v.number()) },
  handler: async (ctx, { nowMs }) => {
    const now = nowMs ?? Date.now();
    const orgs = await ctx.db.query("orgs").collect();
    let sent = 0;

    for (const org of orgs) {
      if (org.status === "paused") continue;
      const orgId = org.orgId;
      const studio = org.name ?? "Your studio";

      // ── Session reminders (client + engineer) ──
      const sessions = await ctx.db
        .query("sessions")
        .withIndex("by_org_start", (q) =>
          q.eq("orgId", orgId).gt("startTime", now).lt("startTime", now + DAY + TWO_HOURS),
        )
        .collect();

      for (const s of sessions) {
        if (s.status !== "tentative" && s.status !== "confirmed") continue;
        const already = s.emailRemindersSent ?? [];
        const ms = s.startTime - now;
        let kind: "24h" | "2h" | null = null;
        if (ms <= TWO_HOURS && !already.includes("2h")) kind = "2h";
        else if (ms <= DAY && ms > TWO_HOURS && !already.includes("24h")) kind = "24h";
        if (!kind) continue;

        const soon = kind === "2h" ? "in about 2 hours" : "tomorrow";
        const when = whenLabel(s.startTime);
        const room = s.roomId ? await ctx.db.get(s.roomId) : null;
        const where = room?.name ? ` in ${room.name}` : "";

        const artist = await ctx.db.get(s.artistId);
        if (artist?.email) {
          await notify(ctx, {
            orgId,
            channel: "email",
            recipient: artist.email,
            subject: `Reminder: your session at ${studio} ${kind === "2h" ? "starts soon" : "is tomorrow"}`,
            body: `Hi ${artist.name},\n\nThis is a reminder that your session starts ${soon}${where}.\n\n${when}\n\nSee you then! Reply to this email if you need to reschedule.`,
            kind: `session.reminder_${kind}`,
            sessionId: s._id,
          });
          sent++;
        }
        if (s.engineerId) {
          const eng = await ctx.db.get(s.engineerId);
          if (eng?.email) {
            await notify(ctx, {
              orgId,
              channel: "email",
              recipient: eng.email,
              subject: `Reminder: you're on ${s.title} ${kind === "2h" ? "soon" : "tomorrow"}`,
              body: `${eng.name}, you're the engineer on "${s.title}" starting ${soon}${where}.\n\n${when}`,
              kind: `session.reminder_${kind}`,
              sessionId: s._id,
            });
            sent++;
          }
        }
        await ctx.db.patch(s._id, { emailRemindersSent: [...already, kind] });
      }

      // ── Staff schedule reminders (24h before scheduled shifts) ──
      const shifts = await ctx.db
        .query("shifts")
        .withIndex("by_org_start", (q) =>
          q.eq("orgId", orgId).gt("startTime", now).lt("startTime", now + DAY),
        )
        .collect();

      for (const sh of shifts) {
        if (sh.status === "cancelled" || sh.kind !== "scheduled") continue;
        if (sh.reminderSentAt) continue;
        const member = await ctx.db.get(sh.memberId);
        if (!member?.email) {
          // Mark anyway so a member without email doesn't re-scan every sweep.
          await ctx.db.patch(sh._id, { reminderSentAt: now });
          continue;
        }
        const room = sh.roomId ? await ctx.db.get(sh.roomId) : null;
        const where = room?.name ? ` in ${room.name}` : "";
        await notify(ctx, {
          orgId,
          channel: "email",
          recipient: member.email,
          subject: `Reminder: you're on the ${studio} schedule tomorrow`,
          body: `${member.name}, you have a shift coming up${where}.\n\n${whenLabel(sh.startTime)} to ${new Date(sh.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}\n\nSee the full schedule in Pulse.`,
          kind: "shift.reminder_24h",
        });
        await ctx.db.patch(sh._id, { reminderSentAt: now });
        sent++;
      }
    }
    return { sent };
  },
});
