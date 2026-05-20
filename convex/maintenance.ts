/* Background maintenance entry points. Called from convex/crons.ts. */
import { internalMutation } from "./_generated/server";
import { recomputeRoomStatus } from "./lib/roomStatus";

/** Cron sweep: recompute every room's auto status across all orgs.
 * Manually-pinned rooms (statusSource === "manual") are short-circuited
 * inside recomputeRoomStatus, so this is safe to run blindly. */
export const recomputeAllRoomStatuses = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rooms = await ctx.db.query("rooms").collect();
    for (const r of rooms) {
      await recomputeRoomStatus(ctx, r._id);
    }
    return { recomputed: rooms.length };
  },
});
