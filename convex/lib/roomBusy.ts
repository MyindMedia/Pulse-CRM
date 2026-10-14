import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/* ============================================================
   One answer to "is this room / this person busy?", shared by the
   public booking page, createBooking, internal create + reschedule,
   room blocks and the directory (docs/plans/hardcover-booking.md).

   Room busy time comes from three places:
   - sessions in the room (not cancelled / no-show / declined request)
   - room blocks (bookingFeatures.roomBlocks)
   - the studio's Google Calendar busy time, when the studio syncs
     Google -> Pulse (direction two_way or pull). Decision 2026-10-14:
     Google busy time BLOCKS bookings for the whole studio.
   Person busy time: their sessions as engineer + their personal
   Google calendar (memberBusyBlocks).
   ============================================================ */

const DAY = 24 * 60 * 60 * 1000;

export type BusyKind = "session" | "block" | "google" | "personal";
export type BusyInterval = { start: number; end: number; kind: BusyKind; id: string };

/** A session still occupies its slot unless it was cancelled, a no-show, or
 *  a declined booking request. Pending requests DO hold the slot. */
export function sessionHoldsSlot(s: Doc<"sessions">): boolean {
  if (s.status === "cancelled" || s.status === "no_show") return false;
  if (s.requestStatus === "declined") return false;
  return true;
}

/** Does the studio pull Google busy time into Pulse? Default two_way. */
export function studioPullsGoogle(org: Doc<"orgs"> | null): boolean {
  if (!org?.googleRefreshToken) return false;
  const dir = org.googleSyncDirection ?? "two_way";
  return dir === "two_way" || dir === "pull";
}

/** Does the studio push Pulse bookings to Google? Default two_way. */
export function studioPushesGoogle(org: Doc<"orgs"> | null): boolean {
  if (!org?.googleRefreshToken) return false;
  const dir = org.googleSyncDirection ?? "two_way";
  return dir === "two_way" || dir === "push";
}

async function orgBySlugOrId(ctx: QueryCtx, orgId: string): Promise<Doc<"orgs"> | null> {
  return await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
}

/** Every busy interval for a room overlapping [from, to). */
export async function roomBusyIntervals(
  ctx: QueryCtx,
  args: {
    orgId: string;
    roomId: Id<"rooms">;
    from: number;
    to: number;
    excludeSessionId?: Id<"sessions">;
    excludeBlockId?: Id<"roomBlocks">;
  },
): Promise<BusyInterval[]> {
  const { orgId, roomId, from, to } = args;
  const out: BusyInterval[] = [];

  // Sessions: look back a day so a long session that started earlier counts.
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", from - DAY).lt("startTime", to))
    .collect();
  for (const s of sessions) {
    if (s._id === args.excludeSessionId || s.roomId !== roomId || !sessionHoldsSlot(s)) continue;
    if (s.startTime < to && s.endTime > from) out.push({ start: s.startTime, end: s.endTime, kind: "session", id: s._id });
  }

  // Room blocks: a block can span a month, so scan from well before `from`.
  const blocks = await ctx.db
    .query("roomBlocks")
    .withIndex("by_room_start", (q) => q.eq("roomId", roomId).gte("startTime", from - 62 * DAY).lt("startTime", to))
    .collect();
  for (const b of blocks) {
    if (b._id === args.excludeBlockId) continue;
    if (b.startTime < to && b.endTime > from) out.push({ start: b.startTime, end: b.endTime, kind: "block", id: b._id });
  }

  // Studio Google busy time blocks every room.
  const org = await orgBySlugOrId(ctx, orgId);
  if (studioPullsGoogle(org)) {
    const google = await ctx.db
      .query("googleBusyBlocks")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", from - 31 * DAY).lt("startTime", to))
      .collect();
    for (const g of google) {
      if (g.startTime < to && g.endTime > from) out.push({ start: g.startTime, end: g.endTime, kind: "google", id: g._id });
    }
  }
  return out;
}

/** First thing that makes [start, end) unavailable for the room, or null.
 *  `bufferMs` pads sessions only (room reset time), never blocks or Google. */
export async function roomConflict(
  ctx: QueryCtx,
  args: {
    orgId: string;
    roomId: Id<"rooms">;
    start: number;
    end: number;
    bufferMs?: number;
    excludeSessionId?: Id<"sessions">;
    excludeBlockId?: Id<"roomBlocks">;
  },
): Promise<BusyInterval | null> {
  const pad = args.bufferMs ?? 0;
  const busy = await roomBusyIntervals(ctx, {
    orgId: args.orgId,
    roomId: args.roomId,
    from: args.start - pad,
    to: args.end + pad,
    excludeSessionId: args.excludeSessionId,
    excludeBlockId: args.excludeBlockId,
  });
  for (const b of busy) {
    const p = b.kind === "session" ? pad : 0;
    if (b.start - p < args.end && b.end + p > args.start) return b;
  }
  return null;
}

/** Plain-language reason for a conflict, safe to show a public booker
 *  (never a client name or a Google event title). */
export function conflictMessage(b: BusyInterval): string {
  if (b.kind === "block") return "That room is blocked for those dates. Pick another time or room.";
  if (b.kind === "google") return "The studio is unavailable at that time. Pick another slot.";
  return "That time was just taken. Pick another slot.";
}

/** Busy intervals for a person: sessions they engineer + their personal
 *  Google calendar. Used to keep engineers from being requested or assigned
 *  while busy. Titles are never returned. */
export async function memberBusyIntervals(
  ctx: QueryCtx,
  args: { orgId: string; memberId: Id<"members">; from: number; to: number; excludeSessionId?: Id<"sessions"> },
): Promise<BusyInterval[]> {
  const out: BusyInterval[] = [];
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_org_start", (q) => q.eq("orgId", args.orgId).gte("startTime", args.from - DAY).lt("startTime", args.to))
    .collect();
  for (const s of sessions) {
    if (s._id === args.excludeSessionId || s.engineerId !== args.memberId || !sessionHoldsSlot(s)) continue;
    if (s.startTime < args.to && s.endTime > args.from) out.push({ start: s.startTime, end: s.endTime, kind: "session", id: s._id });
  }
  const cal = await ctx.db
    .query("memberCalendars")
    .withIndex("by_member", (q) => q.eq("memberId", args.memberId))
    .first();
  const pulls = cal && (cal.syncDirection === "two_way" || cal.syncDirection === "pull");
  if (pulls) {
    const personal = await ctx.db
      .query("memberBusyBlocks")
      .withIndex("by_member_start", (q) => q.eq("memberId", args.memberId).gte("startTime", args.from - 31 * DAY).lt("startTime", args.to))
      .collect();
    for (const p of personal) {
      if (p.startTime < args.to && p.endTime > args.from) out.push({ start: p.startTime, end: p.endTime, kind: "personal", id: p._id });
    }
  }
  return out;
}

/** Is the person free for the whole window? */
export async function memberIsFree(
  ctx: QueryCtx,
  args: { orgId: string; memberId: Id<"members">; start: number; end: number; excludeSessionId?: Id<"sessions"> },
): Promise<boolean> {
  const busy = await memberBusyIntervals(ctx, {
    orgId: args.orgId,
    memberId: args.memberId,
    from: args.start,
    to: args.end,
    excludeSessionId: args.excludeSessionId,
  });
  return busy.length === 0;
}

/** Booking feature switches for an org, all false when unset. */
export function bookingFeatures(org: Doc<"orgs"> | null | undefined) {
  const f = org?.bookingFeatures ?? {};
  return {
    hidePricing: f.hidePricing === true,
    requireApproval: f.requireApproval === true,
    roomBlocks: f.roomBlocks === true,
    changeApproval: f.changeApproval === true,
  };
}
