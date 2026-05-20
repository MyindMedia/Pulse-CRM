/* ============================================================
   Auto room-status engine.
   Rooms whose `statusSource` is "auto" (the default) follow the live
   calendar: in_use when a confirmed / in-progress session is happening
   right now, available otherwise. Staff can pin a room to "manual"
   (e.g. to mark it for maintenance) and the recomputer leaves it alone.

   Also enforces a buffer between bookings so engineers always have
   time to reset the room.
   ============================================================ */
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/** Minutes of breathing room between sessions so the room can be reset. */
export const BUFFER_MIN = 15;
export const BUFFER_MS = BUFFER_MIN * 60 * 1000;

/** Sessions in these states are considered "live" for room occupancy. */
const ACTIVE_STATUSES: Doc<"sessions">["status"][] = [
  "confirmed",
  "in_progress",
];

/** Pick the right room status for the current moment based on the
 * room's live sessions. Returns undefined when the room is manually
 * pinned and should NOT be auto-changed. */
export async function computeRoomStatus(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  now: number = Date.now(),
): Promise<Doc<"rooms">["status"] | undefined> {
  const room = await ctx.db.get(roomId);
  if (!room) return undefined;

  // Manual override: never touch.
  if (room.statusSource === "manual") return undefined;

  // Retired / maintenance are deliberate states. Don't fight the operator.
  if (room.status === "retired" || room.status === "maintenance") return undefined;

  // Find any session that intersects the current moment (with a small
  // pre-window so "starts in 5 min" already flips the room).
  const PRE_WINDOW_MS = 5 * 60 * 1000;
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_org_start", (q) =>
      q.eq("orgId", room.orgId).lte("startTime", now + PRE_WINDOW_MS),
    )
    .collect();

  const liveOne = sessions.find(
    (s) =>
      s.roomId === roomId &&
      ACTIVE_STATUSES.includes(s.status) &&
      s.startTime - PRE_WINDOW_MS <= now &&
      s.endTime + BUFFER_MS >= now,
  );

  return liveOne ? "in_use" : "available";
}

/** Recompute + persist the room status. No-op when result is undefined
 * (manual pin or retired/maintenance). */
export async function recomputeRoomStatus(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  now: number = Date.now(),
): Promise<void> {
  const next = await computeRoomStatus(ctx, roomId, now);
  if (next === undefined) return;
  const room = await ctx.db.get(roomId);
  if (!room || room.status === next) return;
  await ctx.db.patch(roomId, { status: next });
}

/** Refresh every room in the org. Cheap on small fleets (3-10 rooms). */
export async function recomputeAllForOrg(
  ctx: MutationCtx,
  orgId: string,
  now: number = Date.now(),
): Promise<void> {
  const rooms = await ctx.db
    .query("rooms")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  for (const r of rooms) await recomputeRoomStatus(ctx, r._id, now);
}

/** Reject a session that would overlap another session in the same room
 * once a 15-minute reset buffer is accounted for. Pass `excludeSessionId`
 * when updating an existing session so it doesn't conflict with itself. */
export async function assertNoBufferConflict(
  ctx: MutationCtx,
  roomId: Id<"rooms"> | undefined,
  startTime: number,
  endTime: number,
  excludeSessionId?: Id<"sessions">,
): Promise<void> {
  if (!roomId) return; // sessions without a room can't double-book one
  const room = await ctx.db.get(roomId);
  if (!room) return;

  const windowStart = startTime - BUFFER_MS;
  const windowEnd = endTime + BUFFER_MS;
  const candidates = await ctx.db
    .query("sessions")
    .withIndex("by_org_start", (q) =>
      q.eq("orgId", room.orgId).gte("startTime", windowStart - 24 * 60 * 60 * 1000).lte("startTime", windowEnd + 24 * 60 * 60 * 1000),
    )
    .collect();

  for (const other of candidates) {
    if (other._id === excludeSessionId) continue;
    if (other.roomId !== roomId) continue;
    if (other.status === "cancelled" || other.status === "no_show") continue;
    // Overlap check inclusive of the buffer on both sides.
    const overlapping =
      other.startTime - BUFFER_MS < endTime &&
      other.endTime + BUFFER_MS > startTime;
    if (overlapping) {
      throw new Error(
        `Booking conflicts with "${other.title}" in this room. Sessions need a ${BUFFER_MIN}-minute reset between them.`,
      );
    }
  }
}
