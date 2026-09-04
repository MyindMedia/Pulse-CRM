import { MutationCtx } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { currentOrgWithCapability } from "./lib/tenant";
import { notify, notifyTeam } from "./lib/notify";
import { money } from "./lib/money";
import { appUrl } from "./lib/links";
import { proposeWaitlistFill } from "./waitlist";
import { createCompletionInvoice } from "./sessions";
import { normalizePhone } from "./lib/phone";
import { renderSms, BALANCE_DUE_SMS } from "./lib/smsTemplates";

/* ============================================================
   Booking automation - runs on a 15-minute cron (see crons.ts)
   and can be triggered on demand from the internal Bookings view.

   Lifecycle automation (hold expiry, forfeiture, auto-progression)
   only ever touches sessions created through the public /book flow
   (`source === "public_booking"`). Internal / seeded sessions are
   never auto-cancelled or auto-advanced - they only receive the
   payment emails (deposit pay link + balance reminder) so clients
   booked by staff can still pay online.
   ============================================================ */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Escalating dunning copy for the overdue-invoice ladder. Distinct,
 *  professional tone per stage; plain hyphens only, no em dashes. Reuses the
 *  same /pay/invoice/<id> pay-link format as the manual reminder. */
function dunningCopy(
  stage: number,
  number: string,
  amount: string,
  dueOn: string,
  payUrl: string,
): { subject: string; body: string } {
  if (stage === 1) {
    return {
      subject: `Reminder: invoice ${number} is past due`,
      body: `Hi there,\n\nJust a friendly reminder that invoice ${number} for ${amount} was due on ${dueOn} and is still open.\n\nPay securely online:\n${payUrl}\n\nIf you have already taken care of this, please disregard this note.`,
    };
  }
  if (stage === 2) {
    return {
      subject: `Second notice: invoice ${number} is past due`,
      body: `Hi there,\n\nOur records show invoice ${number} for ${amount} has been past due since ${dueOn} and remains unpaid. Please arrange payment at your earliest convenience.\n\nPay securely online:\n${payUrl}\n\nIf payment is already on its way, thank you, and please disregard this reminder.`,
    };
  }
  return {
    subject: `Final notice: invoice ${number} is significantly past due`,
    body: `Hi there,\n\nThis is a final notice regarding invoice ${number} for ${amount}, which has been outstanding since ${dueOn} and is now significantly past due. Please settle the balance promptly to keep your account in good standing.\n\nPay securely online:\n${payUrl}\n\nIf you have already paid, please contact us so we can update our records.`,
  };
}

type Outcome = {
  holdsReleased: number;
  remindersSent: number;
  forfeited: number;
  started: number;
  completed: number;
  invoicesOverdue: number;
  reviewRequests: number;
  holdNudges: number;
  staleResolved: number;
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
    invoicesOverdue: 0,
    reviewRequests: 0,
    holdNudges: 0,
    staleResolved: 0,
  };

  const sessions = await ctx.db.query("sessions").collect();
  for (const s of sessions) {
    const isPublic = s.source === "public_booking";
    // max() not sum: ledger deposits set BOTH amountPaidCents and depositPaid,
    // so adding them would double-credit; legacy internal rows may only carry
    // the flag.
    const paid = Math.max(s.amountPaidCents ?? 0, s.depositPaid ? s.depositCents : 0);
    const fullyPaid = paid >= s.rateCents;

    // 0. Stale resolution - anything that ended more than a day ago and was
    //    never closed out leaves the operational board. Paid work (or a
    //    session that actually started) auto-completes; a confirmed booking
    //    with money down that never ran is a no-show; an unpaid hold whose
    //    date passed expires into the archive (cancelled + autoResolved
    //    marker, surfaced on Reports > Archive). Applies to internal AND
    //    public rows - staff-set final statuses are never touched.
    if (
      s.endTime < now - 86_400_000 &&
      (s.status === "tentative" || s.status === "confirmed" || s.status === "in_progress")
    ) {
      if (s.status === "in_progress" || paid > 0) {
        await ctx.db.patch(s._id, { status: "completed", autoResolved: "auto_completed" });
      } else if (s.status === "confirmed") {
        await ctx.db.patch(s._id, { status: "no_show", autoResolved: "auto_no_show" });
      } else {
        await ctx.db.patch(s._id, { status: "cancelled", autoResolved: "expired_hold" });
      }
      out.staleResolved++;
      continue;
    }

    // 1. Deposit pay link - internal bookings with an unpaid deposit get the
    //    public checkout link once, so clients booked by staff can pay online.
    //    (Public bookings already got the link at checkout.) No hold or
    //    forfeit ever applies to internal sessions.
    if (
      !isPublic &&
      (s.status === "tentative" || s.status === "confirmed") &&
      s.depositCents > 0 &&
      !s.depositPaid &&
      s.startTime > now
    ) {
      const priorNotes = await ctx.db
        .query("notifications")
        .withIndex("by_session", (q) => q.eq("sessionId", s._id))
        .collect();
      if (!priorNotes.some((n) => n.kind === "booking.deposit_link")) {
        const email = await emailFor(ctx, s.artistId);
        const org = await ctx.db
          .query("orgs")
          .withIndex("by_org", (q) => q.eq("orgId", s.orgId))
          .first();
        if (email && org?.slug) {
          const payUrl = `${appUrl()}/book/${org.slug}/checkout/${s._id}`;
          await notify(ctx, {
            orgId: s.orgId,
            channel: "email",
            recipient: email,
            subject: `Deposit due - ${s.title}`,
            body: `Your session "${s.title}" is on the calendar. A ${money(Math.min(s.depositCents, s.rateCents))} deposit locks it in.\n\nPay securely online:\n${payUrl}`,
            kind: "booking.deposit_link",
            sessionId: s._id,
          });
          out.remindersSent++;
        }
      }
    }

    // 2. Balance reminder - confirmed, not fully paid, 2-4h out, once.
    //    Applies to public AND internal bookings; includes the pay link.
    if (
      s.status === "confirmed" &&
      !fullyPaid &&
      !s.balanceRemindedAt &&
      s.startTime - now <= 4 * HOUR &&
      s.startTime - now > 2 * HOUR
    ) {
      await ctx.db.patch(s._id, { balanceRemindedAt: now });
      const email = await emailFor(ctx, s.artistId);
      if (email) {
        const org = await ctx.db
          .query("orgs")
          .withIndex("by_org", (q) => q.eq("orgId", s.orgId))
          .first();
        const payLink = org?.slug
          ? `\n\nPay securely online:\n${appUrl()}/book/${org.slug}/checkout/${s._id}`
          : "";
        await notify(ctx, {
          orgId: s.orgId,
          channel: "email",
          recipient: email,
          subject: `Balance due - ${s.title}`,
          body: `Your ${money(s.rateCents - paid)} balance is due before your session. Pay in full at least 2 hours before your start time to keep the booking.${payLink}`,
          kind: "booking.balance_reminder",
          sessionId: s._id,
        });
      }
      // SMS leg of the same reminder - texts convert far better this close to
      // the session. Same dedupe (balanceRemindedAt) covers both channels.
      {
        const artist = await ctx.db.get(s.artistId);
        const cell = artist?.phone ? normalizePhone(artist.phone) : null;
        if (cell) {
          const optedOut = await ctx.db
            .query("smsOptOuts")
            .withIndex("by_phone", (q) => q.eq("phone", cell))
            .first();
          if (!optedOut?.optedOut) {
            const org = await ctx.db
              .query("orgs")
              .withIndex("by_org", (q) => q.eq("orgId", s.orgId))
              .first();
            const link = org?.slug ? `${appUrl()}/book/${org.slug}/checkout/${s._id}` : null;
            await ctx.scheduler.runAfter(0, internal.smsFlows._send, {
              to: cell,
              body: renderSms(BALANCE_DUE_SMS, {
                amount: money(s.rateCents - paid),
                title: s.title,
                studio: org?.name ?? "the studio",
                link,
              }),
            });
          }
        }
      }
      out.remindersSent++;
      continue;
    }

    // 2b. Post-session review request - the growth loop. ~24h after a session
    //     completes, email the client a one-tap link to leave a review. Applies
    //     to BOTH public and internal completed sessions. Sent once per session
    //     (deduped via the notifications log, kind "review.request"). Only fires
    //     for recent completions so a fresh deploy never backfill-spams months of
    //     historical sessions.
    if (
      s.status === "completed" &&
      now - s.endTime >= DAY &&
      now - s.endTime <= 8 * DAY
    ) {
      const priorNotes = await ctx.db
        .query("notifications")
        .withIndex("by_session", (q) => q.eq("sessionId", s._id))
        .collect();
      if (!priorNotes.some((n) => n.kind === "review.request")) {
        const clientEmail = await emailFor(ctx, s.artistId);
        const org = await ctx.db
          .query("orgs")
          .withIndex("by_org", (q) => q.eq("orgId", s.orgId))
          .first();
        if (clientEmail) {
          const reviewUrl = `${appUrl()}/review/${s._id}`;
          const studio = org?.name ?? "the studio";
          await notify(ctx, {
            orgId: s.orgId,
            channel: "email",
            recipient: clientEmail,
            subject: `How was your session at ${studio}?`,
            body: `Thanks for recording "${s.title}" with ${studio}. We would love a quick word on how it went - it takes about 20 seconds and helps other artists find us.\n\nLeave a quick review:\n${reviewUrl}`,
            kind: "review.request",
            sessionId: s._id,
          });
          out.reviewRequests++;
        }
      }
    }

    // Everything below is public-booking lifecycle only: internal sessions
    // are never auto-cancelled, forfeited, or auto-advanced.
    if (!isPublic) continue;
    const email = await emailFor(ctx, s.artistId);

    // 2c. Hold-expiry SMS nudge - a public hold with an unpaid deposit about to
    //     expire (T-15 min) gets one text with the pay link, a last chance to
    //     keep the slot before block 3 releases it. Public-booking only, once
    //     per session (deduped via notifications, kind "booking.hold_nudge"),
    //     and it honors SMS opt-outs.
    if (
      s.status === "tentative" &&
      paid === 0 &&
      s.holdExpiresAt &&
      s.holdExpiresAt > now &&
      s.holdExpiresAt - now <= 15 * 60 * 1000
    ) {
      const artist = await ctx.db.get(s.artistId);
      const phone = artist?.phone ? normalizePhone(artist.phone) : null;
      if (phone) {
        const optOut = await ctx.db
          .query("smsOptOuts")
          .withIndex("by_phone", (q) => q.eq("phone", phone))
          .first();
        if (!optOut?.optedOut) {
          const priorNotes = await ctx.db
            .query("notifications")
            .withIndex("by_session", (q) => q.eq("sessionId", s._id))
            .collect();
          if (!priorNotes.some((n) => n.kind === "booking.hold_nudge")) {
            const org = await ctx.db
              .query("orgs")
              .withIndex("by_org", (q) => q.eq("orgId", s.orgId))
              .first();
            if (org?.slug) {
              const payUrl = `${appUrl()}/book/${org.slug}/checkout/${s._id}`;
              await notify(ctx, {
                orgId: s.orgId,
                channel: "sms",
                recipient: phone,
                subject: "Studio hold expiring",
                body: `${org.name ?? "Studio"}: your hold on "${s.title}" expires soon. Pay the deposit to keep it: ${payUrl}`,
                kind: "booking.hold_nudge",
                sessionId: s._id,
              });
              out.holdNudges++;
            }
          }
        }
      }
    }

    // 3. Hold expiry - an unpaid hold past its window is released.
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
      await notifyTeam(ctx, {
        orgId: s.orgId,
        subject: `Hold released - ${s.title}`,
        body: `The hold on "${s.title}" expired (deposit not paid in time). The slot is open again.`,
        kind: "booking.hold_released",
        sessionId: s._id,
      });
      await proposeWaitlistFill(ctx, s);
      out.holdsReleased++;
      continue;
    }

    // 4. Forfeit - confirmed but not paid in full inside the 2h window.
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
      await notifyTeam(ctx, {
        orgId: s.orgId,
        subject: `Booking forfeited - ${s.title}`,
        body: `"${s.title}" was released: the balance was not paid in full 2 hours before start. The deposit is retained per booking terms.`,
        kind: "booking.forfeited",
        sessionId: s._id,
      });
      await proposeWaitlistFill(ctx, s);
      out.forfeited++;
      continue;
    }

    // 5. Progression - paid bookings advance with the clock.
    if (s.status === "confirmed" && fullyPaid && now >= s.startTime && now < s.endTime) {
      await ctx.db.patch(s._id, { status: "in_progress" });
      out.started++;
      continue;
    }
    if ((s.status === "in_progress" || (s.status === "confirmed" && fullyPaid)) && now >= s.endTime) {
      await ctx.db.patch(s._id, { status: "completed" });
      // Same balance-invoice fan-out as the manual completion path in
      // sessions.setStatus: bill only what is still owed (usually nothing -
      // public bookings reach here fully paid), never double-invoice.
      const invoiceId = await createCompletionInvoice(ctx, s);
      await ctx.db.insert("activity", {
        orgId: s.orgId,
        kind: "session.completed",
        summary: `${s.title} completed${invoiceId ? " - balance invoiced automatically" : ""}`,
        entityType: "session",
        entityId: s._id,
        accent: "positive",
      });
      out.completed++;
    }
  }

  // 6. Overdue dunning ladder - an escalating series of reminders on open
  //    invoices past their due date, replacing the old single-shot email:
  //      Stage 1 (~3 days overdue)  friendly nudge + pay link
  //      Stage 2 (~7 days overdue)  firmer reminder + pay link
  //      Stage 3 (~14 days overdue) final notice (significantly past due)
  //    At most one stage per sweep, each stage at most once (tracked by
  //    invoices.reminderStage), with a >=24h gap between sends. The last-send
  //    time is stamped on overdueNotifiedAt, which is shared with the manual
  //    invoices.sendReminder throttle - so a manual nudge and the auto ladder
  //    never double-email the same client inside 24h. The ladder stops after
  //    stage 3 (it never spams past the final notice).
  const invoices = await ctx.db.query("invoices").collect();
  for (const inv of invoices) {
    const isOpen =
      inv.status === "sent" || inv.status === "viewed" || inv.status === "overdue";
    if (!isOpen || inv.dueDate >= now) continue;

    // Materialize the stored overdue status once (mirrors effectiveStatus in
    // invoices.ts) and drop a single activity marker the first time.
    if (inv.status !== "overdue") {
      await ctx.db.patch(inv._id, { status: "overdue" });
      await ctx.db.insert("activity", {
        orgId: inv.orgId,
        kind: "invoice.overdue",
        summary: `Invoice ${inv.number} is overdue (${money(inv.amountCents)})`,
        entityType: "invoice",
        entityId: inv._id,
        accent: "critical",
      });
    }

    const stageSent = inv.reminderStage ?? 0;
    if (stageSent >= 3) continue; // ladder exhausted - do not spam forever

    const daysOverdue = Math.floor((now - inv.dueDate) / DAY);
    const nextStage = stageSent + 1;
    const thresholdDays = nextStage === 1 ? 3 : nextStage === 2 ? 7 : 14;
    if (daysOverdue < thresholdDays) continue; // next stage not due yet

    // Min-gap: never send within 24h of the last send (auto OR manual nudge).
    if (inv.overdueNotifiedAt && now - inv.overdueNotifiedAt < DAY) continue;

    const artist = await ctx.db.get(inv.artistId);
    if (!artist?.email) continue; // nothing to send - leave the stage unbumped

    const payUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/pay/invoice/${inv._id}`;
    const dueOn = new Date(inv.dueDate).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    });
    const copy = dunningCopy(nextStage, inv.number, money(inv.amountCents), dueOn, payUrl);

    // Bump the stage + stamp the send time before emailing so a re-entrant
    // sweep can never double-send the same stage.
    await ctx.db.patch(inv._id, { reminderStage: nextStage, overdueNotifiedAt: now });
    await notify(ctx, {
      orgId: inv.orgId,
      channel: "email",
      recipient: artist.email,
      subject: copy.subject,
      body: copy.body,
      kind: "invoice.dunning",
    });
    await ctx.db.insert("activity", {
      orgId: inv.orgId,
      kind: "invoice.dunning",
      summary: `Overdue reminder ${nextStage}/3 sent for invoice ${inv.number} (${money(inv.amountCents)})`,
      entityType: "invoice",
      entityId: inv._id,
      accent: nextStage === 3 ? "critical" : "info",
    });
    await notifyTeam(ctx, {
      orgId: inv.orgId,
      subject: `Overdue reminder ${nextStage}/3 sent - ${inv.number} (${money(inv.amountCents)})`,
      body: `${artist.name ?? "A client"}'s invoice ${inv.number} for ${money(inv.amountCents)} is ${daysOverdue} days past due. Auto-reminder stage ${nextStage} of 3 was just sent with the payment link.`,
      kind: "invoice.dunning",
    });
    out.invoicesOverdue++;
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
    await ctx.scheduler.runAfter(0, internal.agent.sweepDigests, {});
    await ctx.scheduler.runAfter(0, internal.agentAutomations.sweep, {});
  },
});

/** Manual trigger - the internal Bookings view exposes this as a button. Gated
 *  to owner/manager (it fires outbound automation across the studio). */
export const runNow = mutation({
  args: {},
  handler: async (ctx) => {
    await currentOrgWithCapability(ctx, "ops.autonomy.manage");
    return runAutomation(ctx);
  },
});
