/* ============================================================
   Category guardrails + forward-looking risk detection.

   Pure, V8-safe predicates - one set per operational category the
   owner named: pipeline, songs, split sheets, studio scheduling, staff
   scheduling. Each detector takes plain, already-org-scoped data and
   returns RiskFlag rows. Because these are pure functions over data the
   caller already loaded for ONE org, they cannot cross a tenant
   boundary, and they are fully unit-testable.

   Two jobs:
     1. SAFEGUARDS - hard predicates the rest of the app can call before
        a risky action (e.g. isReleasable() gates a song release on an
        executed split sheet). These prevent the problem.
     2. DETECTORS - scan the studio's live state and surface problems
        BEFORE they bite (stale pipeline, stuck songs, double-bookings,
        overtime, single-engineer dependency).

   The risk module (convex/risk.ts) loads the org-scoped data, runs
   these detectors, auto-posts critical flags as internal insights, and
   feeds the actionable ones into the opsActions inbox as note_only
   `studio_risk` proposals (so nothing client-facing fires without
   human approval).
   ============================================================ */

const DAY = 86_400_000;

export type RiskCategory = "pipeline" | "songs" | "splitsheets" | "studio_scheduling" | "staff_scheduling";
export type RiskSeverity = "info" | "warning" | "critical";

export type RiskFlag = {
  category: RiskCategory;
  severity: RiskSeverity;
  /** Stable per-entity key; combined with category for dedupe. */
  key: string;
  title: string;
  detail: string;
  entityType?: string;
  entityId?: string;
};

/* Tunables - kept here so the whole risk posture moves from one place. */
export const STALE_OPP_DAYS = 30; // no activity => stale, exclude from coverage
export const PROVE_OPP_DAYS = 14; // no activity => prove it is alive
export const SONG_STUCK_DAYS = 21; // active song with no movement
export const UNSTAFFED_HORIZON = 2 * DAY; // confirmed session this soon with no engineer
export const OVERTIME_HOURS_PER_WEEK = 45; // staffed hours in any rolling 7-day window
export const SPOF_SHARE = 0.6; // one engineer carrying > this share of upcoming staffed hours
export const SPOF_MIN_HOURS = 20; // ...only flag once there is a meaningful amount of work

/* ----------------------------------------------------------------
   SAFEGUARD: split-sheet release gate. The single hardest rule -
   never let a song be treated as releasable without executed splits.
   ---------------------------------------------------------------- */
const NEAR_RELEASE = new Set(["mastering", "delivered", "released"]);

/** True only when a song at/after mastering has a fully executed split sheet.
 *  Songs before mastering are not yet gated. Use to block release actions. */
export function isReleasable(stage: string, splitStatus: string | undefined): boolean {
  if (!NEAR_RELEASE.has(stage)) return true;
  return splitStatus === "fully_executed";
}

export type SongLite = { id: string; title: string; stage: string; splitStatus?: string; updatedAt: number; deadline?: number };

/** splitsheets category: any near-release song missing executed splits. */
export function splitSheetRisks(songs: SongLite[]): RiskFlag[] {
  return songs
    .filter((s) => !isReleasable(s.stage, s.splitStatus))
    .map((s) => ({
      category: "splitsheets" as const,
      severity: "critical" as const,
      key: `split:${s.id}`,
      title: `Splits not executed - ${s.title}`,
      detail: `"${s.title}" is at ${s.stage} but its split sheet is ${s.splitStatus ?? "missing"}. Releasing without executed splits freezes royalties and invites takedowns. Lock every contributor's split before this ships.`,
      entityType: "song",
      entityId: s.id,
    }));
}

/* ----------------------------------------------------------------
   pipeline category
   ---------------------------------------------------------------- */
export type OppLite = { id: string; title: string; stage: string; valueCents: number; probability: number; updatedAt: number };

export function pipelineRisks(opps: OppLite[], now: number): RiskFlag[] {
  const out: RiskFlag[] = [];
  const open = opps.filter((o) => o.stage !== "won" && o.stage !== "lost");
  for (const o of open) {
    const ageDays = (now - o.updatedAt) / DAY;
    if (ageDays >= STALE_OPP_DAYS) {
      out.push({
        category: "pipeline",
        severity: "warning",
        key: `stale:${o.id}`,
        title: `Stale deal - ${o.title}`,
        detail: `No movement on "${o.title}" in ${Math.round(ageDays)} days. Deals this cold rarely close - re-engage now or mark it lost so your pipeline reflects reality.`,
        entityType: "opportunity",
        entityId: o.id,
      });
    }
    // Over-promised: high stated probability but still parked in an early stage
    // and going cold. The forecast is lying.
    if (o.probability >= 0.7 && (o.stage === "inquiry" || o.stage === "qualified") && ageDays >= PROVE_OPP_DAYS) {
      out.push({
        category: "pipeline",
        severity: "info",
        key: `overpromise:${o.id}`,
        title: `Forecast risk - ${o.title}`,
        detail: `"${o.title}" is marked ${Math.round(o.probability * 100)}% likely but is still in ${o.stage} with no activity in ${Math.round(ageDays)} days. Advance it or lower the probability so the forecast is honest.`,
        entityType: "opportunity",
        entityId: o.id,
      });
    }
  }
  return out;
}

/* ----------------------------------------------------------------
   songs category
   ---------------------------------------------------------------- */
export function songRisks(songs: SongLite[], now: number): RiskFlag[] {
  const out: RiskFlag[] = [];
  for (const s of songs) {
    if (s.stage === "delivered" || s.stage === "released") continue;
    if (s.deadline && s.deadline < now) {
      out.push({
        category: "songs",
        severity: "warning",
        key: `overdue:${s.id}`,
        title: `Past deadline - ${s.title}`,
        detail: `"${s.title}" is still at ${s.stage} but its deadline has passed. Reset expectations with the client or push it to delivery.`,
        entityType: "song",
        entityId: s.id,
      });
      continue;
    }
    const idleDays = (now - s.updatedAt) / DAY;
    if (idleDays >= SONG_STUCK_DAYS) {
      out.push({
        category: "songs",
        severity: "info",
        key: `stuck:${s.id}`,
        title: `Stalled project - ${s.title}`,
        detail: `"${s.title}" has not moved from ${s.stage} in ${Math.round(idleDays)} days. Stalled projects tie up capacity and erode client momentum - nudge it forward or close it out.`,
        entityType: "song",
        entityId: s.id,
      });
    }
  }
  return out;
}

/* ----------------------------------------------------------------
   studio_scheduling category
   ---------------------------------------------------------------- */
export type SessionLite = {
  id: string;
  title: string;
  roomId?: string;
  engineerId?: string;
  startTime: number;
  endTime: number;
  status: string;
};

const LIVE_SESSION = new Set(["tentative", "confirmed", "in_progress"]);

export function studioScheduleRisks(sessions: SessionLite[], now: number): RiskFlag[] {
  const out: RiskFlag[] = [];

  // Double-booking: two live sessions overlapping in the same room.
  const byRoom = new Map<string, SessionLite[]>();
  for (const s of sessions) {
    if (!s.roomId || !LIVE_SESSION.has(s.status) || s.endTime <= now) continue;
    const list = byRoom.get(s.roomId) ?? [];
    list.push(s);
    byRoom.set(s.roomId, list);
  }
  for (const [roomId, list] of byRoom) {
    list.sort((a, b) => a.startTime - b.startTime);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      if (cur.startTime < prev.endTime) {
        out.push({
          category: "studio_scheduling",
          severity: "critical",
          key: `dbl:${roomId}:${prev.id}:${cur.id}`,
          title: `Double-booked room - ${cur.title}`,
          detail: `"${prev.title}" and "${cur.title}" overlap in the same room. Move one before both clients arrive to the same door.`,
          entityType: "session",
          entityId: cur.id,
        });
      }
    }
  }

  // Confirmed session starting soon with no engineer assigned.
  for (const s of sessions) {
    if (s.status !== "confirmed") continue;
    if (s.startTime <= now || s.startTime > now + UNSTAFFED_HORIZON) continue;
    if (!s.engineerId) {
      out.push({
        category: "studio_scheduling",
        severity: "warning",
        key: `unstaffed:${s.id}`,
        title: `No engineer assigned - ${s.title}`,
        detail: `"${s.title}" is confirmed within ${Math.round(UNSTAFFED_HORIZON / DAY)} days but has no engineer on it. Assign someone or the room runs the session unstaffed.`,
        entityType: "session",
        entityId: s.id,
      });
    }
  }
  return out;
}

/* ----------------------------------------------------------------
   staff_scheduling category
   ---------------------------------------------------------------- */
export type ShiftLite = { id: string; memberId: string; startTime: number; endTime: number; status: string };
export type MemberLite = { id: string; name: string };
export type AvailabilityLite = { memberId: string; weekday: number; startMinutes: number; endMinutes: number };
export type TimeOffLite = { memberId: string; startTime: number; endTime: number; status: string };

function hours(a: number, b: number): number {
  return Math.max(0, b - a) / 3_600_000;
}

export function staffScheduleRisks(
  shifts: ShiftLite[],
  members: MemberLite[],
  availability: AvailabilityLite[],
  timeOff: TimeOffLite[],
  now: number,
): RiskFlag[] {
  const out: RiskFlag[] = [];
  const nameOf = new Map(members.map((m) => [m.id, m.name] as const));
  const upcoming = shifts.filter((s) => s.status !== "cancelled" && s.endTime > now);

  // Overtime: staffed hours in any rolling 7-day window per member.
  const byMember = new Map<string, ShiftLite[]>();
  for (const s of upcoming) {
    const list = byMember.get(s.memberId) ?? [];
    list.push(s);
    byMember.set(s.memberId, list);
  }
  const totalUpcomingHoursByMember = new Map<string, number>();
  for (const [memberId, list] of byMember) {
    list.sort((a, b) => a.startTime - b.startTime);
    let total = 0;
    for (const s of list) total += hours(s.startTime, s.endTime);
    totalUpcomingHoursByMember.set(memberId, total);

    // Rolling 7-day overtime: for each shift, sum hours in [start, start+7d).
    let flagged = false;
    for (let i = 0; i < list.length && !flagged; i++) {
      const windowEnd = list[i].startTime + 7 * DAY;
      let wHours = 0;
      for (let j = i; j < list.length && list[j].startTime < windowEnd; j++) {
        wHours += hours(list[j].startTime, list[j].endTime);
      }
      if (wHours > OVERTIME_HOURS_PER_WEEK) {
        out.push({
          category: "staff_scheduling",
          severity: "warning",
          key: `ot:${memberId}`,
          title: `Overtime risk - ${nameOf.get(memberId) ?? "staff"}`,
          detail: `${nameOf.get(memberId) ?? "This teammate"} is scheduled for ${Math.round(wHours)}h in a 7-day stretch (over ${OVERTIME_HOURS_PER_WEEK}h). Sustained overtime burns people out and drops quality - spread the load.`,
          entityType: "member",
          entityId: memberId,
        });
        flagged = true;
      }
    }
  }

  // Shift during approved time-off (conflict).
  const approvedOff = timeOff.filter((t) => t.status === "approved");
  for (const s of upcoming) {
    const clash = approvedOff.find((t) => t.memberId === s.memberId && s.startTime < t.endTime && s.endTime > t.startTime);
    if (clash) {
      out.push({
        category: "staff_scheduling",
        severity: "warning",
        key: `offclash:${s.id}`,
        title: `Shift during time-off - ${nameOf.get(s.memberId) ?? "staff"}`,
        detail: `${nameOf.get(s.memberId) ?? "A teammate"} has a shift that overlaps approved time-off. Reassign it before they no-show.`,
        entityType: "shift",
        entityId: s.id,
      });
    }
  }

  // Single point of failure: one engineer carrying most of the upcoming load.
  const grand = Array.from(totalUpcomingHoursByMember.values()).reduce((a, b) => a + b, 0);
  if (grand >= SPOF_MIN_HOURS && totalUpcomingHoursByMember.size >= 2) {
    for (const [memberId, h] of totalUpcomingHoursByMember) {
      if (h / grand > SPOF_SHARE) {
        out.push({
          category: "staff_scheduling",
          severity: "info",
          key: `spof:${memberId}`,
          title: `Single-engineer dependency - ${nameOf.get(memberId) ?? "staff"}`,
          detail: `${nameOf.get(memberId) ?? "One engineer"} is carrying ${Math.round((h / grand) * 100)}% of upcoming staffed hours. If they are out, the studio stalls - cross-train and spread bookings.`,
          entityType: "member",
          entityId: memberId,
        });
      }
    }
  }

  return out;
}

/** Run every category detector and return all flags, worst first. */
export function allRiskFlags(input: {
  now: number;
  songs: SongLite[];
  opps: OppLite[];
  sessions: SessionLite[];
  shifts: ShiftLite[];
  members: MemberLite[];
  availability: AvailabilityLite[];
  timeOff: TimeOffLite[];
}): RiskFlag[] {
  const flags = [
    ...splitSheetRisks(input.songs),
    ...pipelineRisks(input.opps, input.now),
    ...songRisks(input.songs, input.now),
    ...studioScheduleRisks(input.sessions, input.now),
    ...staffScheduleRisks(input.shifts, input.members, input.availability, input.timeOff, input.now),
  ];
  const sev: Record<RiskSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return flags.sort((a, b) => sev[a.severity] - sev[b.severity]);
}
