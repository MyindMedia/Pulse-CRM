import { query, mutation, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { currentOrg, assertOrg } from "./lib/tenant";

/* ============================================================
   Equipment - gear assets. Each item is either installed in a
   room or sitting in storage. Installed gear inherits its room's
   availability; storage gear owns its status. Every item carries
   a purchase price and a current value (money in cents).
   ============================================================ */

const categoryV = v.union(
  v.literal("console"),
  v.literal("mic"),
  v.literal("outboard"),
  v.literal("instrument"),
  v.literal("monitor"),
  v.literal("rig"),
  v.literal("other"),
);
const statusV = v.union(
  v.literal("available"),
  v.literal("in_use"),
  v.literal("maintenance"),
  v.literal("retired"),
);

/** An item's display photo - an uploaded file wins over the seeded URL. */
async function photoOf(ctx: QueryCtx, item: Doc<"equipment">): Promise<string | null> {
  if (item.photoId) return await ctx.storage.getUrl(item.photoId);
  return item.photoUrl ?? null;
}

/** Installed gear reads its room's status; storage gear keeps its own. */
async function hydrate(ctx: QueryCtx, item: Doc<"equipment">) {
  const room = item.installedInRoomId ? await ctx.db.get(item.installedInRoomId) : null;
  return {
    ...item,
    roomName: room?.name ?? null,
    location: room ? "installed" : "storage",
    effectiveStatus: room ? room.status : item.status,
    photo: await photoOf(ctx, item),
  };
}

export const list = query({
  args: {
    category: v.optional(categoryV),
    /** "storage", a room id, or omitted for everything. */
    location: v.optional(v.string()),
  },
  handler: async (ctx, { category, location }) => {
    const orgId = await currentOrg(ctx);
    let rows = await ctx.db
      .query("equipment")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    if (category) rows = rows.filter((r) => r.category === category);
    if (location === "storage") {
      rows = rows.filter((r) => !r.installedInRoomId);
    } else if (location && location !== "all") {
      rows = rows.filter((r) => r.installedInRoomId === location);
    }
    const hydrated = await Promise.all(rows.map((r) => hydrate(ctx, r)));
    return hydrated.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Equipment installed in one room. */
export const forRoom = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("equipment")
      .withIndex("by_org_room", (q) => q.eq("orgId", orgId).eq("installedInRoomId", roomId))
      .collect();
    const withPhotos = await Promise.all(
      rows.map(async (r) => ({ ...r, photo: await photoOf(ctx, r) })),
    );
    return withPhotos.sort((a, b) => b.currentValueCents - a.currentValueCents);
  },
});

/** Gear not assigned to any room. */
export const storage = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("equipment")
      .withIndex("by_org_room", (q) => q.eq("orgId", orgId).eq("installedInRoomId", undefined))
      .collect();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Asset totals for the inventory dashboard. */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("equipment")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const purchaseTotal = rows.reduce((s, r) => s + r.purchaseCents, 0);
    const currentTotal = rows.reduce((s, r) => s + r.currentValueCents, 0);
    const installed = rows.filter((r) => r.installedInRoomId).length;
    return {
      count: rows.length,
      installed,
      inStorage: rows.length - installed,
      purchaseTotal,
      currentTotal,
      depreciation: purchaseTotal - currentTotal,
      maintenance: rows.filter((r) => !r.installedInRoomId && r.status === "maintenance").length,
    };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    category: categoryV,
    purchaseCents: v.number(),
    currentValueCents: v.number(),
    installedInRoomId: v.optional(v.id("rooms")),
    purchaseDate: v.optional(v.number()),
    serialNumber: v.optional(v.string()),
    condition: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);
    if (args.installedInRoomId) {
      const room = await ctx.db.get(args.installedInRoomId);
      assertOrg(room, orgId);
    }
    const id = await ctx.db.insert("equipment", {
      orgId,
      name: args.name,
      category: args.category,
      installedInRoomId: args.installedInRoomId,
      status: "available",
      purchaseCents: args.purchaseCents,
      currentValueCents: args.currentValueCents,
      purchaseDate: args.purchaseDate,
      serialNumber: args.serialNumber,
      condition: args.condition,
      notes: args.notes,
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "equipment.added",
      summary: `${args.name} added to inventory`,
      entityType: "equipment",
      entityId: id,
      accent: "info",
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("equipment"),
    name: v.optional(v.string()),
    category: v.optional(categoryV),
    purchaseCents: v.optional(v.number()),
    currentValueCents: v.optional(v.number()),
    purchaseDate: v.optional(v.number()),
    serialNumber: v.optional(v.string()),
    condition: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrg(ctx);
    const item = await ctx.db.get(id);
    assertOrg(item, orgId);
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(id, clean);
  },
});

/** Install an item into a room - its availability now follows that room. */
export const install = mutation({
  args: { id: v.id("equipment"), roomId: v.id("rooms") },
  handler: async (ctx, { id, roomId }) => {
    const orgId = await currentOrg(ctx);
    const item = await ctx.db.get(id);
    assertOrg(item, orgId);
    const room = await ctx.db.get(roomId);
    assertOrg(room, orgId);
    await ctx.db.patch(id, { installedInRoomId: roomId });
    await ctx.db.insert("activity", {
      orgId,
      kind: "equipment.installed",
      summary: `${item.name} installed in ${room.name}`,
      entityType: "equipment",
      entityId: id,
      accent: "gold",
    });
  },
});

/** Pull an item back to storage - it regains its own status. */
export const moveToStorage = mutation({
  args: { id: v.id("equipment") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const item = await ctx.db.get(id);
    assertOrg(item, orgId);
    await ctx.db.patch(id, { installedInRoomId: undefined, status: "available" });
    await ctx.db.insert("activity", {
      orgId,
      kind: "equipment.storage",
      summary: `${item.name} moved to storage`,
      entityType: "equipment",
      entityId: id,
      accent: "info",
    });
  },
});

/** Set the storage status. Only meaningful while the item is in storage -
    installed gear follows its room regardless of this value. */
export const setStatus = mutation({
  args: { id: v.id("equipment"), status: statusV },
  handler: async (ctx, { id, status }) => {
    const orgId = await currentOrg(ctx);
    const item = await ctx.db.get(id);
    assertOrg(item, orgId);
    await ctx.db.patch(id, { status });
  },
});

export const remove = mutation({
  args: { id: v.id("equipment") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const item = await ctx.db.get(id);
    assertOrg(item, orgId);
    await ctx.db.delete(id);
  },
});

/** Step 1 of a photo upload - a short-lived Convex storage upload URL. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await currentOrg(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Step 2 - attach the uploaded file to an equipment item. */
export const setPhoto = mutation({
  args: { id: v.id("equipment"), storageId: v.id("_storage") },
  handler: async (ctx, { id, storageId }) => {
    const orgId = await currentOrg(ctx);
    const item = await ctx.db.get(id);
    assertOrg(item, orgId);
    await ctx.db.patch(id, { photoId: storageId });
  },
});

// Re-exported for callers that need the id type without importing dataModel.
export type EquipmentId = Id<"equipment">;
