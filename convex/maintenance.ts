/* Background maintenance entry points. Called from convex/crons.ts. */
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { recomputeRoomStatus } from "./lib/roomStatus";

/** Files uploaded but never attached (e.g. an over-cap save that rolled back)
 *  are left orphaned in Convex storage. Garbage-collect any _storage file not
 *  referenced by any record, with a grace window so an in-flight upload that
 *  hasn't been saved yet is never deleted. */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_DELETES_PER_RUN = 200;

export const sweepOrphanStorage = internalMutation({
  args: {},
  handler: async (ctx) => {
    const referenced = new Set<string>();
    const add = (id?: Id<"_storage"> | null) => {
      if (id) referenced.add(id);
    };
    for (const o of await ctx.db.query("orgs").collect()) {
      add(o.logoId);
      add(o.bookingHeroId);
    }
    for (const a of await ctx.db.query("agencies").collect()) {
      add(a.logoId);
      add(a.faviconId);
    }
    for (const m of await ctx.db.query("members").collect()) add(m.photoId);
    for (const r of await ctx.db.query("rooms").collect()) add(r.heroImageId);
    for (const e of await ctx.db.query("equipment").collect()) add(e.photoId);
    for (const d of await ctx.db.query("deliverables").collect()) add(d.fileId);

    const cutoff = Date.now() - ORPHAN_GRACE_MS;
    let deleted = 0;
    let scanned = 0;
    for (const f of await ctx.db.system.query("_storage").collect()) {
      scanned++;
      if (referenced.has(f._id)) continue;
      if (f._creationTime > cutoff) continue; // still within the grace window
      if (deleted >= MAX_DELETES_PER_RUN) break;
      await ctx.storage.delete(f._id);
      deleted++;
    }
    return { scanned, referenced: referenced.size, deleted };
  },
});

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
