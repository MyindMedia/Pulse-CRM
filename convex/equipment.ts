import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { currentOrg, assertOrg } from "./lib/tenant";
import { searchGearCatalog } from "./lib/gearCatalog";
import { meterStorageUpload } from "./usage";

/* ============================================================
   Equipment - gear assets. Each item is either installed in a
   room or sitting in storage. Installed gear inherits its room's
   availability; storage gear owns its status. Every item carries
   a purchase price and a current value (money in cents).
   ============================================================ */

const categoryV = v.union(
  v.literal("console"),
  v.literal("mic"),
  v.literal("preamp"),
  v.literal("interface"),
  v.literal("outboard"),
  v.literal("monitor"),
  v.literal("monitor_controller"),
  v.literal("headphones"),
  v.literal("synth"),
  v.literal("midi"),
  v.literal("instrument"),
  v.literal("computer"),
  v.literal("rig"),
  v.literal("furniture"),
  v.literal("acoustic"),
  v.literal("decor"),
  v.literal("cable"),
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
    // Gear assigned to a room reads as "in use"; storage gear keeps its status.
    effectiveStatus: room ? "in_use" : item.status,
    photo: await photoOf(ctx, item),
  };
}

/** Categories that count as "furniture & space" rather than gear/hardware,
 *  for the inventory cost split (software is tracked separately). Keep in sync
 *  with assetClass() in src/components/studio/constants.ts. */
const FURNITURE_CATEGORIES = new Set(["furniture", "acoustic", "decor", "cable"]);
const isFurniture = (category: string) => FURNITURE_CATEGORIES.has(category);

export const list = query({
  args: {
    category: v.optional(categoryV),
    /** "storage", a room id, or omitted for everything. */
    location: v.optional(v.string()),
    /** "gear" | "furniture" - filter by asset class. */
    assetClass: v.optional(v.string()),
  },
  handler: async (ctx, { category, location, assetClass }) => {
    const orgId = await currentOrg(ctx);
    let rows = await ctx.db
      .query("equipment")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    if (category) rows = rows.filter((r) => r.category === category);
    if (assetClass === "furniture") rows = rows.filter((r) => isFurniture(r.category));
    else if (assetClass === "gear") rows = rows.filter((r) => !isFurniture(r.category));
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
    const qty = (r: { quantity?: number }) => (r.quantity && r.quantity > 0 ? r.quantity : 1);
    const purchaseTotal = rows.reduce((s, r) => s + r.purchaseCents * qty(r), 0);
    const currentTotal = rows.reduce((s, r) => s + r.currentValueCents * qty(r), 0);
    const installed = rows.filter((r) => r.installedInRoomId).length;
    const gear = rows.filter((r) => !isFurniture(r.category));
    const furniture = rows.filter((r) => isFurniture(r.category));
    const sum = (arr: typeof rows, k: "purchaseCents" | "currentValueCents") =>
      arr.reduce((s, r) => s + r[k] * qty(r), 0);
    const units = rows.reduce((s, r) => s + qty(r), 0);
    return {
      count: rows.length,
      units,
      installed,
      inStorage: rows.length - installed,
      purchaseTotal,
      currentTotal,
      depreciation: purchaseTotal - currentTotal,
      maintenance: rows.filter((r) => !r.installedInRoomId && r.status === "maintenance").length,
      // Cost separation: gear/hardware vs furniture & space.
      gearCount: gear.length,
      gearCurrent: sum(gear, "currentValueCents"),
      gearPurchase: sum(gear, "purchaseCents"),
      furnitureCount: furniture.length,
      furnitureCurrent: sum(furniture, "currentValueCents"),
      furniturePurchase: sum(furniture, "purchaseCents"),
    };
  },
});

/** Search the curated gear catalog for the Add-equipment dropdown. Reference
 *  data (not org-scoped); we still resolve the caller's org for tenancy hygiene
 *  and to keep it inside an authenticated workspace context. */
export const searchCatalog = query({
  args: { q: v.string(), category: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { q, category, limit }) => {
    await currentOrg(ctx);
    return searchGearCatalog(q, category, limit ?? 20);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    category: categoryV,
    purchaseCents: v.number(),
    currentValueCents: v.number(),
    installedInRoomId: v.optional(v.id("rooms")),
    quantity: v.optional(v.number()),
    purchaseDate: v.optional(v.number()),
    serialNumber: v.optional(v.string()),
    condition: v.optional(v.string()),
    notes: v.optional(v.string()),
    photoId: v.optional(v.id("_storage")),
    photoUrl: v.optional(v.string()),
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
      // Assigned to a room on creation => in use; otherwise available.
      status: args.installedInRoomId ? "in_use" : "available",
      quantity: args.quantity && args.quantity > 0 ? Math.round(args.quantity) : 1,
      purchaseCents: args.purchaseCents,
      currentValueCents: args.currentValueCents,
      purchaseDate: args.purchaseDate,
      serialNumber: args.serialNumber,
      condition: args.condition,
      notes: args.notes,
      photoId: args.photoId,
      photoUrl: args.photoUrl,
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

/** Bulk import from a spreadsheet. Rows are parsed + coerced client-side into
 *  this clean shape; the server validates, maps room names to rooms in the
 *  caller's org, optionally skips serial-number duplicates, and inserts. One
 *  activity row summarizes the import (not one per item). Tenant-scoped. */
export const importBulk = mutation({
  args: {
    items: v.array(
      v.object({
        name: v.string(),
        category: categoryV,
        purchaseCents: v.number(),
        currentValueCents: v.number(),
        serialNumber: v.optional(v.string()),
        condition: v.optional(v.string()),
        notes: v.optional(v.string()),
        status: v.optional(statusV),
        quantity: v.optional(v.number()),
        purchaseDate: v.optional(v.number()),
        roomName: v.optional(v.string()),
      }),
    ),
    skipDuplicateSerials: v.optional(v.boolean()),
  },
  handler: async (ctx, { items, skipDuplicateSerials }) => {
    const orgId = await currentOrg(ctx);

    // Map room names -> ids once (case-insensitive), for the location column.
    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const roomByName = new Map(rooms.map((r) => [r.name.trim().toLowerCase(), r._id]));

    // Existing serials for dedupe (only loaded when needed).
    const seenSerials = new Set<string>();
    if (skipDuplicateSerials) {
      const existing = await ctx.db
        .query("equipment")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();
      for (const e of existing) {
        if (e.serialNumber) seenSerials.add(e.serialNumber.trim().toLowerCase());
      }
    }

    let inserted = 0;
    let skipped = 0;
    for (const item of items) {
      const name = item.name.trim();
      if (!name) { skipped++; continue; }

      const serialKey = item.serialNumber?.trim().toLowerCase();
      if (skipDuplicateSerials && serialKey && seenSerials.has(serialKey)) {
        skipped++;
        continue;
      }
      if (serialKey) seenSerials.add(serialKey);

      const roomId = item.roomName
        ? roomByName.get(item.roomName.trim().toLowerCase())
        : undefined;

      await ctx.db.insert("equipment", {
        orgId,
        name,
        category: item.category,
        installedInRoomId: roomId,
        status: item.status ?? (roomId ? "in_use" : "available"),
        quantity: item.quantity && item.quantity > 0 ? Math.round(item.quantity) : 1,
        purchaseCents: item.purchaseCents,
        currentValueCents: item.currentValueCents,
        purchaseDate: item.purchaseDate,
        serialNumber: item.serialNumber?.trim() || undefined,
        condition: item.condition?.trim() || undefined,
        notes: item.notes?.trim() || undefined,
      });
      inserted++;
    }

    if (inserted > 0) {
      await ctx.db.insert("activity", {
        orgId,
        kind: "equipment.added",
        summary: `${inserted} item${inserted === 1 ? "" : "s"} imported into inventory`,
        entityType: "equipment",
        accent: "info",
      });
    }

    return { inserted, skipped };
  },
});

export const update = mutation({
  args: {
    id: v.id("equipment"),
    name: v.optional(v.string()),
    category: v.optional(categoryV),
    quantity: v.optional(v.number()),
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
    // Assigning to a room marks the item in use (leave maintenance/retired as-is).
    const status = item.status === "available" ? "in_use" : item.status;
    await ctx.db.patch(id, { installedInRoomId: roomId, status });
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
    // Back to storage => available again (preserve maintenance/retired flags).
    const status = item.status === "in_use" ? "available" : item.status;
    await ctx.db.patch(id, { installedInRoomId: undefined, status });
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

/* ── Bulk operations (select-many in the inventory) ──────────── */

/** Only operate on the caller's own items; silently skip foreign/missing ids. */
async function ownItems(ctx: MutationCtx, orgId: string, ids: Id<"equipment">[]) {
  const rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
  return rows.filter((r): r is Doc<"equipment"> => !!r && r.orgId === orgId);
}

/** Assign many items to a room (in use), or pull many back to storage
 *  (available). Maintenance/retired statuses are preserved. */
export const bulkAssign = mutation({
  args: { ids: v.array(v.id("equipment")), roomId: v.optional(v.id("rooms")) },
  handler: async (ctx, { ids, roomId }) => {
    const orgId = await currentOrg(ctx);
    if (roomId) {
      const room = await ctx.db.get(roomId);
      assertOrg(room, orgId);
    }
    const items = await ownItems(ctx, orgId, ids);
    for (const it of items) {
      if (roomId) {
        await ctx.db.patch(it._id, {
          installedInRoomId: roomId,
          status: it.status === "available" ? "in_use" : it.status,
        });
      } else {
        await ctx.db.patch(it._id, {
          installedInRoomId: undefined,
          status: it.status === "in_use" ? "available" : it.status,
        });
      }
    }
    if (items.length > 0) {
      const room = roomId ? await ctx.db.get(roomId) : null;
      await ctx.db.insert("activity", {
        orgId,
        kind: "equipment.bulk",
        summary: `${items.length} item${items.length === 1 ? "" : "s"} ${room ? `assigned to ${room.name}` : "moved to storage"}`,
        entityType: "equipment",
        accent: "gold",
      });
    }
    return { updated: items.length };
  },
});

/** Bulk-edit shared fields (category, status, condition) on many items. */
export const bulkUpdate = mutation({
  args: {
    ids: v.array(v.id("equipment")),
    category: v.optional(categoryV),
    status: v.optional(statusV),
    condition: v.optional(v.string()),
  },
  handler: async (ctx, { ids, category, status, condition }) => {
    const orgId = await currentOrg(ctx);
    const patch: Record<string, unknown> = {};
    if (category !== undefined) patch.category = category;
    if (status !== undefined) patch.status = status;
    if (condition !== undefined) patch.condition = condition.trim() || undefined;
    if (Object.keys(patch).length === 0) return { updated: 0 };
    const items = await ownItems(ctx, orgId, ids);
    for (const it of items) await ctx.db.patch(it._id, patch);
    return { updated: items.length };
  },
});

/** Delete many items at once. */
export const bulkRemove = mutation({
  args: { ids: v.array(v.id("equipment")) },
  handler: async (ctx, { ids }) => {
    const orgId = await currentOrg(ctx);
    const items = await ownItems(ctx, orgId, ids);
    for (const it of items) await ctx.db.delete(it._id);
    if (items.length > 0) {
      await ctx.db.insert("activity", {
        orgId,
        kind: "equipment.bulk",
        summary: `${items.length} item${items.length === 1 ? "" : "s"} removed from inventory`,
        entityType: "equipment",
        accent: "critical",
      });
    }
    return { removed: items.length };
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
    await meterStorageUpload(ctx, orgId, storageId, item.photoId ?? null);
    await ctx.db.patch(id, { photoId: storageId });
  },
});

// Re-exported for callers that need the id type without importing dataModel.
export type EquipmentId = Id<"equipment">;
