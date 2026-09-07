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
  /** Who to tell, when the alert is about one person rather than the crew. */
  clerkUserId?: string | null;
  /** Whether that person's clock is running right now. */
  clockedIn?: boolean;
};

export type T10Alert = {
  key: string;
  title: string;
  body: string;
  url: string;
  /* Who the alert is FOR.
   *
   * Absent means the crew on shift, which is right for "the room turns over in
   * ten minutes". A shift alert is not that: telling the whole studio that one
   * engineer has not clocked in is a way to make everybody ignore alerts. */
  clerkUserIds?: string[];
  /* Whether `clerkUserIds` is the only permissible audience.
   *
   * Both transports otherwise fall back to the whole studio when the named
   * people have no registered device - sensible for a crew alert, and the exact
   * wrong answer for "you have not clocked in", which would then be read by
   * everyone except the person it is about. */
  strictAudience?: boolean;
};

const MIN = 60_000;

/* The two alerts the iPhone app raises on its own.
 *
 * "Your shift starts in 10 minutes" and "you're on the schedule and not
 * clocked in" are about one person and are computed from that person's own
 * rota, which their phone holds in its mirror. The app schedules both as local
 * notifications so they fire in a basement with no signal. A device that has
 * said so (`apnsDevices.localClock`) must not also be pushed them, or every
 * shift opens with the same words twice. Crew alerts - the brief, the wrap,
 * the room turnover - are the studio's to send and still go to every phone. */
export function phoneSchedulesItself(tag: string | undefined): boolean {
  if (!tag) return false;
  return tag.startsWith("you10:") || tag.startsWith("nc:");
}

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
    if (sh.status === "cancelled") continue;
    const mine = sh.clerkUserId ? [sh.clerkUserId] : undefined;

    if (inWindow(sh.startTime, t10From, t10To)) {
      // The crew's version: who is coming on.
      alerts.push({
        key: `s10:${sh._id}`,
        title: "Shift change in 10 minutes",
        body: `${sh.memberName} starts at ${clock(sh.startTime, tz)}.`,
        url: "/schedule",
      });
      // And the personal one, which is the only one that reaches the phone in
      // somebody's pocket on their way in.
      if (mine) {
        alerts.push({
          key: `you10:${sh._id}`,
          title: "Your shift starts in 10 minutes",
          body: `On at ${clock(sh.startTime, tz)}. Clock in when you get there.`,
          url: "/shift",
          clerkUserIds: mine,
          strictAudience: true,
        });
      }
    }

    /* Scheduled, started, and no clock running.
     *
     * The commonest way a studio loses a payroll record is nobody noticing at
     * the time: the shift is worked, the clock was never started, and it is
     * reconstructed from memory a fortnight later. Ten minutes in is early
     * enough to be a nudge rather than an accusation, and late enough that
     * somebody walking in the door is not pinged for being thirty seconds
     * behind.
     *
     * Only ever sent to the person themselves. A manager alert for this belongs
     * to a different decision - it is a performance conversation, not a
     * reminder - and mixing them makes both easy to mute. */
    if (mine && sh.clockedIn === false && inWindow(sh.startTime, now - 11 * MIN, now - 9 * MIN)) {
      alerts.push({
        key: `nc:${sh._id}`,
        title: "You're on the schedule and not clocked in",
        body: `Your shift started at ${clock(sh.startTime, tz)}. Open Pulse and clock in so the hours land on your pay.`,
        url: "/shift",
        clerkUserIds: mine,
        strictAudience: true,
      });
    }
  }

  return alerts;
}
