import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { currentOrg, assertOrg } from "./lib/tenant";
import { requireCapability } from "./lib/access";
import { recomputeRoomStatus } from "./lib/roomStatus";
import { meterStorageUpload } from "./usage";

/* Rooms are the bookable studios. Gear lives in the `equipment` table and
   links back here via `installedInRoomId`. */

const statusV = v.union(
  v.literal("available"),
  v.literal("in_use"),
  v.literal("maintenance"),
  v.literal("retired"),
);

/** All rooms, each with a rollup of the gear installed inside it. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return Promise.all(
      rooms.map(async (room) => {
        const gear = await ctx.db
          .query("equipment")
          .withIndex("by_org_room", (q) =>
            q.eq("orgId", orgId).eq("installedInRoomId", room._id),
          )
          .collect();
        return {
          ...room,
          heroUrl: room.heroImageId ? await ctx.storage.getUrl(room.heroImageId) : (room.heroImageUrl ?? null),
          equipmentCount: gear.length,
          equipmentValueCents: gear.reduce((s, g) => s + g.currentValueCents, 0),
        };
      }),
    );
  },
});

/** One room plus the equipment installed in it. */
export const get = query({
  args: { id: v.id("rooms") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const room = await ctx.db.get(id);
    if (!room || room.orgId !== orgId) return null;
    const equipment = await ctx.db
      .query("equipment")
      .withIndex("by_org_room", (q) => q.eq("orgId", orgId).eq("installedInRoomId", id))
      .collect();
    return {
      ...room,
      heroUrl: room.heroImageId ? await ctx.storage.getUrl(room.heroImageId) : (room.heroImageUrl ?? null),
      equipment: equipment.sort((a, b) => b.currentValueCents - a.currentValueCents),
      equipmentValueCents: equipment.reduce((s, g) => s + g.currentValueCents, 0),
    };
  },
});

/** Lightweight list for booking pickers. */
export const bookable = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("rooms")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows
      .filter((r) => r.status !== "retired")
      .map((r) => ({ _id: r._id, name: r.name, roomType: r.roomType, status: r.status }));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    roomType: v.optional(v.string()),
    hourlyRateCents: v.optional(v.number()),
    condition: v.optional(v.string()),
    minimumHours: v.optional(v.number()),
    depositPct: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);
    return await ctx.db.insert("rooms", {
      orgId,
      status: "available",
      bookable: true,
      ...args,
      minimumHours: args.minimumHours ?? 2,
      depositPct: args.depositPct ?? 30,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("rooms"),
    name: v.optional(v.string()),
    roomType: v.optional(v.string()),
    hourlyRateCents: v.optional(v.number()),
    condition: v.optional(v.string()),
    minimumHours: v.optional(v.number()),
    depositPct: v.optional(v.number()),
    bookable: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrg(ctx);
    const room = await ctx.db.get(id);
    assertOrg(room, orgId);
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(id, clean);
  },
});

/**
 * Permanently delete a RETIRED room. History is preserved: sessions, shifts and
 * waitlist entries are detached (roomId cleared) and installed gear returns to
 * storage; only the room-bound iCal feeds (whose roomId is required) are removed
 * with it. Guarded to retired rooms so an active room can't be deleted by
 * accident - retire it first.
 */
export const remove = mutation({
  args: { id: v.id("rooms") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "rooms.edit", { orgId });
    const room = await ctx.db.get(id);
    assertOrg(room, orgId);
    if (room.status !== "retired") {
      throw new ConvexError("Retire the room before deleting it.");
    }

    // Detach optional references - keep the history, just unlink the room.
    const gear = await ctx.db
      .query("equipment")
      .withIndex("by_org_room", (q) => q.eq("orgId", orgId).eq("installedInRoomId", id))
      .collect();
    for (const e of gear) await ctx.db.patch(e._id, { installedInRoomId: undefined });

    const sessions = (
      await ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
    ).filter((s) => s.roomId === id);
    for (const s of sessions) await ctx.db.patch(s._id, { roomId: undefined });

    const shifts = (
      await ctx.db.query("shifts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
    ).filter((s) => s.roomId === id);
    for (const s of shifts) await ctx.db.patch(s._id, { roomId: undefined });

    const waits = (
      await ctx.db.query("waitlistEntries").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
    ).filter((w) => w.roomId === id);
    for (const w of waits) await ctx.db.patch(w._id, { roomId: undefined });

    // Delete the room-bound iCal feeds + their events (roomId is required there).
    const events = await ctx.db
      .query("externalCalendarEvents")
      .withIndex("by_org_room_start", (q) => q.eq("orgId", orgId).eq("roomId", id))
      .collect();
    for (const ev of events) await ctx.db.delete(ev._id);
    const cals = await ctx.db
      .query("externalCalendars")
      .withIndex("by_room", (q) => q.eq("roomId", id))
      .collect();
    for (const c of cals) await ctx.db.delete(c._id);

    await ctx.db.delete(id);
    await ctx.db.insert("activity", {
      orgId,
      kind: "room.deleted",
      summary: `${room.name} deleted`,
      entityType: "room",
      entityId: id,
      accent: "info",
    });
    return { deleted: true };
  },
});

/** Signed URL for uploading a room photo (org-gated). */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await currentOrg(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Attach an uploaded photo to a room. assertOrg keeps it tenant-scoped. */
export const setPhoto = mutation({
  args: { id: v.id("rooms"), storageId: v.id("_storage") },
  handler: async (ctx, { id, storageId }) => {
    const orgId = await currentOrg(ctx);
    const room = await ctx.db.get(id);
    assertOrg(room, orgId);
    await meterStorageUpload(ctx, orgId, storageId, room.heroImageId ?? null);
    await ctx.db.patch(id, { heroImageId: storageId });
  },
});

/** Remove a room's uploaded photo. */
export const clearPhoto = mutation({
  args: { id: v.id("rooms") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const room = await ctx.db.get(id);
    assertOrg(room, orgId);
    await ctx.db.patch(id, { heroImageId: undefined });
  },
});

/** Staff status override. Pins the room to `status` and switches its
 * statusSource to "manual" so the auto-recomputer leaves it alone. */
export const setStatus = mutation({
  args: { id: v.id("rooms"), status: statusV },
  handler: async (ctx, { id, status }) => {
    const orgId = await currentOrg(ctx);
    const room = await ctx.db.get(id);
    assertOrg(room, orgId);
    await ctx.db.patch(id, { status, statusSource: "manual" });
    if (status === "maintenance") {
      await ctx.db.insert("activity", {
        orgId,
        kind: "room.maintenance",
        summary: `${room.name} flagged for maintenance`,
        entityType: "room",
        entityId: id,
        accent: "critical",
      });
    }
  },
});

/** Release the manual override and let the calendar drive the status
 * again. Recomputes immediately so the UI updates without a refresh. */
export const setAutoStatus = mutation({
  args: { id: v.id("rooms") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const room = await ctx.db.get(id);
    assertOrg(room, orgId);
    await ctx.db.patch(id, { statusSource: "auto" });
    await recomputeRoomStatus(ctx, id);
  },
});
