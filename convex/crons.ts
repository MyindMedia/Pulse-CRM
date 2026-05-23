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

export default crons;
