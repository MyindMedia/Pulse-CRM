import { clockTime } from "./tz";

/* The push an owner or manager gets when somebody on the team punches.
 *
 * The web app already surfaces every punch on the notification bell and as a
 * live toast (the `activity` row). Neither reaches a phone in a pocket, and
 * the person who asked to know when the crew clocks in is exactly the person
 * not at the desk. So each punch also goes to the studio's owners and
 * managers as a device alert - and only to them, never to the whole studio,
 * and never to the person who punched.
 */
export type Punch = {
  kind: "in" | "out";
  memberName: string;
  /** The moment of the punch, ms. */
  at: number;
  tz: string;
  /** The room on the rostered shift, when the punch names one. */
  roomName?: string | null;
  /** Hours on the entry, for a clock-out. */
  hours?: number;
  /** Whether the clock-in was against a rostered shift. */
  onRota?: boolean;
};

export type PunchAlert = { title: string; body: string; url: string; tag: string };

export function punchAlert(p: Punch, entryId: string): PunchAlert {
  const when = clockTime(p.at, p.tz);
  if (p.kind === "in") {
    const where = p.roomName ? ` · ${p.roomName}` : "";
    const rota = p.onRota === false ? " · not on the rota" : "";
    return {
      title: `${p.memberName} clocked in`,
      body: `${when}${where}${rota}`,
      url: "/clock",
      tag: `punch-in:${entryId}`,
    };
  }
  const hours = p.hours === undefined ? "" : ` · ${p.hours.toFixed(1)}h on the clock`;
  return {
    title: `${p.memberName} clocked out`,
    body: `${when}${hours}`,
    url: "/clock",
    tag: `punch-out:${entryId}`,
  };
}

/** Who a punch is told to: the studio's owners and managers who have signed
 *  in somewhere (no Clerk id, no device), less the person punching. */
export function punchAudience(
  members: ReadonlyArray<{ _id: string; role: string; clerkUserId?: string | null }>,
  punchingMemberId: string,
): string[] {
  return members
    .filter((m) => (m.role === "owner" || m.role === "manager") && m._id !== punchingMemberId)
    .map((m) => m.clerkUserId)
    .filter((id): id is string => Boolean(id));
}
