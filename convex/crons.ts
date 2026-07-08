/* ============================================================
   Scheduled jobs - the operational heartbeat.

   Everything that should run unattended across all subaccounts is
   registered here. The booking automation and room-status recompute
   are deterministic and already iterate every org; the AI fan-outs
   schedule one per-org generator per active subaccount.
   ============================================================ */
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Deterministic booking lifecycle: hold release, balance reminders,
// forfeit, session progression. Already all-org safe.
crons.interval("booking-automation", { minutes: 15 }, internal.automation.tick);

// Recompute every room's auto status from the live calendar.
crons.interval("room-status", { minutes: 15 }, internal.maintenance.recomputeAllRoomStatuses);

// Outbound SMS reminders: scan every active org for sessions due a 24h/2h
// reminder and text the client + booked engineer. Opt-out aware, per-org
// smsRemindersEnabled toggle, deduped via session.smsRemindersSent. Runs in
// "simulated" mode until a provider (Twilio) is configured.
crons.interval("sms-reminders", { minutes: 15 }, internal.sms.sendDueReminders);

// Email reminders - the channel that works today (Resend). Sessions: client +
// engineer at 24h and 2h. Staff shifts: 24h before. Idempotent per entity.
crons.interval("email-reminders", { minutes: 30 }, internal.reminders.sweep, {});

// Cloud-side A2P 10DLC finisher: polls the Standard A2P profile, registers the
// brand once approved, then creates the campaign - so registration completes
// without a local terminal. Idempotent; no-ops once the campaign exists.
crons.interval("a2p-finish", { minutes: 10 }, internal.twilioA2P.advance);

// Inbound Google Calendar sync: pull every connected studio's primary calendar
// into busy blocks (incremental via syncToken). The read half of two-way sync.
crons.interval("google-calendar-pull", { minutes: 10 }, internal.googleCalendarSync.pullAllOrgs);

// Ops brain: per-org operational scan that proposes/auto-executes actions.
crons.daily("ops-brain", { hourUTC: 13, minuteUTC: 0 }, internal.opsBrain.scanAllOrgs);

// Named AI agents (booking conversion, session prep, post-session recap,
// revision triage, no-show risk, ...): time-sensitive, so run every 2h.
// Shares scanOrg with the daily sweep; dedupe keeps it from duplicating rows.
crons.interval("ai-agents-scan", { hours: 2 }, internal.opsBrain.scanAgentsAllOrgs);

// Monday-morning AI artifacts across every active subaccount.
crons.weekly(
  "weekly-briefing",
  { dayOfWeek: "monday", hourUTC: 13, minuteUTC: 0 },
  internal.aiActions.runWeeklyForAllOrgs,
);
crons.weekly(
  "rate-cut-sweep",
  { dayOfWeek: "monday", hourUTC: 13, minuteUTC: 5 },
  internal.aiActions.runRateCutForAllOrgs,
);

// Monthly "Recovered by Pulse" recap: on the 1st, email each org owner what
// Pulse recovered for them last month (forfeited deposits, no-show fees,
// waitlist backfills, reminder-driven payments). Fires once, skips $0 orgs,
// and self-guards against double-sends. The renewal-proof ROI number.
crons.monthly(
  "recovery-recap",
  { day: 1, hourUTC: 14, minuteUTC: 0 },
  internal.recoveryRecap.runMonthly,
);

export default crons;
