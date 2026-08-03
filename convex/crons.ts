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

// Team-device push alerts: T-10 arrival / wrap-up / shift change and
// end-of-session studio refresh. Only orgs with registered devices are
// scanned; the pushAlerts ledger dedupes; sends no-op until VAPID keys set.
crons.interval("t10-device-alerts", { minutes: 1 }, internal.pushAlerts.sweep, {});

// Outbound SMS reminders: scan every active org for sessions due a 24h/2h
// reminder and text the client + booked engineer. Opt-out aware, per-org
// smsRemindersEnabled toggle, deduped via session.smsRemindersSent. Runs in
// "simulated" mode until a provider (Twilio) is configured.
crons.interval("sms-reminders", { minutes: 15 }, internal.sms.sendDueReminders);

// Timeclock SMS checks: the 8h overtime confirm and the 4h intern
// permission flow, plus the no-answer caps and manager escalations.
crons.interval("timeclock-sms", { minutes: 15 }, internal.smsFlows.sweepTimeclock);

// SMS lifecycle: offer freed slots to the waitlist (CLAIM) and request a 1-5
// rating after completed sessions.
crons.interval("sms-lifecycle", { minutes: 15 }, internal.smsFlows.sweepLifecycle);

// Owner daily digest: hourly sweep, texts owners at 8am org-local on days
// with sessions or payroll flags. Deduped via org.smsDigestLastSent.
crons.interval("sms-daily-digest", { minutes: 60 }, internal.smsFlows.sweepDailyDigest);

// Email reminders - the channel that works today (Resend). Sessions: client +
// engineer at 24h and 2h. Staff shifts: 24h before. Idempotent per entity.
crons.interval("email-reminders", { minutes: 30 }, internal.reminders.sweep, {});

// A2P 10DLC finisher retired 2026-08-02: SMS moved to the GHL number (already
// A2P-registered); the Twilio campaign + resubmit kit are parked in scripts/.

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

// Keep the demo/pitch accounts pitch-ready. The seeds are relative to "now"
// and one leaves an engineer clocked in, so both drift stale within days -
// twice now a demo has been opened on inflated payroll and an empty calendar.
// Nightly, before anyone is awake to demo.
crons.daily("demo-refresh", { hourUTC: 8, minuteUTC: 30 }, internal.demoRefresh.refreshAll);

export default crons;
