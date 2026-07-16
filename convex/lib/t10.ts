/* Pure T-10 alert computation for the every-minute device-alert sweep.
   Given the org's near-term sessions and shifts, emit the alerts due THIS
   tick. Windows are 2 minutes wide (the cron runs every minute) - the
   pushAlerts dedupe ledger absorbs any overlap double-fire. */

export type T10Session = {
  _id: string;
  startTime: number;
  endTime: number;
  status: string;
  artistName: string;
  roomName: string | null;
  /** Next booking in the same room within 2h of this one's end. */
  nextInRoom?: { artistName: string; startTime: number } | null;
};

export type T10Shift = {
  _id: string;
  startTime: number;
  status: string;
  memberName: string;
};

export type T10Alert = { key: string; title: string; body: string; url: string };

const MIN = 60_000;

function clock(ts: number, tz: string): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}

function inWindow(ts: number, from: number, to: number): boolean {
  return ts >= from && ts < to;
}

export function computeT10Alerts(
  now: number,
  sessions: T10Session[],
  shifts: T10Shift[],
  tz = "America/New_York",
): T10Alert[] {
  const alerts: T10Alert[] = [];
  const t10From = now + 9 * MIN;
  const t10To = now + 11 * MIN;
  const t15From = now + 14 * MIN;
  const t15To = now + 16 * MIN;

  for (const s of sessions) {
    const room = s.roomName ? ` - ${s.roomName}` : "";
    // Next event: pre-session brief 15 minutes before start.
    if (
      (s.status === "confirmed" || s.status === "tentative") &&
      inWindow(s.startTime, t15From, t15To)
    ) {
      alerts.push({
        key: `b15:${s._id}`,
        title: "Pre-session brief - 15 minutes out",
        body: `${s.artistName} at ${clock(s.startTime, tz)}${room}. Open the brief and run prep.`,
        url: `/brief/${s._id}`,
      });
    }
    // Session ends in ~10 minutes: start the wrap-up.
    if (
      (s.status === "in_progress" || s.status === "confirmed") &&
      inWindow(s.endTime, t10From, t10To)
    ) {
      alerts.push({
        key: `w10:${s._id}`,
        title: "Wrap-up in 10 minutes",
        body: `${s.artistName} ends at ${clock(s.endTime, tz)}${room}. Files, billing, gear, notes.`,
        url: `/brief/${s._id}#wrap`,
      });
    }
    // Session just ended with another booking behind it: studio refresh now.
    if (s.nextInRoom && inWindow(s.endTime, now - 2 * MIN, now)) {
      alerts.push({
        key: `r:${s._id}`,
        title: "Studio refresh",
        body: `${s.roomName ?? "The room"} turns over for ${s.nextInRoom.artistName} at ${clock(s.nextInRoom.startTime, tz)}. Reset and stage now.`,
        url: `/brief/${s._id}#wrap`,
      });
    }
  }

  for (const sh of shifts) {
    if (sh.status !== "cancelled" && inWindow(sh.startTime, t10From, t10To)) {
      alerts.push({
        key: `s10:${sh._id}`,
        title: "Shift change in 10 minutes",
        body: `${sh.memberName} starts at ${clock(sh.startTime, tz)}.`,
        url: "/schedule",
      });
    }
  }

  return alerts;
}
