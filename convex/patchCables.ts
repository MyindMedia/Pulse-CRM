import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { currentOrgWithCapability, currentActor, assertOrg } from "./lib/tenant";
import { connectorV, signalLevelV, genderV } from "./lib/patchValidators";
import { cableFit, type Gender } from "./lib/connectors";

/* ============================================================
   CABLE MANAGEMENT

   Cables are inventory, not decoration. A studio's cable stock
   lives in the `equipment` table under category "cable" with a
   `cableSpec` describing the ends, the channel count and the
   length. A connection on the patch canvas spends one run from
   a stock row, so at any moment the studio can answer the two
   questions that actually get asked at 2am:

     "what is this cable doing"      -> the run list
     "have I got a spare 25ft XLR"   -> free counts

   Nothing here duplicates the asset register. It reads it.
   ============================================================ */

/** Human label for a stock row that has no name of its own yet. */
function describeCable(spec: NonNullable<Doc<"equipment">["cableSpec"]>): string {
  const ends =
    spec.connectorA === spec.connectorB
      ? spec.connectorA.toUpperCase()
      : `${spec.connectorA.toUpperCase()} to ${spec.connectorB.toUpperCase()}`;
  const length = spec.lengthFt ? ` ${spec.lengthFt}ft` : "";
  const chan = spec.channels > 1 ? ` ${spec.channels}ch` : "";
  return `${ends}${chan}${length}`.trim();
}

/** How many runs of each stock row are currently patched, org wide. */
async function usageByCable(ctx: QueryCtx, orgId: string) {
  const edges = await ctx.db
    .query("connections")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const used = new Map<string, number>();
  for (const edge of edges) {
    if (!edge.cableId) continue;
    used.set(edge.cableId, (used.get(edge.cableId) ?? 0) + 1);
  }
  return used;
}

/* ── Stock ──────────────────────────────────────────────────── */

/**
 * The cable locker. Every inventory row of category "cable", with
 * how many runs are patched right now and how many are spare.
 */
export const stock = query({
  args: { q: v.optional(v.string()), onlyFree: v.optional(v.boolean()) },
  handler: async (ctx, { q, onlyFree }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.read");
    const rows = await ctx.db
      .query("equipment")
      .withIndex("by_org_category", (qq) => qq.eq("orgId", orgId).eq("category", "cable"))
      .collect();
    const used = await usageByCable(ctx, orgId);

    const needle = (q ?? "").trim().toLowerCase();

    return rows
      .filter((row) => {
        if (row.status === "retired") return false;
        if (!needle) return true;
        const spec = row.cableSpec;
        return (
          row.name.toLowerCase().includes(needle) ||
          (spec ? describeCable(spec).toLowerCase().includes(needle) : false)
        );
      })
      .map((row) => {
        const quantity = row.quantity ?? 1;
        const inUse = used.get(row._id) ?? 0;
        return {
          _id: row._id,
          name: row.name,
          spec: row.cableSpec ?? null,
          // Rows entered before cable specs existed still show up. They
          // just cannot be matched automatically until someone fills the
          // spec in, which the UI nudges rather than blocks.
          specified: !!row.cableSpec,
          description: row.cableSpec ? describeCable(row.cableSpec) : null,
          quantity,
          inUse,
          free: Math.max(0, quantity - inUse),
          overCommitted: inUse > quantity,
          condition: row.condition ?? null,
          status: row.status,
          installedInRoomId: row.installedInRoomId ?? null,
          currentValueCents: row.currentValueCents,
        };
      })
      .filter((row) => (onlyFree ? row.free > 0 : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Roll-up for the cable manager header. */
export const stockSummary = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.read");
    const rows = await ctx.db
      .query("equipment")
      .withIndex("by_org_category", (q) => q.eq("orgId", orgId).eq("category", "cable"))
      .collect();
    const used = await usageByCable(ctx, orgId);

    let units = 0;
    let inUse = 0;
    let unspecified = 0;
    let valueCents = 0;

    for (const row of rows) {
      if (row.status === "retired") continue;
      const quantity = row.quantity ?? 1;
      units += quantity;
      inUse += Math.min(used.get(row._id) ?? 0, quantity);
      if (!row.cableSpec) unspecified++;
      valueCents += (row.currentValueCents ?? 0) * quantity;
    }

    return {
      types: rows.filter((r) => r.status !== "retired").length,
      units,
      inUse,
      free: Math.max(0, units - inUse),
      unspecified,
      valueCents,
    };
  },
});

/* ── Run list ───────────────────────────────────────────────── */

/**
 * Every connection in a patch space as a source to destination row.
 * This is the patch list that gets printed and taped to the wall, and
 * the thing an engineer reads when tracing by hand.
 */
export const runList = query({
  args: { patchSpaceId: v.id("patchSpaces") },
  handler: async (ctx, { patchSpaceId }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.read");
    const space = await ctx.db.get(patchSpaceId);
    if (!space || space.orgId !== orgId) return [];

    const edges = await ctx.db
      .query("connections")
      .withIndex("by_patchSpace", (q) => q.eq("patchSpaceId", patchSpaceId))
      .collect();

    const rows = await Promise.all(
      edges.map(async (edge) => {
        const from = await ctx.db.get(edge.fromPortId);
        const to = await ctx.db.get(edge.toPortId);
        const fromDevice = from ? await ctx.db.get(from.deviceInstanceId) : null;
        const toDevice = to ? await ctx.db.get(to.deviceInstanceId) : null;
        const cable = edge.cableId ? await ctx.db.get(edge.cableId) : null;

        return {
          _id: edge._id,
          isNormalled: edge.isNormalled,
          isTieLine: !!edge.isTieLine,
          source: fromDevice?.label ?? "Missing device",
          sourcePort: from?.label ?? "Missing port",
          sourceConnector: from?.connector ?? null,
          sourceLevel: from?.signalLevel ?? null,
          destination: toDevice?.label ?? "Missing device",
          destinationPort: to?.label ?? "Missing port",
          destinationConnector: to?.connector ?? null,
          destinationLevel: to?.signalLevel ?? null,
          cableId: edge.cableId ?? null,
          cableName: cable?.name ?? null,
          cableTag: edge.cableTag ?? null,
          color: edge.cableColor ?? cable?.cableSpec?.color ?? null,
          lengthFt: edge.cableLengthFt ?? cable?.cableSpec?.lengthFt ?? null,
          notes: edge.notes ?? null,
          /* A run with no cable assigned is a run nobody can find later.
             A tie line is exempt: there was never a cable to assign, and
             flagging the building's own wiring as unfinished work would
             train people to ignore the flag. */
          unassigned: !edge.cableId && !edge.isNormalled && !edge.isTieLine,
          // A dangling reference means a device or port was deleted out
          // from under this edge. Surfaced rather than hidden.
          orphaned: !from || !to || !fromDevice || !toDevice,
        };
      }),
    );

    return rows.sort((a, b) => {
      const bySource = a.source.localeCompare(b.source);
      return bySource !== 0 ? bySource : a.sourcePort.localeCompare(b.sourcePort);
    });
  },
});

/**
 * What this patch needs versus what is free. Groups the unassigned
 * runs by the connector pair they call for, then reports the stock
 * that could satisfy them. This is the pull list for a session.
 */
/* ── Matching ──────────────────────────────────────────────────
   Stock is matched by whether the metal actually mates, not by
   comparing connector strings. A cable recorded as plain "XLR"
   before the vocabulary was split still fits an XLR3 jack, and a
   Thunderbolt lead still fits a USB-C socket. String equality
   gets both of those wrong.
   ────────────────────────────────────────────────────────────── */

type PortLike = { connector: string; gender?: string; label?: string };

function fitOf(row: Doc<"equipment">, from: PortLike, to: PortLike) {
  const spec = row.cableSpec;
  if (!spec) return { verdict: "vague" as const, reasons: [] as string[] };
  return cableFit(
    { connector: spec.connectorA, gender: (spec.genderA ?? "unspecified") as Gender },
    { connector: spec.connectorB, gender: (spec.genderB ?? "unspecified") as Gender },
    { connector: from.connector, gender: (from.gender ?? "unspecified") as Gender, label: from.label },
    { connector: to.connector, gender: (to.gender ?? "unspecified") as Gender, label: to.label },
  );
}

const FIT_RANK: Record<string, number> = { exact: 3, compatible: 2, vague: 1, mismatch: 0 };

/**
 * What this patch needs against what is free, grouped by the kind of run.
 * This is the pull list an engineer takes to the locker.
 */
export const pullList = query({
  args: { patchSpaceId: v.id("patchSpaces") },
  handler: async (ctx, { patchSpaceId }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.read");
    const space = await ctx.db.get(patchSpaceId);
    if (!space || space.orgId !== orgId) return [];

    const edges = await ctx.db
      .query("connections")
      .withIndex("by_patchSpace", (q) => q.eq("patchSpaceId", patchSpaceId))
      .collect();

    // Group the unassigned runs by the pair of jacks they join, keeping one
    // real example of each so stock can be tested against actual ports
    // rather than against a string.
    const need = new Map<
      string,
      { from: PortLike; to: PortLike; count: number }
    >();
    for (const edge of edges) {
      if (edge.cableId || edge.isNormalled) continue;
      const from = await ctx.db.get(edge.fromPortId);
      const to = await ctx.db.get(edge.toPortId);
      if (!from || !to) continue;
      const key = [
        `${from.connector}:${from.gender ?? "?"}`,
        `${to.connector}:${to.gender ?? "?"}`,
      ]
        .sort()
        .join("|");
      const prev = need.get(key);
      if (prev) prev.count++;
      else
        need.set(key, {
          from: { connector: from.connector, gender: from.gender, label: from.label },
          to: { connector: to.connector, gender: to.gender, label: to.label },
          count: 1,
        });
    }

    const stockRows = await ctx.db
      .query("equipment")
      .withIndex("by_org_category", (q) => q.eq("orgId", orgId).eq("category", "cable"))
      .collect();
    const used = await usageByCable(ctx, orgId);

    return [...need.values()].map((entry) => {
      const matches = stockRows
        .filter((row) => row.status !== "retired" && row.cableSpec)
        .map((row) => ({ row, fit: fitOf(row, entry.from, entry.to) }))
        .filter(({ fit }) => fit.verdict !== "mismatch")
        .map(({ row, fit }) => {
          const quantity = row.quantity ?? 1;
          return {
            _id: row._id,
            name: row.name,
            free: Math.max(0, quantity - (used.get(row._id) ?? 0)),
            lengthFt: row.cableSpec?.lengthFt ?? null,
            color: row.cableSpec?.color ?? null,
            fit: fit.verdict,
          };
        })
        .sort((a, b) => FIT_RANK[b.fit] - FIT_RANK[a.fit] || b.free - a.free);

      const availableUnits = matches.reduce((sum, m) => sum + m.free, 0);
      return {
        connectorA: entry.from.connector,
        connectorB: entry.to.connector,
        needed: entry.count,
        available: availableUnits,
        short: Math.max(0, entry.count - availableUnits),
        matches,
      };
    });
  },
});

/* ── Assignment ─────────────────────────────────────────────── */

/**
 * Cable stock that could serve a given run. Anything whose metal mates and
 * has a spare, best fit first, then shortest, because that is what an
 * engineer reaches for.
 */
export const suggestFor = query({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, { connectionId }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.read");
    const edge = await ctx.db.get(connectionId);
    if (!edge || edge.orgId !== orgId) return [];

    const from = await ctx.db.get(edge.fromPortId);
    const to = await ctx.db.get(edge.toPortId);
    if (!from || !to) return [];

    const rows = await ctx.db
      .query("equipment")
      .withIndex("by_org_category", (q) => q.eq("orgId", orgId).eq("category", "cable"))
      .collect();
    const used = await usageByCable(ctx, orgId);

    return rows
      .filter((row) => row.status !== "retired" && row.cableSpec)
      .map((row) => ({ row, fit: fitOf(row, from, to) }))
      .filter(({ fit }) => fit.verdict !== "mismatch")
      .map(({ row, fit }) => {
        const quantity = row.quantity ?? 1;
        return {
          _id: row._id,
          name: row.name,
          lengthFt: row.cableSpec?.lengthFt ?? null,
          color: row.cableSpec?.color ?? null,
          free: Math.max(0, quantity - (used.get(row._id) ?? 0)),
          fit: fit.verdict,
        };
      })
      .filter((row) => row.free > 0)
      .sort(
        (a, b) =>
          FIT_RANK[b.fit] - FIT_RANK[a.fit] || (a.lengthFt ?? 9999) - (b.lengthFt ?? 9999),
      );
  },
});

/**
 * Assign every unassigned run to matching free stock, best fit then
 * shortest. Stops at what stock allows and reports exactly what it could
 * not cover, rather than silently doing half a job.
 */
export const autoAssign = mutation({
  args: { patchSpaceId: v.id("patchSpaces") },
  handler: async (ctx, { patchSpaceId }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const space = await ctx.db.get(patchSpaceId);
    assertOrg(space, orgId);

    const edges = await ctx.db
      .query("connections")
      .withIndex("by_patchSpace", (q) => q.eq("patchSpaceId", patchSpaceId))
      .collect();

    const rows = await ctx.db
      .query("equipment")
      .withIndex("by_org_category", (q) => q.eq("orgId", orgId).eq("category", "cable"))
      .collect();
    const used = await usageByCable(ctx, orgId);

    // Free counts we decrement as we go, so one run cannot be handed
    // out twice inside a single pass.
    const free = new Map<string, number>();
    for (const row of rows) {
      if (row.status === "retired" || !row.cableSpec) continue;
      free.set(row._id, Math.max(0, (row.quantity ?? 1) - (used.get(row._id) ?? 0)));
    }

    let assigned = 0;
    let short = 0;

    for (const edge of edges) {
      if (edge.cableId || edge.isNormalled) continue;
      const from = await ctx.db.get(edge.fromPortId);
      const to = await ctx.db.get(edge.toPortId);
      if (!from || !to) continue;

      const candidates = rows
        .filter((row) => row.cableSpec && (free.get(row._id) ?? 0) > 0)
        .map((row) => ({ row, fit: fitOf(row, from, to) }))
        .filter(({ fit }) => fit.verdict !== "mismatch")
        .sort(
          (a, b) =>
            FIT_RANK[b.fit.verdict] - FIT_RANK[a.fit.verdict] ||
            (a.row.cableSpec?.lengthFt ?? 9999) - (b.row.cableSpec?.lengthFt ?? 9999),
        );

      const pick = candidates[0];
      if (!pick) {
        short++;
        continue;
      }

      await ctx.db.patch(edge._id, {
        cableId: pick.row._id,
        cableFit: pick.fit.verdict,
      });
      free.set(pick.row._id, (free.get(pick.row._id) ?? 1) - 1);
      assigned++;
    }

    if (assigned > 0) {
      await ctx.db.insert("patchAudit", {
        orgId,
        patchSpaceId,
        actor,
        at: Date.now(),
        entityType: "connection",
        entityId: patchSpaceId,
        changeType: "update",
        summary: `Assigned cable stock to ${assigned} run${assigned === 1 ? "" : "s"}`,
        after: { assigned, short },
      });
      await ctx.db.patch(patchSpaceId, { revision: Date.now() });
    }

    return { assigned, short };
  },
});

/** Clear the cable off a run without pulling the connection itself. */
export const unassign = mutation({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, { connectionId }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const edge = await ctx.db.get(connectionId);
    assertOrg(edge, orgId);

    await ctx.db.patch(connectionId, {
      cableId: undefined,
      cableTag: undefined,
      cableFit: undefined,
    });
    await ctx.db.insert("patchAudit", {
      orgId,
      patchSpaceId: edge.patchSpaceId,
      actor,
      at: Date.now(),
      entityType: "connection",
      entityId: connectionId,
      changeType: "update",
      summary: "Released the cable on a run",
      before: { cableId: edge.cableId, cableTag: edge.cableTag },
    });
    await ctx.db.patch(edge.patchSpaceId, { revision: Date.now() });
  },
});

/* ── Stock maintenance ──────────────────────────────────────── */

/**
 * Add cable stock. This writes a normal `equipment` row so the cables
 * show up in inventory, asset value and insurance exports like every
 * other thing the studio owns. The patch canvas is just another reader.
 */
export const createStock = mutation({
  args: {
    name: v.string(),
    quantity: v.number(),
    purchaseCents: v.number(),
    currentValueCents: v.optional(v.number()),
    connectorA: connectorV,
    connectorB: connectorV,
    genderA: v.optional(genderV),
    genderB: v.optional(genderV),
    channels: v.optional(v.number()),
    lengthFt: v.optional(v.number()),
    color: v.optional(v.string()),
    signalLevel: v.optional(signalLevelV),
    labelPrefix: v.optional(v.string()),
    installedInRoomId: v.optional(v.id("rooms")),
    condition: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "equipment.edit");

    if (!args.name.trim()) throw new ConvexError("Give the cable a name.");
    if (args.quantity < 1) throw new ConvexError("Quantity must be at least 1.");

    if (args.installedInRoomId) {
      const room = await ctx.db.get(args.installedInRoomId);
      assertOrg(room, orgId);
    }

    const id = await ctx.db.insert("equipment", {
      orgId,
      name: args.name.trim(),
      category: "cable",
      installedInRoomId: args.installedInRoomId,
      status: args.installedInRoomId ? "in_use" : "available",
      quantity: args.quantity,
      purchaseCents: args.purchaseCents,
      currentValueCents: args.currentValueCents ?? args.purchaseCents,
      condition: args.condition,
      notes: args.notes,
      cableSpec: {
        connectorA: args.connectorA,
        connectorB: args.connectorB,
        genderA: args.genderA,
        genderB: args.genderB,
        channels: args.channels ?? 1,
        lengthFt: args.lengthFt,
        color: args.color,
        signalLevel: args.signalLevel,
        labelPrefix: args.labelPrefix,
      },
    });

    await ctx.db.insert("activity", {
      orgId,
      kind: "equipment.added",
      summary: `${args.quantity} x ${args.name.trim()} added to cable stock`,
      entityType: "equipment",
      entityId: id,
      accent: "info",
    });

    return id;
  },
});

/**
 * Add a cable to the locker and put it on a run in one step.
 *
 * This is what the picker calls when the cable an engineer is holding is
 * not in inventory yet. Splitting it into "create stock" then "assign"
 * would leave a half-done state if the second call failed, and would ask
 * the user to do inventory admin in the middle of patching.
 */
export const createAndAssign = mutation({
  args: {
    connectionId: v.id("connections"),
    name: v.string(),
    connectorA: connectorV,
    connectorB: connectorV,
    genderA: v.optional(genderV),
    genderB: v.optional(genderV),
    lengthFt: v.optional(v.number()),
    color: v.optional(v.string()),
    channels: v.optional(v.number()),
    quantity: v.optional(v.number()),
    purchaseCents: v.optional(v.number()),
    /** What the stock is worth now. Defaults to what it cost. */
    currentValueCents: v.optional(v.number()),
    /** The label written on the specific cable used for this run. */
    cableTag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);

    const edge = await ctx.db.get(args.connectionId);
    assertOrg(edge, orgId);

    const name = args.name.trim();
    if (!name) throw new ConvexError("Give the cable a name.");

    const cableId = await ctx.db.insert("equipment", {
      orgId,
      name,
      category: "cable",
      status: "available",
      quantity: Math.max(1, args.quantity ?? 1),
      purchaseCents: args.purchaseCents ?? 0,
      currentValueCents: args.currentValueCents ?? args.purchaseCents ?? 0,
      cableSpec: {
        connectorA: args.connectorA,
        connectorB: args.connectorB,
        genderA: args.genderA,
        genderB: args.genderB,
        channels: args.channels ?? 1,
        lengthFt: args.lengthFt,
        color: args.color,
      },
    });

    await ctx.db.patch(args.connectionId, { cableId, cableTag: args.cableTag });

    await ctx.db.insert("activity", {
      orgId,
      kind: "equipment.added",
      summary: `${name} added to cable stock and patched`,
      entityType: "equipment",
      entityId: cableId,
      accent: "info",
    });

    await ctx.db.insert("patchAudit", {
      orgId,
      patchSpaceId: edge.patchSpaceId,
      actor,
      at: Date.now(),
      entityType: "connection",
      entityId: args.connectionId,
      changeType: "update",
      summary: `Added ${name} to the locker and put it on this run`,
      after: { cableId, cableTag: args.cableTag },
    });
    await ctx.db.patch(edge.patchSpaceId, { revision: Date.now() });

    return cableId;
  },
});

/**
 * Every cable in the locker, ranked for one specific run: exact connector
 * matches with a spare first, then anything else that is free. The picker
 * shows all of it rather than hiding the mismatches, because an engineer
 * reaching for the wrong-but-available cable is a real thing that happens
 * and the map should record what they actually used.
 */
export const optionsFor = query({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, { connectionId }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.read");
    const edge = await ctx.db.get(connectionId);
    if (!edge || edge.orgId !== orgId) return null;

    const from = await ctx.db.get(edge.fromPortId);
    const to = await ctx.db.get(edge.toPortId);
    const fromDevice = from ? await ctx.db.get(from.deviceInstanceId) : null;
    const toDevice = to ? await ctx.db.get(to.deviceInstanceId) : null;

    const rows = await ctx.db
      .query("equipment")
      .withIndex("by_org_category", (q) => q.eq("orgId", orgId).eq("category", "cable"))
      .collect();
    const used = await usageByCable(ctx, orgId);

    const options = rows
      .filter((row) => row.status !== "retired")
      .map((row) => {
        const quantity = row.quantity ?? 1;
        const inUse = used.get(row._id) ?? 0;
        const fit =
          from && to
            ? fitOf(row, from, to)
            : { verdict: "vague" as const, reasons: [] as string[] };
        return {
          _id: row._id,
          name: row.name,
          connectorA: row.cableSpec?.connectorA ?? null,
          connectorB: row.cableSpec?.connectorB ?? null,
          genderA: row.cableSpec?.genderA ?? null,
          genderB: row.cableSpec?.genderB ?? null,
          lengthFt: row.cableSpec?.lengthFt ?? null,
          color: row.cableSpec?.color ?? null,
          quantity,
          free: Math.max(0, quantity - inUse),
          // Already on this run, so re-picking it is not a second draw.
          current: edge.cableId === row._id,
          fit: fit.verdict,
          fitReason: fit.reasons.join(" ") || null,
        };
      })
      .sort((a, b) => {
        if (a.current !== b.current) return a.current ? -1 : 1;
        const rank = FIT_RANK[b.fit] - FIT_RANK[a.fit];
        if (rank !== 0) return rank;
        if ((a.free > 0) !== (b.free > 0)) return a.free > 0 ? -1 : 1;
        return (a.lengthFt ?? 9999) - (b.lengthFt ?? 9999);
      });

    return {
      run: {
        source: `${fromDevice?.label ?? "?"} · ${from?.label ?? "?"}`,
        destination: `${toDevice?.label ?? "?"} · ${to?.label ?? "?"}`,
        sourceConnector: from?.connector ?? null,
        destinationConnector: to?.connector ?? null,
        signalLevel: from?.signalLevel ?? null,
      },
      currentCableId: edge.cableId ?? null,
      currentTag: edge.cableTag ?? null,
      options,
    };
  },
});

/**
 * Edit a cable stock row from wherever it is shown.
 *
 * Cables are assets, so this carries both numbers the rest of inventory
 * carries: what it cost and what it is worth now. Quantity cannot be cut
 * below what is already patched, because that would silently make the
 * locker report free cables that are in a rack.
 */
export const updateStock = mutation({
  args: {
    id: v.id("equipment"),
    name: v.optional(v.string()),
    connectorA: v.optional(connectorV),
    connectorB: v.optional(connectorV),
    genderA: v.optional(genderV),
    genderB: v.optional(genderV),
    channels: v.optional(v.number()),
    lengthFt: v.optional(v.number()),
    color: v.optional(v.string()),
    signalLevel: v.optional(signalLevelV),
    labelPrefix: v.optional(v.string()),
    quantity: v.optional(v.number()),
    purchaseCents: v.optional(v.number()),
    currentValueCents: v.optional(v.number()),
    condition: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("available"),
        v.literal("in_use"),
        v.literal("maintenance"),
        v.literal("retired"),
      ),
    ),
    installedInRoomId: v.optional(v.id("rooms")),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrgWithCapability(ctx, "equipment.edit");
    const item = await ctx.db.get(id);
    assertOrg(item, orgId);
    if (item.category !== "cable") {
      throw new ConvexError("That inventory item is not cable stock.");
    }

    if (patch.installedInRoomId) {
      const room = await ctx.db.get(patch.installedInRoomId);
      assertOrg(room, orgId);
    }

    if (patch.quantity !== undefined) {
      if (patch.quantity < 1) throw new ConvexError("Quantity must be at least 1.");
      const inUse = (
        await ctx.db
          .query("connections")
          .withIndex("by_cable", (q) => q.eq("cableId", id))
          .collect()
      ).length;
      if (patch.quantity < inUse) {
        throw new ConvexError(
          `${inUse} of these are patched right now. Release ${inUse - patch.quantity} before dropping the count to ${patch.quantity}.`,
        );
      }
    }

    if (patch.status === "retired") {
      const inUse = (
        await ctx.db
          .query("connections")
          .withIndex("by_cable", (q) => q.eq("cableId", id))
          .collect()
      ).length;
      if (inUse > 0) {
        throw new ConvexError(
          `${inUse} run${inUse === 1 ? " is" : "s are"} still using this. Release ${inUse === 1 ? "it" : "them"} before retiring the stock.`,
        );
      }
    }

    const spec = item.cableSpec;
    const nextSpec =
      patch.connectorA ||
      patch.connectorB ||
      patch.genderA ||
      patch.genderB ||
      patch.channels !== undefined ||
      patch.lengthFt !== undefined ||
      patch.color !== undefined ||
      patch.signalLevel ||
      patch.labelPrefix !== undefined
        ? {
            connectorA: patch.connectorA ?? spec?.connectorA ?? "xlr3",
            connectorB: patch.connectorB ?? spec?.connectorB ?? "xlr3",
            genderA: patch.genderA ?? spec?.genderA,
            genderB: patch.genderB ?? spec?.genderB,
            channels: patch.channels ?? spec?.channels ?? 1,
            lengthFt: patch.lengthFt ?? spec?.lengthFt,
            color: patch.color ?? spec?.color,
            signalLevel: patch.signalLevel ?? spec?.signalLevel,
            labelPrefix: patch.labelPrefix ?? spec?.labelPrefix,
          }
        : undefined;

    const clean: Record<string, unknown> = {};
    for (const key of [
      "name",
      "quantity",
      "purchaseCents",
      "currentValueCents",
      "condition",
      "notes",
      "status",
      "installedInRoomId",
    ] as const) {
      if (patch[key] !== undefined) clean[key] = patch[key];
    }
    if (typeof clean.name === "string") {
      if (!clean.name.trim()) throw new ConvexError("Give the cable a name.");
      clean.name = clean.name.trim();
    }
    if (nextSpec) clean.cableSpec = nextSpec;
    if (Object.keys(clean).length === 0) return;

    await ctx.db.patch(id, clean);
  },
});

/** One cable stock row, resolved for an edit form. */
export const stockItem = query({
  args: { id: v.id("equipment") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.read");
    const item = await ctx.db.get(id);
    if (!item || item.orgId !== orgId || item.category !== "cable") return null;

    const inUse = (
      await ctx.db
        .query("connections")
        .withIndex("by_cable", (q) => q.eq("cableId", id))
        .collect()
    ).length;

    return {
      _id: item._id,
      name: item.name,
      spec: item.cableSpec ?? null,
      quantity: item.quantity ?? 1,
      purchaseCents: item.purchaseCents,
      currentValueCents: item.currentValueCents,
      condition: item.condition ?? null,
      notes: item.notes ?? null,
      status: item.status,
      installedInRoomId: item.installedInRoomId ?? null,
      inUse,
    };
  },
});

/**
 * Fill in or correct the spec on an existing cable row. Studios have
 * years of "XLR Cable, qty 12" entries; this is how those become
 * matchable stock without re-entering them.
 */
export const setSpec = mutation({
  args: {
    id: v.id("equipment"),
    connectorA: connectorV,
    connectorB: connectorV,
    channels: v.optional(v.number()),
    lengthFt: v.optional(v.number()),
    color: v.optional(v.string()),
    signalLevel: v.optional(signalLevelV),
    labelPrefix: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...spec }) => {
    const orgId = await currentOrgWithCapability(ctx, "equipment.edit");
    const item = await ctx.db.get(id);
    assertOrg(item, orgId);
    if (item.category !== "cable") {
      throw new ConvexError("Only cable stock carries a cable spec.");
    }
    await ctx.db.patch(id, {
      cableSpec: {
        connectorA: spec.connectorA,
        connectorB: spec.connectorB,
        channels: spec.channels ?? item.cableSpec?.channels ?? 1,
        lengthFt: spec.lengthFt,
        color: spec.color,
        signalLevel: spec.signalLevel,
        labelPrefix: spec.labelPrefix,
      },
    });
  },
});

/**
 * Where a given cable row is patched right now, across every space.
 * Answers "I need three of these back, which sessions do I raid".
 */
export const whereUsed = query({
  args: { cableId: v.id("equipment") },
  handler: async (ctx, { cableId }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.read");
    const item = await ctx.db.get(cableId);
    if (!item || item.orgId !== orgId) return [];

    const edges = await ctx.db
      .query("connections")
      .withIndex("by_cable", (q) => q.eq("cableId", cableId))
      .collect();

    return await Promise.all(
      edges.map(async (edge) => {
        const space = await ctx.db.get(edge.patchSpaceId);
        const from = await ctx.db.get(edge.fromPortId);
        const to = await ctx.db.get(edge.toPortId);
        const fromDevice = from ? await ctx.db.get(from.deviceInstanceId) : null;
        const toDevice = to ? await ctx.db.get(to.deviceInstanceId) : null;
        return {
          connectionId: edge._id,
          patchSpaceId: edge.patchSpaceId,
          patchSpaceName: space?.name ?? "Unknown space",
          cableTag: edge.cableTag ?? null,
          source: `${fromDevice?.label ?? "?"} ${from?.label ?? ""}`.trim(),
          destination: `${toDevice?.label ?? "?"} ${to?.label ?? ""}`.trim(),
        };
      }),
    );
  },
});
