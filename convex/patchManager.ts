import { query, mutation, internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { currentOrgWithCapability, currentActor, assertOrg } from "./lib/tenant";
import { GEAR_CATALOG, searchGearCatalog } from "./lib/gearCatalog";
import { meterStorageUpload } from "./usage";
import {
  portDirectionV,
  signalLevelV,
  connectorV,
  genderV,
  portCapabilityV,
  normallingModeV,
  portStateV,
  portTemplateV,
} from "./lib/patchValidators";
import { cableFit, conventionalPortGender, type Gender } from "./lib/connectors";
import {
  portsFor,
  isPhantomSensitive,
  EXTRA_PROFILES,
  CATALOG_PORTS,
  type PortTemplate,
} from "./lib/portTemplates";

/* ============================================================
   PATCH MANAGER
   Documentation of the studio's signal chain, at channel level.

   Two rules hold the whole thing together:

   1. A device on the canvas points at the `equipment` row it
      represents. The patch map and the asset register describe
      the same gear, so neither can quietly drift from reality.
   2. Every mutation that touches a device, a port or a
      connection writes a `patchAudit` row in the same
      transaction. Convex mutations are transactional, so the
      log cannot fall out of step with the graph.

   This records what is plugged in. It never controls hardware.
   ============================================================ */

/* ── Audit ──────────────────────────────────────────────────── */

type AuditArgs = {
  orgId: string;
  patchSpaceId: Id<"patchSpaces">;
  entityType: "patchSpace" | "device" | "port" | "connection" | "note";
  entityId: string;
  changeType: "create" | "update" | "delete";
  summary: string;
  before?: unknown;
  after?: unknown;
};

/**
 * Write the audit row and bump the patch space revision, in the
 * caller's transaction. Every mutation below goes through this.
 * There is no code path that changes the graph without it.
 */
export async function logPatch(ctx: MutationCtx, actor: string, args: AuditArgs) {
  const at = Date.now();
  await ctx.db.insert("patchAudit", {
    orgId: args.orgId,
    patchSpaceId: args.patchSpaceId,
    actor,
    at,
    entityType: args.entityType,
    entityId: args.entityId,
    changeType: args.changeType,
    summary: args.summary,
    before: args.before,
    after: args.after,
  });
  await ctx.db.patch(args.patchSpaceId, { revision: at });
}

/** Fetch a patch space and prove it belongs to the caller's org. */
async function ownSpace(ctx: QueryCtx | MutationCtx, orgId: string, id: Id<"patchSpaces">) {
  const space = await ctx.db.get(id);
  assertOrg(space, orgId);
  return space;
}

/**
 * Refuse to spend cable stock the studio does not have spare.
 *
 * This has to live in the mutation, not the picker. Two engineers looking
 * at the same reactive list both see "1 free", both choose it, and because
 * neither write reads the connections range there is nothing for Convex to
 * detect a conflict on. Reading the range here is what makes the second
 * write lose and retry.
 */
/**
 * Does this cable physically join these two jacks?
 *
 * Returns the verdict and, when it does not fit, the sentence explaining
 * why. A "mismatch" is metal that cannot seat in metal: a USB-C plug in an
 * XLR socket, or two male XLRs. That is refused unless the caller says to
 * record it anyway, because adapters exist and an engineer documenting one
 * is telling the truth about their rig.
 */
async function checkCableFit(
  ctx: MutationCtx,
  cableId: Id<"equipment">,
  fromPortId: Id<"ports">,
  toPortId: Id<"ports">,
) {
  const cable = await ctx.db.get(cableId);
  const from = await ctx.db.get(fromPortId);
  const to = await ctx.db.get(toPortId);
  if (!cable?.cableSpec || !from || !to) {
    // Nothing to check against. Unknown is not the same as wrong.
    return { verdict: "vague" as const, reasons: [] as string[], name: cable?.name ?? "cable" };
  }
  const spec = cable.cableSpec;
  const fit = cableFit(
    { connector: spec.connectorA, gender: (spec.genderA ?? "unspecified") as Gender },
    { connector: spec.connectorB, gender: (spec.genderB ?? "unspecified") as Gender },
    {
      connector: from.connector,
      gender: (from.gender ?? "unspecified") as Gender,
      label: from.label,
    },
    { connector: to.connector, gender: (to.gender ?? "unspecified") as Gender, label: to.label },
  );
  return { verdict: fit.verdict, reasons: fit.reasons, name: cable.name };
}

async function assertCableAvailable(
  ctx: MutationCtx,
  orgId: string,
  cableId: Id<"equipment">,
  ignoreConnectionId?: Id<"connections">,
) {
  const cable = await ctx.db.get(cableId);
  assertOrg(cable, orgId);
  if (cable.category !== "cable") {
    throw new ConvexError("That inventory item is not cable stock.");
  }

  const inUse = (
    await ctx.db
      .query("connections")
      .withIndex("by_cable", (q) => q.eq("cableId", cableId))
      .collect()
  ).filter((edge) => edge._id !== ignoreConnectionId).length;

  const quantity = cable.quantity ?? 1;
  if (inUse >= quantity) {
    throw new ConvexError(
      `All ${quantity} of ${cable.name} are already patched. Free one up or add stock.`,
    );
  }
  return cable;
}

/* ── Patch spaces ───────────────────────────────────────────── */

export const spaces = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.read");
    const rows = await ctx.db
      .query("patchSpaces")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    return await Promise.all(
      rows.map(async (space) => {
        const devices = await ctx.db
          .query("deviceInstances")
          .withIndex("by_patchSpace", (q) => q.eq("patchSpaceId", space._id))
          .collect();
        const connections = await ctx.db
          .query("connections")
          .withIndex("by_patchSpace", (q) => q.eq("patchSpaceId", space._id))
          .collect();
        const room = space.roomId ? await ctx.db.get(space.roomId) : null;
        return {
          ...space,
          roomName: room?.name ?? null,
          deviceCount: devices.length,
          connectionCount: connections.length,
        };
      }),
    );
  },
});

export const createSpace = mutation({
  args: {
    name: v.string(),
    roomId: v.optional(v.id("rooms")),
    description: v.optional(v.string()),
  },
  handler: async (ctx, { name, roomId, description }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);

    if (roomId) {
      const room = await ctx.db.get(roomId);
      assertOrg(room, orgId);
    }

    const at = Date.now();
    const id = await ctx.db.insert("patchSpaces", {
      orgId,
      name,
      roomId,
      description,
      revision: at,
      createdAt: at,
      createdBy: actor,
    });

    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId: id,
      entityType: "patchSpace",
      entityId: id,
      changeType: "create",
      summary: `Created patch space ${name}`,
      after: { name, roomId },
    });

    await ctx.db.insert("activity", {
      orgId,
      kind: "patch.space.created",
      summary: `Patch space ${name} created`,
      entityType: "patchSpace",
      entityId: id,
      accent: "info",
    });

    return id;
  },
});

/**
 * The patch space for a room, created on first use.
 *
 * This is what the "Patch" shortcut on a studio room calls. Making the
 * engineer go to another screen and hand-create a space before they can
 * draw a single cable is the kind of friction that stops a documentation
 * tool ever getting used.
 */
export const openForRoom = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const room = await ctx.db.get(roomId);
    assertOrg(room, orgId);

    const existing = await ctx.db
      .query("patchSpaces")
      .withIndex("by_org_room", (q) => q.eq("orgId", orgId).eq("roomId", roomId))
      .first();
    if (existing) return existing._id;

    const at = Date.now();
    const id = await ctx.db.insert("patchSpaces", {
      orgId,
      name: room.name,
      roomId,
      revision: at,
      createdAt: at,
      createdBy: actor,
    });

    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId: id,
      entityType: "patchSpace",
      entityId: id,
      changeType: "create",
      summary: `Started a patch map for ${room.name}`,
      after: { name: room.name, roomId },
    });

    return id;
  },
});

/** The patch space id for a room, if one exists. Null means not started. */
export const spaceIdForRoom = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.read");
    const space = await ctx.db
      .query("patchSpaces")
      .withIndex("by_org_room", (q) => q.eq("orgId", orgId).eq("roomId", roomId))
      .first();
    if (!space) return null;

    const connections = await ctx.db
      .query("connections")
      .withIndex("by_patchSpace", (q) => q.eq("patchSpaceId", space._id))
      .collect();
    const devices = await ctx.db
      .query("deviceInstances")
      .withIndex("by_patchSpace", (q) => q.eq("patchSpaceId", space._id))
      .collect();

    return { _id: space._id, deviceCount: devices.length, connectionCount: connections.length };
  },
});

export const updateSpace = mutation({
  args: {
    id: v.id("patchSpaces"),
    name: v.optional(v.string()),
    roomId: v.optional(v.id("rooms")),
    description: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const space = await ownSpace(ctx, orgId, id);

    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(clean).length === 0) return;

    await ctx.db.patch(id, clean);
    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId: id,
      entityType: "patchSpace",
      entityId: id,
      changeType: "update",
      summary: `Updated patch space ${space.name}`,
      before: { name: space.name, roomId: space.roomId, description: space.description },
      after: clean,
    });
  },
});

export const removeSpace = mutation({
  args: { id: v.id("patchSpaces") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const space = await ownSpace(ctx, orgId, id);

    // Cascade. The audit log survives on purpose: it is the record of
    // what this room used to be, and deleting a room does not unmake
    // the history of how it was patched.
    const devices = await ctx.db
      .query("deviceInstances")
      .withIndex("by_patchSpace", (q) => q.eq("patchSpaceId", id))
      .collect();
    const edges = await ctx.db
      .query("connections")
      .withIndex("by_patchSpace", (q) => q.eq("patchSpaceId", id))
      .collect();

    // Log the teardown before it happens. Deleting a room is the most
    // destructive thing here and it was the one mutation that wrote no
    // audit row at all.
    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId: id,
      entityType: "patchSpace",
      entityId: id,
      changeType: "delete",
      summary: `Deleted patch space ${space.name} with ${devices.length} device${
        devices.length === 1 ? "" : "s"
      } and ${edges.length} run${edges.length === 1 ? "" : "s"}`,
      before: {
        name: space.name,
        roomId: space.roomId,
        devices: devices.map((d) => d.label),
      },
    });

    for (const table of [
      "connections",
      "ports",
      "deviceInstances",
      "patchAnnotations",
    ] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_patchSpace", (q) => q.eq("patchSpaceId", id))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    await ctx.db.delete(id);

    await ctx.db.insert("activity", {
      orgId,
      kind: "patch.space.deleted",
      summary: `Patch space ${space.name} deleted`,
      entityType: "patchSpace",
      entityId: id,
      accent: "warn",
    });
  },
});

/* ── The graph ──────────────────────────────────────────────── */

/**
 * Everything the canvas needs for one patch space, in one call.
 * Devices carry the inventory row they represent so the canvas can
 * show real gear, real photos, and real serial numbers rather than
 * a parallel set of names that drifts from the asset register.
 */
export const graph = query({
  args: { patchSpaceId: v.id("patchSpaces") },
  handler: async (ctx, { patchSpaceId }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.read");
    const space = await ctx.db.get(patchSpaceId);
    if (!space || space.orgId !== orgId) return null;

    const devices = await ctx.db
      .query("deviceInstances")
      .withIndex("by_patchSpace", (q) => q.eq("patchSpaceId", patchSpaceId))
      .collect();
    const ports = await ctx.db
      .query("ports")
      .withIndex("by_patchSpace", (q) => q.eq("patchSpaceId", patchSpaceId))
      .collect();
    const connections = await ctx.db
      .query("connections")
      .withIndex("by_patchSpace", (q) => q.eq("patchSpaceId", patchSpaceId))
      .collect();

    const profileIds = [...new Set(devices.map((d) => d.profileId))];
    const profiles = await Promise.all(profileIds.map((id) => ctx.db.get(id)));
    const profileById = new Map(
      profiles.filter(Boolean).map((p) => [p!._id, p!] as const),
    );

    const equipmentIds = [
      ...new Set(devices.map((d) => d.equipmentId).filter(Boolean)),
    ] as Id<"equipment">[];
    const equipment = await Promise.all(equipmentIds.map((id) => ctx.db.get(id)));
    const equipmentById = new Map(
      equipment.filter(Boolean).map((e) => [e!._id, e!] as const),
    );

    // Cable stock referenced by the current patch, so the canvas can tint
    // edges by jacket colour without a second round trip.
    const cableIds = [
      ...new Set(connections.map((c) => c.cableId).filter(Boolean)),
    ] as Id<"equipment">[];
    const cables = await Promise.all(cableIds.map((id) => ctx.db.get(id)));
    const cableById = new Map(cables.filter(Boolean).map((c) => [c!._id, c!] as const));

    const annotations = await ctx.db
      .query("patchAnnotations")
      .withIndex("by_patchSpace", (q) => q.eq("patchSpaceId", patchSpaceId))
      .collect();

    /* Photos, resolved once here rather than per card. A device shows the
       picture of the unit in this rack if someone took one, and falls back to
       the inventory shot, because a generic catalog photo still beats a grey
       box when you are looking for the right box. */
    const photoIds = [
      ...new Set(
        [
          ...devices.map((d) => d.photoId),
          ...equipment.filter(Boolean).map((e) => e!.photoId),
        ].filter(Boolean),
      ),
    ] as Id<"_storage">[];
    const photoUrls = await Promise.all(photoIds.map((id) => ctx.storage.getUrl(id)));
    const photoUrlById = new Map(photoIds.map((id, i) => [id, photoUrls[i]] as const));

    const portsByDevice = new Map<string, Doc<"ports">[]>();
    for (const p of ports) {
      const list = portsByDevice.get(p.deviceInstanceId) ?? [];
      list.push(p);
      portsByDevice.set(p.deviceInstanceId, list);
    }

    return {
      space,
      devices: devices.map((device) => {
        const profile = profileById.get(device.profileId) ?? null;
        const item = device.equipmentId ? equipmentById.get(device.equipmentId) ?? null : null;
        const ownPhoto = device.photoId ? photoUrlById.get(device.photoId) ?? null : null;
        const stockPhoto = item?.photoId ? photoUrlById.get(item.photoId) ?? null : null;
        return {
          ...device,
          /** Whether the picture shown is of this unit or of the model. */
          photoIsOwn: !!ownPhoto,
          photoUrl: ownPhoto ?? stockPhoto ?? item?.photoUrl ?? null,
          profileName: profile?.name ?? "Unknown device",
          manufacturer: profile?.manufacturer ?? "",
          category: profile?.category ?? "other",
          rackUnits: profile?.rackUnits,
          phantomSensitive: profile?.phantomSensitive ?? false,
          profileId: device.profileId,
          /* Where these ports came from, and whether anyone has agreed. A
             patch map is only trustworthy if a guess looks different from a
             hand-verified port list. */
          specSource: profile?.specSource ?? "category",
          specVerified: !!profile?.specVerifiedAt,
          specNote: profile?.specNote ?? null,
          // The inventory link, resolved.
          equipment: item
            ? {
                _id: item._id,
                name: item.name,
                category: item.category,
                serialNumber: item.serialNumber ?? null,
                condition: item.condition ?? null,
                quantity: item.quantity ?? 1,
                photoUrl: item.photoUrl ?? null,
              }
            : null,
          ports: (portsByDevice.get(device._id) ?? []).sort(
            (a, b) => (a.channelIndex ?? 0) - (b.channelIndex ?? 0),
          ),
        };
      }),
      connections: connections.map((c) => {
        const cable = c.cableId ? cableById.get(c.cableId) ?? null : null;
        return {
          ...c,
          cableName: cable?.name ?? null,
          // Explicit override wins, then the stock row's jacket colour.
          color: c.cableColor ?? cable?.cableSpec?.color ?? null,
          lengthFt: c.cableLengthFt ?? cable?.cableSpec?.lengthFt ?? null,
        };
      }),
      annotations,
    };
  },
});

/* ── Device profiles ────────────────────────────────────────── */

export const profiles = query({
  args: {
    q: v.optional(v.string()),
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { q, category, limit }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.read");
    const globals = await ctx.db
      .query("deviceProfiles")
      .withIndex("by_scope", (qq) => qq.eq("scope", "global"))
      .collect();
    const mine = await ctx.db
      .query("deviceProfiles")
      .withIndex("by_org", (qq) => qq.eq("orgId", orgId))
      .collect();

    const needle = (q ?? "").trim().toLowerCase();
    const all = [...mine, ...globals].filter((p) => {
      if (category && p.category !== category) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        p.manufacturer.toLowerCase().includes(needle)
      );
    });

    // Studio-authored profiles sort first. The escape hatch should be
    // the easiest thing to find, not the hardest.
    all.sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === "studio" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return all.slice(0, limit ?? 60).map((p) => ({
      _id: p._id,
      name: p.name,
      manufacturer: p.manufacturer,
      category: p.category,
      scope: p.scope,
      rackUnits: p.rackUnits,
      catalogId: p.catalogId,
      phantomSensitive: p.phantomSensitive ?? false,
      portCount: p.portTemplate.length,
      inputCount: p.portTemplate.filter(
        (t) => t.direction === "input" || t.direction === "bidirectional",
      ).length,
      outputCount: p.portTemplate.filter(
        (t) => t.direction === "output" || t.direction === "bidirectional",
      ).length,
    }));
  },
});

export const createProfile = mutation({
  args: {
    name: v.string(),
    manufacturer: v.string(),
    category: v.string(),
    rackUnits: v.optional(v.number()),
    phantomSensitive: v.optional(v.boolean()),
    defaultNormalling: v.optional(normallingModeV),
    portTemplate: v.array(portTemplateV),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    if (!args.name.trim()) throw new ConvexError("Give the device a name.");

    return await ctx.db.insert("deviceProfiles", {
      ...args,
      orgId,
      scope: "studio",
      createdBy: actor,
    });
  },
});

export const removeProfile = mutation({
  args: { id: v.id("deviceProfiles") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const profile = await ctx.db.get(id);
    if (!profile) throw new ConvexError("Not found.");
    if (profile.scope === "global" || profile.orgId !== orgId) {
      throw new ConvexError("Curated profiles cannot be deleted.");
    }
    const inUse = await ctx.db
      .query("deviceInstances")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    if (inUse.some((d) => d.profileId === id)) {
      throw new ConvexError("This device is on a patch canvas. Remove it there first.");
    }
    await ctx.db.delete(id);
  },
});

/* ── Inventory binding ──────────────────────────────────────── */

/**
 * Best-effort match from an inventory row's free-text name back to a
 * gear catalog slug, so a "Neve 1073DPX" the studio typed by hand
 * still gets the real 1073 port layout instead of a generic preamp.
 * Conservative on purpose: a wrong template is worse than a plain one.
 */
function guessCatalogId(name: string, category: string): string | undefined {
  const hits = searchGearCatalog(name, undefined, 3);
  const haystack = name.toLowerCase().replace(/\s+/g, "");
  for (const hit of hits) {
    if (hit.category !== category) continue;
    const model = hit.model.toLowerCase().replace(/\s+/g, "").replace(/\(.*?\)/g, "");
    if (model.length >= 3 && haystack.includes(model)) return hit.id;
  }
  return undefined;
}

/**
 * Find or create the profile that describes a piece of inventory.
 * Created profiles are studio-scoped and reused on every later
 * placement of that gear, so the second Neve costs nothing.
 */
async function profileForEquipment(
  ctx: MutationCtx,
  orgId: string,
  item: Doc<"equipment">,
  actor: string,
): Promise<Id<"deviceProfiles">> {
  const catalogId = guessCatalogId(item.name, item.category);

  // An existing global profile for this exact catalog entry wins.
  if (catalogId) {
    const globalMatch = await ctx.db
      .query("deviceProfiles")
      .withIndex("by_catalog", (q) => q.eq("catalogId", catalogId))
      .collect();
    const usable = globalMatch.find((p) => p.scope === "global" || p.orgId === orgId);
    if (usable) return usable._id;
  }

  // Then a studio profile the same gear already created.
  const mine = await ctx.db
    .query("deviceProfiles")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const byName = mine.find(
    (p) => p.name.toLowerCase() === item.name.toLowerCase() && p.category === item.category,
  );
  if (byName) return byName._id;

  // Otherwise mint one from the best template we can resolve. The brand is
  // read off the name when a catalog brand appears in it, so a hand-typed
  // "Royer R-121" still reads as Royer rather than a generic "Studio".
  const brandFromName = (() => {
    const lower = item.name.toLowerCase();
    const brands = [...new Set(GEAR_CATALOG.map((g) => g.brand))]
      .filter((b) => lower.includes(b.toLowerCase()))
      .sort((a, b) => b.length - a.length);
    return brands[0];
  })();

  // Which tier these ports came from. A hand-written map is trusted on
  // sight; a category template is openly a guess and gets looked up.
  const curated = !!catalogId && !!CATALOG_PORTS[catalogId];

  const profileId = await ctx.db.insert("deviceProfiles", {
    orgId,
    scope: "studio",
    name: item.name,
    manufacturer:
      (catalogId ? GEAR_CATALOG.find((g) => g.id === catalogId)?.brand : undefined) ??
      brandFromName ??
      "",
    category: item.category,
    catalogId,
    portTemplate: portsFor(catalogId, item.category),
    phantomSensitive: isPhantomSensitive(catalogId, item.name),
    specSource: curated ? "curated" : "category",
    // A curated map needs nobody's blessing; it was written against the
    // manufacturer's own panel.
    specVerifiedAt: curated ? Date.now() : undefined,
    createdBy: actor,
  });

  // Everything else starts as a category guess, so go and find the real I/O
  // in the background. The device is placeable either way - the lookup only
  // ever upgrades what is already there.
  if (!curated) {
    await ctx.scheduler.runAfter(0, internal.patchSpecs.lookupProfile, { profileId });
  }

  return profileId;
}

/**
 * The palette. Real inventory, filtered to what makes sense in this
 * room, annotated with how many units are already on the canvas.
 *
 * This is the answer to "what can I patch". It reads the equipment
 * table directly rather than a parallel device library, so gear the
 * studio owns is gear the studio can patch, with no second entry step.
 */
export const palette = query({
  args: {
    patchSpaceId: v.id("patchSpaces"),
    q: v.optional(v.string()),
    category: v.optional(v.string()),
    scope: v.optional(v.union(v.literal("room"), v.literal("all"))),
  },
  handler: async (ctx, { patchSpaceId, q, category, scope }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.read");
    const space = await ctx.db.get(patchSpaceId);
    if (!space || space.orgId !== orgId) return [];

    const placed = await ctx.db
      .query("deviceInstances")
      .withIndex("by_patchSpace", (qq) => qq.eq("patchSpaceId", patchSpaceId))
      .collect();
    const placedByEquipment = new Map<string, number>();
    for (const d of placed) {
      if (!d.equipmentId) continue;
      placedByEquipment.set(d.equipmentId, (placedByEquipment.get(d.equipmentId) ?? 0) + 1);
    }

    let items = await ctx.db
      .query("equipment")
      .withIndex("by_org", (qq) => qq.eq("orgId", orgId))
      .collect();

    // Default to the gear installed in this patch space's room, plus
    // anything in storage. That is what an engineer can physically
    // reach without walking to another room.
    const wantRoom = (scope ?? "room") === "room" && space.roomId;
    if (wantRoom) {
      items = items.filter(
        (i) => i.installedInRoomId === space.roomId || i.installedInRoomId === undefined,
      );
    }

    if (category) items = items.filter((i) => i.category === category);
    if (q?.trim()) {
      const needle = q.trim().toLowerCase();
      items = items.filter(
        (i) =>
          i.name.toLowerCase().includes(needle) ||
          (i.serialNumber ?? "").toLowerCase().includes(needle),
      );
    }

    // Cables are stock, not nodes. They belong to the cable manager.
    items = items.filter((i) => i.category !== "cable" && i.status !== "retired");

    return items
      .map((item) => {
        const quantity = item.quantity ?? 1;
        const usedHere = placedByEquipment.get(item._id) ?? 0;
        return {
          _id: item._id,
          name: item.name,
          category: item.category,
          serialNumber: item.serialNumber ?? null,
          condition: item.condition ?? null,
          photoUrl: item.photoUrl ?? null,
          status: item.status,
          installedInRoomId: item.installedInRoomId ?? null,
          inThisRoom: !!space.roomId && item.installedInRoomId === space.roomId,
          quantity,
          placed: usedHere,
          // Units of this row not yet on this canvas.
          available: Math.max(0, quantity - usedHere),
        };
      })
      .sort((a, b) => {
        if (a.inThisRoom !== b.inThisRoom) return a.inThisRoom ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  },
});

/* ── Devices ────────────────────────────────────────────────── */

/** Copy a profile's port template onto a placed device. */
async function materialisePorts(
  ctx: MutationCtx,
  orgId: string,
  patchSpaceId: Id<"patchSpaces">,
  deviceInstanceId: Id<"deviceInstances">,
  template: PortTemplate[],
) {
  for (const t of template) {
    await ctx.db.insert("ports", {
      orgId,
      patchSpaceId,
      deviceInstanceId,
      label: t.label,
      direction: t.direction,
      signalLevel: t.signalLevel,
      connector: t.connector,
      gender: t.gender,
      channelIndex: t.channelIndex,
      capabilities: t.capabilities,
      state: {},
      bayRow: t.bayRow,
      bayColumn: t.bayColumn,
    });
  }
}

/**
 * Place a device on the canvas. Give it an `equipmentId` to place a
 * real asset (the normal path, driven by the palette), or a bare
 * `profileId` to sketch gear that is not in inventory yet.
 */
export const placeDevice = mutation({
  args: {
    patchSpaceId: v.id("patchSpaces"),
    equipmentId: v.optional(v.id("equipment")),
    profileId: v.optional(v.id("deviceProfiles")),
    label: v.optional(v.string()),
    position: v.object({ x: v.number(), y: v.number() }),
  },
  handler: async (ctx, { patchSpaceId, equipmentId, profileId, label, position }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const space = await ownSpace(ctx, orgId, patchSpaceId);

    let resolvedProfileId: Id<"deviceProfiles">;
    let displayLabel = label?.trim() ?? "";
    let unitIndex: number | undefined;

    if (equipmentId) {
      const item = await ctx.db.get(equipmentId);
      assertOrg(item, orgId);

      const quantity = item.quantity ?? 1;
      // Count across every patch space, not just this one. A studio that
      // owns one SM7B cannot have it plugged in in three rooms at once,
      // and a map that says otherwise is the thing this feature exists
      // to prevent.
      const already = await ctx.db
        .query("deviceInstances")
        .withIndex("by_equipment", (q) => q.eq("equipmentId", equipmentId))
        .collect();

      if (already.length >= quantity) {
        const elsewhere = already.filter((d) => d.patchSpaceId !== patchSpaceId).length;
        throw new ConvexError(
          elsewhere > 0
            ? `All ${quantity} of ${item.name} are already placed, ${elsewhere} in another patch space. Raise the quantity in inventory to place another.`
            : `All ${quantity} of ${item.name} are already on this canvas. Raise the quantity in inventory to place another.`,
        );
      }
      unitIndex = already.length;
      resolvedProfileId = profileId ?? (await profileForEquipment(ctx, orgId, item, actor));
      if (!displayLabel) {
        displayLabel = quantity > 1 ? `${item.name} #${unitIndex + 1}` : item.name;
      }
    } else {
      if (!profileId) {
        throw new ConvexError("Pick a device from inventory or choose a profile.");
      }
      const profile = await ctx.db.get(profileId);
      if (!profile) throw new ConvexError("Device profile not found.");
      if (profile.scope !== "global" && profile.orgId !== orgId) {
        throw new ConvexError("Not found.");
      }
      resolvedProfileId = profileId;
      if (!displayLabel) displayLabel = profile.name;
    }

    const profile = await ctx.db.get(resolvedProfileId);
    if (!profile) throw new ConvexError("Device profile not found.");

    const deviceId = await ctx.db.insert("deviceInstances", {
      orgId,
      patchSpaceId,
      profileId: resolvedProfileId,
      equipmentId,
      unitIndex,
      label: displayLabel,
      position,
      normalling: profile.defaultNormalling,
      createdAt: Date.now(),
    });

    await materialisePorts(ctx, orgId, patchSpaceId, deviceId, profile.portTemplate);

    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId,
      entityType: "device",
      entityId: deviceId,
      changeType: "create",
      summary: `Placed ${displayLabel} in ${space.name}`,
      after: { label: displayLabel, equipmentId, profileId: resolvedProfileId },
    });

    return deviceId;
  },
});

export const moveDevice = mutation({
  args: {
    id: v.id("deviceInstances"),
    position: v.object({ x: v.number(), y: v.number() }),
  },
  handler: async (ctx, { id, position }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const device = await ctx.db.get(id);
    assertOrg(device, orgId);
    // Position is cosmetic. It moves the box, not the signal, so it
    // does not earn an audit row: the log stays readable as a record
    // of what changed electrically.
    await ctx.db.patch(id, { position });
  },
});

export const updateDevice = mutation({
  args: {
    id: v.id("deviceInstances"),
    label: v.optional(v.string()),
    notes: v.optional(v.string()),
    normalling: v.optional(normallingModeV),
    equipmentId: v.optional(v.id("equipment")),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const device = await ctx.db.get(id);
    assertOrg(device, orgId);

    if (patch.equipmentId) {
      const item = await ctx.db.get(patch.equipmentId);
      assertOrg(item, orgId);
    }

    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(clean).length === 0) return;

    await ctx.db.patch(id, clean);
    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId: device.patchSpaceId,
      entityType: "device",
      entityId: id,
      changeType: "update",
      summary: `Updated ${device.label}`,
      before: {
        label: device.label,
        notes: device.notes,
        normalling: device.normalling,
        equipmentId: device.equipmentId,
      },
      after: clean,
    });
  },
});

export const removeDevice = mutation({
  args: { id: v.id("deviceInstances") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const device = await ctx.db.get(id);
    assertOrg(device, orgId);

    const ports = await ctx.db
      .query("ports")
      .withIndex("by_device", (q) => q.eq("deviceInstanceId", id))
      .collect();
    const portLabelById = new Map(ports.map((p) => [p._id as string, p.label]));

    // Everything needed to put this back. Returned to the caller so undo is
    // a real restore rather than a re-place that loses the patch, the port
    // states and the cables that were on it.
    const restore = {
      device: {
        profileId: device.profileId,
        equipmentId: device.equipmentId,
        unitIndex: device.unitIndex,
        label: device.label,
        notes: device.notes,
        position: device.position,
        normalling: device.normalling,
      },
      ports: ports.map((p) => ({
        label: p.label,
        direction: p.direction,
        signalLevel: p.signalLevel,
        connector: p.connector,
        channelIndex: p.channelIndex,
        capabilities: p.capabilities,
        state: p.state,
        gender: p.gender,
        bayRow: p.bayRow,
        bayColumn: p.bayColumn,
      })),
      connections: [] as {
        myPortLabel: string;
        externalPortId: Id<"ports">;
        myPortIsSource: boolean;
        cableId?: Id<"equipment">;
        cableTag?: string;
        cableColor?: string;
        cableLengthFt?: number;
        notes?: string;
      }[],
    };

    // Pull every cable landing on this device before the box goes, so
    // no connection is left pointing at a port that no longer exists.
    let pulled = 0;
    for (const p of ports) {
      for (const index of ["by_fromPort", "by_toPort"] as const) {
        const edges = await ctx.db
          .query("connections")
          .withIndex(index, (q) =>
            index === "by_fromPort" ? q.eq("fromPortId", p._id) : q.eq("toPortId", p._id),
          )
          .collect();
        for (const edge of edges) {
          const mine = index === "by_fromPort";
          const external = mine ? edge.toPortId : edge.fromPortId;
          // Skip edges where both ends belong to this device: the second
          // pass would record them twice.
          if (!portLabelById.has(external as string)) {
            restore.connections.push({
              myPortLabel: p.label,
              externalPortId: external,
              myPortIsSource: mine,
              cableId: edge.cableId,
              cableTag: edge.cableTag,
              cableColor: edge.cableColor,
              cableLengthFt: edge.cableLengthFt,
              notes: edge.notes,
            });
          }
          await ctx.db.delete(edge._id);
          pulled++;
        }
      }
      await ctx.db.delete(p._id);
    }
    await ctx.db.delete(id);

    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId: device.patchSpaceId,
      entityType: "device",
      entityId: id,
      changeType: "delete",
      summary:
        pulled > 0
          ? `Removed ${device.label} and pulled ${pulled} connection${pulled === 1 ? "" : "s"}`
          : `Removed ${device.label}`,
      before: { label: device.label, equipmentId: device.equipmentId },
    });

    return { patchSpaceId: device.patchSpaceId, ...restore };
  },
});

/**
 * Put a removed device back exactly as it was: same ports, same port
 * states, and the cables that were landing on it, including which stock
 * row and physical label each run was using.
 *
 * Ports get new ids, so the connections are restored by matching the
 * device's own port labels while the far end keeps its original id.
 */
export const restoreDevice = mutation({
  args: {
    patchSpaceId: v.id("patchSpaces"),
    device: v.object({
      profileId: v.id("deviceProfiles"),
      equipmentId: v.optional(v.id("equipment")),
      unitIndex: v.optional(v.number()),
      label: v.string(),
      notes: v.optional(v.string()),
      position: v.object({ x: v.number(), y: v.number() }),
      normalling: v.optional(normallingModeV),
    }),
    ports: v.array(
      v.object({
        label: v.string(),
        direction: portDirectionV,
        signalLevel: signalLevelV,
        connector: connectorV,
        gender: v.optional(genderV),
        channelIndex: v.optional(v.number()),
        capabilities: v.array(portCapabilityV),
        state: portStateV,
        bayRow: v.optional(v.union(v.literal("top"), v.literal("bottom"))),
        bayColumn: v.optional(v.number()),
      }),
    ),
    connections: v.array(
      v.object({
        myPortLabel: v.string(),
        externalPortId: v.id("ports"),
        myPortIsSource: v.boolean(),
        cableId: v.optional(v.id("equipment")),
        cableTag: v.optional(v.string()),
        cableColor: v.optional(v.string()),
        cableLengthFt: v.optional(v.number()),
        notes: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { patchSpaceId, device, ports, connections }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    await ownSpace(ctx, orgId, patchSpaceId);

    const deviceId = await ctx.db.insert("deviceInstances", {
      orgId,
      patchSpaceId,
      ...device,
      createdAt: Date.now(),
    });

    const portIdByLabel = new Map<string, Id<"ports">>();
    for (const p of ports) {
      const portId = await ctx.db.insert("ports", {
        orgId,
        patchSpaceId,
        deviceInstanceId: deviceId,
        ...p,
      });
      portIdByLabel.set(p.label, portId);
    }

    let restored = 0;
    for (const c of connections) {
      const mine = portIdByLabel.get(c.myPortLabel);
      if (!mine) continue;
      // The far end may have been deleted in the meantime. Skip rather
      // than resurrect a connection into a port that no longer exists.
      const external = await ctx.db.get(c.externalPortId);
      if (!external || external.orgId !== orgId) continue;

      await ctx.db.insert("connections", {
        orgId,
        patchSpaceId,
        fromPortId: c.myPortIsSource ? mine : c.externalPortId,
        toPortId: c.myPortIsSource ? c.externalPortId : mine,
        isNormalled: false,
        cableId: c.cableId,
        cableTag: c.cableTag,
        cableColor: c.cableColor,
        cableLengthFt: c.cableLengthFt,
        notes: c.notes,
        createdAt: Date.now(),
      });
      restored++;
    }

    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId,
      entityType: "device",
      entityId: deviceId,
      changeType: "create",
      summary:
        restored > 0
          ? `Restored ${device.label} with ${restored} connection${restored === 1 ? "" : "s"}`
          : `Restored ${device.label}`,
      after: { label: device.label, equipmentId: device.equipmentId },
    });

    return deviceId;
  },
});

/* ── Ports ──────────────────────────────────────────────────── */

export const setPortState = mutation({
  args: {
    id: v.id("ports"),
    phantom: v.optional(v.boolean()),
    pad: v.optional(v.boolean()),
    polarity: v.optional(v.boolean()),
    monoSum: v.optional(v.boolean()),
    hpf: v.optional(v.boolean()),
    impedance: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...toggles }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const port = await ctx.db.get(id);
    assertOrg(port, orgId);

    const requested = Object.entries(toggles).filter(([, value]) => value !== undefined);
    if (requested.length === 0) return;

    // A toggle the hardware does not have is not a toggle. The profile
    // declares the capability set and this is where that is enforced,
    // not just hidden in the UI.
    for (const [key] of requested) {
      if (!port.capabilities.includes(key as (typeof port.capabilities)[number])) {
        throw new ConvexError(`${port.label} has no ${key} control.`);
      }
    }

    const before = { ...port.state };
    const after = { ...port.state, ...Object.fromEntries(requested) };
    await ctx.db.patch(id, { state: after });

    const device = await ctx.db.get(port.deviceInstanceId);
    const changed = requested
      .map(([key, value]) => `${key} ${value === true ? "on" : value === false ? "off" : value}`)
      .join(", ");

    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId: port.patchSpaceId,
      entityType: "port",
      entityId: id,
      changeType: "update",
      // Someone putting phantom into a ribbon is exactly the event
      // worth being able to find six months later.
      summary: `${device?.label ?? "Device"} ${port.label}: ${changed}`,
      before,
      after,
    });
  },
});

export const addPort = mutation({
  args: {
    deviceInstanceId: v.id("deviceInstances"),
    label: v.string(),
    direction: portDirectionV,
    signalLevel: signalLevelV,
    connector: connectorV,
    gender: v.optional(genderV),
    channelIndex: v.optional(v.number()),
    capabilities: v.optional(v.array(portCapabilityV)),
  },
  handler: async (ctx, { deviceInstanceId, capabilities, ...rest }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const device = await ctx.db.get(deviceInstanceId);
    assertOrg(device, orgId);

    const id = await ctx.db.insert("ports", {
      orgId,
      patchSpaceId: device.patchSpaceId,
      deviceInstanceId,
      capabilities: capabilities ?? [],
      state: {},
      ...rest,
      /*
       * A jack on a chassis has a conventional gender, and the port
       * templates have always stamped it. A hand-added port that skipped it
       * was invisible to the two-males check - the one thing the connector
       * engine exists to catch - so it is stamped here too unless the caller
       * knows better and says so.
       */
      gender: rest.gender ?? conventionalPortGender(rest.connector, rest.direction),
    });

    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId: device.patchSpaceId,
      entityType: "port",
      entityId: id,
      changeType: "create",
      summary: `Added port ${rest.label} to ${device.label}`,
      after: rest,
    });
    return id;
  },
});

export const updatePort = mutation({
  args: {
    id: v.id("ports"),
    label: v.optional(v.string()),
    channelIndex: v.optional(v.number()),
    // Correcting a jack means correcting what KIND of jack it is, not just
    // its name. A guessed port with the wrong connector is the case this
    // exists for, so the connector has to be editable or the fix is cosmetic.
    direction: v.optional(portDirectionV),
    signalLevel: v.optional(signalLevelV),
    connector: v.optional(connectorV),
    gender: v.optional(genderV),
    capabilities: v.optional(v.array(portCapabilityV)),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const port = await ctx.db.get(id);
    assertOrg(port, orgId);

    const clean: Record<string, unknown> = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(clean).length === 0) return;

    /*
     * Gender follows the jack unless someone states otherwise. Changing an
     * XLR input into an XLR output flips it male, and leaving the old value
     * behind would quietly break the two-males check on every cable that
     * lands here afterwards.
     */
    if ((patch.connector || patch.direction) && !patch.gender) {
      clean.gender = conventionalPortGender(
        patch.connector ?? port.connector,
        patch.direction ?? port.direction,
      );
    }

    await ctx.db.patch(id, clean);

    // Changing what a jack IS can invalidate the cables already in it, so
    // re-grade them rather than leaving a stale verdict on the canvas.
    if (patch.connector || patch.gender || patch.direction) {
      await regradeCablesOnPort(ctx, id);
    }

    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId: port.patchSpaceId,
      entityType: "port",
      entityId: id,
      changeType: "update",
      summary: `Edited port ${port.label} on this device`,
      before: {
        label: port.label,
        connector: port.connector,
        direction: port.direction,
        signalLevel: port.signalLevel,
      },
      after: clean,
    });
  },
});

/**
 * Re-check every cable landing on a port whose shape just changed.
 *
 * A run recorded as "exact" against an XLR jack is not exact any more once
 * that jack becomes a TRS. Leaving the old verdict makes the canvas lie in
 * exactly the situation the connector checks exist to catch.
 */
async function regradeCablesOnPort(ctx: MutationCtx, portId: Id<"ports">) {
  for (const index of ["by_fromPort", "by_toPort"] as const) {
    const edges = await ctx.db
      .query("connections")
      .withIndex(index, (q) =>
        index === "by_fromPort" ? q.eq("fromPortId", portId) : q.eq("toPortId", portId),
      )
      .collect();
    for (const edge of edges) {
      if (!edge.cableId) continue;
      const check = await checkCableFit(ctx, edge.cableId, edge.fromPortId, edge.toPortId);
      if (check.verdict !== edge.cableFit) {
        await ctx.db.patch(edge._id, { cableFit: check.verdict });
      }
    }
  }
}

export const removePort = mutation({
  args: { id: v.id("ports") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const port = await ctx.db.get(id);
    assertOrg(port, orgId);

    for (const index of ["by_fromPort", "by_toPort"] as const) {
      const edges = await ctx.db
        .query("connections")
        .withIndex(index, (q) =>
          index === "by_fromPort" ? q.eq("fromPortId", id) : q.eq("toPortId", id),
        )
        .collect();
      for (const edge of edges) await ctx.db.delete(edge._id);
    }
    await ctx.db.delete(id);

    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId: port.patchSpaceId,
      entityType: "port",
      entityId: id,
      changeType: "delete",
      summary: `Removed port ${port.label}`,
      before: { label: port.label },
    });
  },
});

/* ── Connections ────────────────────────────────────────────── */

/**
 * Patch one port to another. Direction is recorded as given.
 *
 * Deliberately permissive: an output into another output, or a mic
 * level into a line input, is allowed and flagged later rather than
 * blocked here. Engineers do unconventional things on purpose and a
 * documentation tool that refuses to document them is useless.
 */
export const connect = mutation({
  args: {
    fromPortId: v.id("ports"),
    toPortId: v.id("ports"),
    cableId: v.optional(v.id("equipment")),
    cableTag: v.optional(v.string()),
    cableColor: v.optional(v.string()),
    cableLengthFt: v.optional(v.number()),
    notes: v.optional(v.string()),
    /** Record a cable whose ends do not physically fit. Adapters exist. */
    allowMismatch: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);

    const from = await ctx.db.get(args.fromPortId);
    const to = await ctx.db.get(args.toPortId);
    assertOrg(from, orgId);
    assertOrg(to, orgId);

    if (from._id === to._id) throw new ConvexError("A port cannot patch to itself.");
    if (from.patchSpaceId !== to.patchSpaceId) {
      throw new ConvexError("Both ports must be in the same patch space.");
    }

    // One physical jack, one cable. Re-patching an input replaces what
    // was there, which is what actually happens at the bay.
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_toPort", (q) => q.eq("toPortId", args.toPortId))
      .collect();
    for (const edge of existing) {
      if (!edge.isNormalled) await ctx.db.delete(edge._id);
    }

    let fit: "exact" | "compatible" | "vague" | "mismatch" | undefined;
    if (args.cableId) {
      await assertCableAvailable(ctx, orgId, args.cableId);
      const check = await checkCableFit(ctx, args.cableId, args.fromPortId, args.toPortId);
      fit = check.verdict;
      if (check.verdict === "mismatch" && !args.allowMismatch) {
        throw new ConvexError(
          `${check.name} does not fit these jacks. ${check.reasons.join(" ")}`,
        );
      }
    }

    const id = await ctx.db.insert("connections", {
      orgId,
      patchSpaceId: from.patchSpaceId,
      fromPortId: args.fromPortId,
      toPortId: args.toPortId,
      isNormalled: false,
      cableId: args.cableId,
      cableTag: args.cableTag,
      cableFit: fit,
      cableColor: args.cableColor,
      cableLengthFt: args.cableLengthFt,
      notes: args.notes,
      createdAt: Date.now(),
    });

    const fromDevice = await ctx.db.get(from.deviceInstanceId);
    const toDevice = await ctx.db.get(to.deviceInstanceId);

    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId: from.patchSpaceId,
      entityType: "connection",
      entityId: id,
      changeType: "create",
      summary: `Patched ${fromDevice?.label ?? "?"} ${from.label} to ${toDevice?.label ?? "?"} ${to.label}`,
      after: { fromPortId: args.fromPortId, toPortId: args.toPortId, cableId: args.cableId },
    });

    return id;
  },
});

export const updateConnection = mutation({
  args: {
    id: v.id("connections"),
    cableId: v.optional(v.id("equipment")),
    cableTag: v.optional(v.string()),
    cableLabelMode: v.optional(v.union(v.literal("single"), v.literal("perEnd"))),
    cableTagSource: v.optional(v.string()),
    cableTagTarget: v.optional(v.string()),
    cableColor: v.optional(v.string()),
    cableLengthFt: v.optional(v.number()),
    notes: v.optional(v.string()),
    /** Record a cable whose ends do not physically fit. Adapters exist. */
    allowMismatch: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, allowMismatch, ...patch }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const edge = await ctx.db.get(id);
    assertOrg(edge, orgId);

    // Ignore this connection's own claim so re-selecting the same cable,
    // or swapping back to it, is not read as a second draw on stock.
    if (patch.cableId) {
      await assertCableAvailable(ctx, orgId, patch.cableId, id);
      const check = await checkCableFit(ctx, patch.cableId, edge.fromPortId, edge.toPortId);
      if (check.verdict === "mismatch" && !allowMismatch) {
        throw new ConvexError(
          `${check.name} does not fit these jacks. ${check.reasons.join(" ")}`,
        );
      }
      (patch as Record<string, unknown>).cableFit = check.verdict;
    }

    const clean: Record<string, unknown> = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );

    // Labels are the one group where "not set" is a real value someone
    // chooses. Switching a run to per-end labelling has to clear the middle
    // label, and clearing a field has to actually empty it, so these are
    // written verbatim rather than filtered out for being undefined.
    if (patch.cableLabelMode !== undefined) {
      clean.cableLabelMode = patch.cableLabelMode;
      clean.cableTag = patch.cableLabelMode === "single" ? patch.cableTag : undefined;
      clean.cableTagSource = patch.cableLabelMode === "perEnd" ? patch.cableTagSource : undefined;
      clean.cableTagTarget = patch.cableLabelMode === "perEnd" ? patch.cableTagTarget : undefined;
    }

    if (Object.keys(clean).length === 0) return;

    await ctx.db.patch(id, clean);
    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId: edge.patchSpaceId,
      entityType: "connection",
      entityId: id,
      changeType: "update",
      summary: `Updated cable on a connection`,
      before: {
        cableId: edge.cableId,
        cableTag: edge.cableTag,
        cableTagSource: edge.cableTagSource,
        cableTagTarget: edge.cableTagTarget,
        cableColor: edge.cableColor,
        cableLengthFt: edge.cableLengthFt,
      },
      after: clean,
    });
  },
});

export const disconnect = mutation({
  args: { id: v.id("connections") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const edge = await ctx.db.get(id);
    assertOrg(edge, orgId);

    const from = await ctx.db.get(edge.fromPortId);
    const to = await ctx.db.get(edge.toPortId);
    const fromDevice = from ? await ctx.db.get(from.deviceInstanceId) : null;
    const toDevice = to ? await ctx.db.get(to.deviceInstanceId) : null;

    await ctx.db.delete(id);
    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId: edge.patchSpaceId,
      entityType: "connection",
      entityId: id,
      changeType: "delete",
      summary: `Pulled ${fromDevice?.label ?? "?"} ${from?.label ?? "?"} from ${toDevice?.label ?? "?"} ${to?.label ?? "?"}`,
      before: { fromPortId: edge.fromPortId, toPortId: edge.toPortId, cableId: edge.cableId },
    });
  },
});

/* ── History ────────────────────────────────────────────────── */

export const history = query({
  args: { patchSpaceId: v.id("patchSpaces"), limit: v.optional(v.number()) },
  handler: async (ctx, { patchSpaceId, limit }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.read");
    const space = await ctx.db.get(patchSpaceId);
    if (!space || space.orgId !== orgId) return [];
    return await ctx.db
      .query("patchAudit")
      .withIndex("by_patchSpace_at", (q) => q.eq("patchSpaceId", patchSpaceId))
      .order("desc")
      .take(limit ?? 50);
  },
});

/* ── Seed ───────────────────────────────────────────────────── */

/**
 * Install the curated global profile set. Idempotent: profiles are
 * keyed by catalog slug, so re-running refreshes port templates
 * without duplicating rows or touching studio-authored profiles.
 */
export const seedGlobalProfiles = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("deviceProfiles")
      .withIndex("by_scope", (q) => q.eq("scope", "global"))
      .collect();
    const bySlug = new Map(existing.map((p) => [p.catalogId ?? p.name, p]));

    let created = 0;
    let updated = 0;

    // Everything in the gear catalog we have a real port map for.
    for (const slug of Object.keys(CATALOG_PORTS)) {
      const item = GEAR_CATALOG.find((g) => g.id === slug);
      if (!item) continue;
      const row = {
        scope: "global" as const,
        name: `${item.brand} ${item.model}`,
        manufacturer: item.brand,
        category: item.category as string,
        catalogId: slug,
        portTemplate: CATALOG_PORTS[slug],
        phantomSensitive: isPhantomSensitive(slug, item.model),
      };
      const prev = bySlug.get(slug);
      if (prev) {
        await ctx.db.patch(prev._id, row);
        updated++;
      } else {
        await ctx.db.insert("deviceProfiles", row);
        created++;
      }
    }

    // Patchbays, DIs, snakes and headphone amps: the gear that makes a
    // patch document a patch document, none of which the gear catalog
    // carries because none of it is a purchase decision.
    for (const extra of EXTRA_PROFILES) {
      const row = {
        scope: "global" as const,
        name: extra.name,
        manufacturer: extra.manufacturer,
        category: extra.category,
        rackUnits: extra.rackUnits,
        catalogId: extra.id,
        portTemplate: extra.ports,
        defaultNormalling: extra.defaultNormalling,
        phantomSensitive: extra.phantomSensitive,
      };
      const prev = bySlug.get(extra.id);
      if (prev) {
        await ctx.db.patch(prev._id, row);
        updated++;
      } else {
        await ctx.db.insert("deviceProfiles", row);
        created++;
      }
    }

    return { created, updated };
  },
});

/* ── Photos ─────────────────────────────────────────────────────
   A picture of the actual unit in the actual rack. The whole point
   of patch documentation is that someone standing in front of the
   gear at 2am can match what they see to what is on screen, and a
   photo of the real thing does that better than any label.
   ────────────────────────────────────────────────────────────── */

export const setDevicePhoto = mutation({
  args: { id: v.id("deviceInstances"), storageId: v.id("_storage") },
  handler: async (ctx, { id, storageId }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const device = await ctx.db.get(id);
    assertOrg(device, orgId);

    await meterStorageUpload(ctx, orgId, storageId, device.photoId ?? null);
    await ctx.db.patch(id, { photoId: storageId });
    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId: device.patchSpaceId,
      entityType: "device",
      entityId: id,
      changeType: "update",
      summary: `Added a photo to ${device.label}`,
    });
  },
});

export const clearDevicePhoto = mutation({
  args: { id: v.id("deviceInstances") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const device = await ctx.db.get(id);
    assertOrg(device, orgId);
    if (!device.photoId) return;

    await ctx.db.patch(id, { photoId: undefined });
    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId: device.patchSpaceId,
      entityType: "device",
      entityId: id,
      changeType: "update",
      summary: `Removed the photo from ${device.label}`,
    });
  },
});

/* ── Sticky notes ───────────────────────────────────────────────
   The thing an engineer writes on tape and leaves on the desk.
   Deliberately not a device: it holds no ports, spends no
   inventory and never appears on a run list.
   ────────────────────────────────────────────────────────────── */

const NOTE_LIMIT = 200;

export const addNote = mutation({
  args: {
    patchSpaceId: v.id("patchSpaces"),
    position: v.object({ x: v.number(), y: v.number() }),
    text: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, { patchSpaceId, position, text, color }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const space = await ctx.db.get(patchSpaceId);
    assertOrg(space, orgId);

    // A canvas someone has papered over is not documentation any more.
    const existing = await ctx.db
      .query("patchAnnotations")
      .withIndex("by_patchSpace", (q) => q.eq("patchSpaceId", patchSpaceId))
      .collect();
    if (existing.length >= NOTE_LIMIT) {
      throw new ConvexError(`A patch can hold ${NOTE_LIMIT} notes. Tidy some up first.`);
    }

    const id = await ctx.db.insert("patchAnnotations", {
      orgId,
      patchSpaceId,
      text: text ?? "",
      color: color ?? "amber",
      position,
      createdAt: Date.now(),
      createdBy: actor,
    });
    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId,
      entityType: "note",
      entityId: id,
      changeType: "create",
      summary: "Added a note",
    });
    return id;
  },
});

export const updateNote = mutation({
  args: {
    id: v.id("patchAnnotations"),
    text: v.optional(v.string()),
    color: v.optional(v.string()),
    position: v.optional(v.object({ x: v.number(), y: v.number() })),
    size: v.optional(v.object({ width: v.number(), height: v.number() })),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const note = await ctx.db.get(id);
    assertOrg(note, orgId);

    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(clean).length === 0) return;
    await ctx.db.patch(id, clean);
    // Moving a note is not a graph change; editing its words is not either.
    // Neither belongs in the revision counter that drives re-fitting.
  },
});

export const removeNote = mutation({
  args: { id: v.id("patchAnnotations") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const note = await ctx.db.get(id);
    assertOrg(note, orgId);

    await ctx.db.delete(id);
    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId: note.patchSpaceId,
      entityType: "note",
      entityId: id,
      changeType: "delete",
      summary: "Removed a note",
      before: { text: note.text, color: note.color, position: note.position },
    });
    return { text: note.text, color: note.color, position: note.position, size: note.size };
  },
});
