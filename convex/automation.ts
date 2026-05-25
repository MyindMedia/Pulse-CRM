import { mutation, internalMutation, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { notify } from "./lib/notify";
import { money } from "./lib/money";

/* ============================================================
   Booking automation - runs on a 15-minute cron (see crons.ts)
   and can be triggered on demand from the internal Bookings view.

   It only ever touches sessions created through the public /book
   flow (`source === "public_booking"`). Internal / seeded sessions
   are never auto-cancelled or auto-advanced.
   ============================================================ */

const HOUR = 3_600_000;

type Outcome = {
  holdsReleased: number;
  remindersSent: number;
  forfeited: number;
  started: number;
  completed: number;
};

async function emailFor(ctx: MutationCtx, artistId: import("./_generated/dataModel").Id<"artists">) {
  const artist = await ctx.db.get(artistId);
  return artist?.email ?? null;
}

export async function runAutomation(ctx: MutationCtx): Promise<Outcome> {
  const now = Date.now();
  const out: Outcome = {
    holdsReleased: 0,
    remindersSent: 0,
    forfeited: 0,
    started: 0,
    completed: 0,
  };

  const sessions = await ctx.db.query("sessions").collect();
  for (const s of sessions) {
    if (s.source !== "public_booking") continue;
    const paid = s.amountPaidCents ?? 0;
    const fullyPaid = paid >= s.rateCents;
    const email = await emailFor(ctx, s.artistId);

    // 1. Hold expiry - an unpaid hold past its window is released.
    if (s.status === "tentative" && paid === 0 && s.holdExpiresAt && s.holdExpiresAt < now) {
      await ctx.db.patch(s._id, { status: "cancelled" });
      await ctx.db.insert("activity", {
        orgId: s.orgId,
        kind: "booking.hold_released",
        summary: `Hold released - ${s.title} (deposit not paid in time)`,
        entityType: "session",
        entityId: s._id,
        accent: "critical",
      });
      if (email) {
        await notify(ctx, {
          orgId: s.orgId,
          channel: "email",
          recipient: email,
          subject: `Hold released - ${s.title}`,
          body: "Your hold expired because the deposit was not paid in time. The slot is open again if you would still like it.",
          kind: "booking.hold_released",
          sessionId: s._id,
        });
      }
      out.holdsReleased++;
      continue;
    }

    // 2. Balance reminder - confirmed, not fully paid, 2-4h out, once.
    if (
      s.status === "confirmed" &&
      !fullyPaid &&
      !s.balanceRemindedAt &&
      s.startTime - now <= 4 * HOUR &&
      s.startTime - now > 2 * HOUR
    ) {
      await ctx.db.patch(s._id, { balanceRemindedAt: now });
      if (email) {
        await notify(ctx, {
          orgId: s.orgId,
          channel: "email",
          recipient: email,
          subject: `Balance due - ${s.title}`,
          body: `Your ${money(s.rateCents - paid)} balance is due before your session. Pay in full at least 2 hours before your start time to keep the booking.`,
          kind: "booking.balance_reminder",
          sessionId: s._id,
        });
      }
      out.remindersSent++;
      continue;
    }

    // 3. Forfeit - confirmed but not paid in full inside the 2h window.
    if (
      s.status === "confirmed" &&
      !fullyPaid &&
      now >= s.startTime - 2 * HOUR &&
      now < s.startTime
    ) {
      await ctx.db.patch(s._id, { status: "cancelled" });
      await ctx.db.insert("activity", {
        orgId: s.orgId,
        kind: "booking.forfeited",
        summary: `Booking forfeited - ${s.title} (balance unpaid 2h before start)`,
        entityType: "session",
        entityId: s._id,
        accent: "critical",
      });
      if (email) {
        await notify(ctx, {
          orgId: s.orgId,
          channel: "email",
          recipient: email,
          subject: `Booking cancelled - ${s.title}`,
          body: "The balance was not paid in full 2 hours before the session, so the booking was released. The deposit is non-refundable per the booking terms.",
          kind: "booking.forfeited",
          sessionId: s._id,
        });
      }
      out.forfeited++;
      continue;
    }

    // 4. Progression - paid bookings advance with the clock.
    if (s.status === "confirmed" && fullyPaid && now >= s.startTime && now < s.endTime) {
      await ctx.db.patch(s._id, { status: "in_progress" });
      out.started++;
      continue;
    }
    if ((s.status === "in_progress" || (s.status === "confirmed" && fullyPaid)) && now >= s.endTime) {
      await ctx.db.patch(s._id, { status: "completed" });
      await ctx.db.insert("activity", {
        orgId: s.orgId,
        kind: "session.completed",
        summary: `${s.title} completed`,
        entityType: "session",
        entityId: s._id,
        accent: "positive",
      });
      out.completed++;
    }
  }
  return out;
}

/** Cron entry point - every 15 minutes (see crons.ts). Also kicks the SMS
 *  session-reminder sweep (an action - scheduled from here so reminders ride
 *  the existing 15-min cadence without a separate cron entry). */
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    await runAutomation(ctx);
    await ctx.scheduler.runAfter(0, internal.sms.sendDueReminders, {});
  },
});

/** Manual trigger - the internal Bookings view exposes this as a button. */
export const runNow = mutation({
  args: {},
  handler: async (ctx) => runAutomation(ctx),
});
