import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { googleConfigured } from "./google";
import { studioPushesGoogle } from "./roomBusy";

/* Two-way Google Calendar, outbound half: every change to a booking reaches the
   studio's Google calendar, whichever mutation made it. Registered as a trigger
   on `sessions` in functions.ts, so a booking path cannot forget it (the public
   booking page, deposit and SMS confirmations and the waitlist used to skip
   it). The Google call itself is scheduled, never made inline: Google being
   slow or down must not block a booking. */

/** The fields a Google event is built from (googleCalendar.sessionToCalendarEvent).
 *  A change to anything else, such as payments or notes, does not push. */
export const CALENDAR_FIELDS = ["title", "startTime", "endTime", "status", "serviceType", "requestStatus"] as const;

export type SessionChange = {
  id: Id<"sessions">;
  operation: "insert" | "update" | "delete";
  oldDoc: Doc<"sessions"> | null;
  newDoc: Doc<"sessions"> | null;
};

/** Pure: what one change to a session asks of Google, if anything. */
export function googleWorkFor(change: SessionChange): { kind: "push" } | { kind: "remove"; eventId: string } | null {
  if (change.operation === "delete") {
    const eventId = change.oldDoc?.googleCalendarEventId;
    return eventId ? { kind: "remove", eventId } : null;
  }
  const { oldDoc, newDoc } = change;
  if (change.operation === "update" && oldDoc && newDoc && CALENDAR_FIELDS.every((f) => oldDoc[f] === newDoc[f])) {
    return null;
  }
  return { kind: "push" };
}

/** Schedules the Google push or removal for one session change, when the
 *  studio is connected. */
export async function syncSessionToGoogle(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  change: SessionChange,
): Promise<void> {
  const work = googleWorkFor(change);
  if (!work || !googleConfigured()) return;
  const orgId = (change.newDoc ?? change.oldDoc)?.orgId;
  if (!orgId) return;
  const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  // The studio level respects its sync direction: pull-only and off never push.
  if (org?.googleRefreshToken && studioPushesGoogle(org)) {
    if (work.kind === "remove") {
      await ctx.scheduler.runAfter(0, internal.googleCalendar.removeEvent, { orgId, eventId: work.eventId });
    } else {
      await ctx.scheduler.runAfter(0, internal.googleCalendar.pushSession, { sessionId: change.id });
    }
  }
}

/* ---------- room blocks (studio calendar) ---------- */

const BLOCK_FIELDS = ["label", "startTime", "endTime", "roomId"] as const;

export type RoomBlockChange = {
  id: Id<"roomBlocks">;
  operation: "insert" | "update" | "delete";
  oldDoc: Doc<"roomBlocks"> | null;
  newDoc: Doc<"roomBlocks"> | null;
};

/** Pure: what one change to a room block asks of Google, if anything. */
export function blockWorkFor(change: RoomBlockChange): { kind: "push" } | { kind: "remove"; eventId: string } | null {
  if (change.operation === "delete") {
    const eventId = change.oldDoc?.googleCalendarEventId;
    return eventId ? { kind: "remove", eventId } : null;
  }
  const { oldDoc, newDoc } = change;
  if (change.operation === "update" && oldDoc && newDoc && BLOCK_FIELDS.every((f) => oldDoc[f] === newDoc[f])) return null;
  return { kind: "push" };
}

/** Pushes, updates or removes the busy event of a room block. */
export async function syncRoomBlockToGoogle(ctx: Pick<MutationCtx, "db" | "scheduler">, change: RoomBlockChange): Promise<void> {
  const work = blockWorkFor(change);
  if (!work || !googleConfigured()) return;
  const orgId = (change.newDoc ?? change.oldDoc)?.orgId;
  if (!orgId) return;
  const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  if (!org?.googleRefreshToken || !studioPushesGoogle(org)) return;
  if (work.kind === "remove") {
    await ctx.scheduler.runAfter(0, internal.googleCalendar.removeEvent, { orgId, eventId: work.eventId });
  } else {
    await ctx.scheduler.runAfter(0, internal.googleCalendar.pushRoomBlock, { blockId: change.id });
  }
}

/* ---------- team members' personal calendars ---------- */

export type MemberWork = { memberId: Id<"members">; kind: "push" | "remove" };

/** Pure: which engineers' calendars a session change touches. The engineer
 *  of record gets the event; a previous engineer loses it. */
export function memberWorkForSession(change: SessionChange): MemberWork[] {
  const before = change.oldDoc?.engineerId;
  const after = change.newDoc?.engineerId;
  if (change.operation === "delete") return before ? [{ memberId: before, kind: "remove" }] : [];
  const { oldDoc, newDoc } = change;
  if (
    change.operation === "update" &&
    oldDoc &&
    newDoc &&
    before === after &&
    CALENDAR_FIELDS.every((f) => oldDoc[f] === newDoc[f])
  ) {
    return [];
  }
  const out: MemberWork[] = [];
  if (before && before !== after) out.push({ memberId: before, kind: "remove" });
  if (after) out.push({ memberId: after, kind: "push" });
  return out;
}

const SHIFT_FIELDS = ["memberId", "startTime", "endTime", "status", "roomId", "note"] as const;

export type ShiftChange = {
  id: Id<"shifts">;
  operation: "insert" | "update" | "delete";
  oldDoc: Doc<"shifts"> | null;
  newDoc: Doc<"shifts"> | null;
};

/** Pure: which calendars a shift change touches. Only hand-made shifts go to a
 *  calendar: a "session" shift is the same hours as the booking, which already
 *  reaches the engineer's calendar as the session. */
export function memberWorkForShift(change: ShiftChange): MemberWork[] {
  const { oldDoc, newDoc } = change;
  const out: MemberWork[] = [];
  if (change.operation === "delete") {
    return oldDoc && oldDoc.kind === "scheduled" ? [{ memberId: oldDoc.memberId, kind: "remove" }] : [];
  }
  if (!newDoc || newDoc.kind !== "scheduled") return [];
  if (change.operation === "update" && oldDoc && SHIFT_FIELDS.every((f) => oldDoc[f] === newDoc[f])) return [];
  if (oldDoc && oldDoc.memberId !== newDoc.memberId) out.push({ memberId: oldDoc.memberId, kind: "remove" });
  out.push({ memberId: newDoc.memberId, kind: "push" });
  return out;
}

/** Schedules the personal-calendar work for the members who have one connected. */
export async function syncMemberCalendars(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  work: MemberWork[],
  item: { kind: "session"; id: Id<"sessions"> } | { kind: "shift"; id: Id<"shifts"> },
): Promise<void> {
  if (work.length === 0 || !googleConfigured()) return;
  for (const w of work) {
    const cal = await ctx.db.query("memberCalendars").withIndex("by_member", (q) => q.eq("memberId", w.memberId)).first();
    if (!cal?.refreshToken) continue;
    if (w.kind === "remove") {
      await ctx.scheduler.runAfter(0, internal.memberCalendar.removeMemberItem, { memberId: w.memberId, itemId: item.id });
    } else {
      await ctx.scheduler.runAfter(0, internal.memberCalendar.pushMemberItem, {
        memberId: w.memberId,
        itemKind: item.kind,
        itemId: item.id,
      });
    }
  }
}
