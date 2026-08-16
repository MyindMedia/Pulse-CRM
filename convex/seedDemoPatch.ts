import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { DEMO_ORG } from "./lib/tenant";
import { portsFor, isPhantomSensitive } from "./lib/portTemplates";

/* ============================================================
   Demo patch seed - a believable tracking chain for the pitch.

   Idempotent: every row it writes is tagged, so a re-run wipes
   only its own work and leaves a real studio's patch alone.
   Run with: npx convex run seedDemoPatch:run
   ============================================================ */

const TAG = "[demo_patch]";

/** Cable stock the demo room actually needs. */
const CABLE_STOCK = [
  { name: "XLR 10ft", a: "xlr", b: "xlr", length: 10, color: "black", qty: 12, cents: 1800 },
  { name: "XLR 25ft", a: "xlr", b: "xlr", length: 25, color: "blue", qty: 8, cents: 2600 },
  { name: "XLR 50ft", a: "xlr", b: "xlr", length: 50, color: "red", qty: 4, cents: 4200 },
  { name: "TRS 6ft patch", a: "trs", b: "trs", length: 6, color: "yellow", qty: 16, cents: 1200 },
  { name: "DB25 to XLR-M fan 10ft", a: "db25", b: "xlr", length: 10, color: "green", qty: 3, cents: 14500 },
  { name: "TT bantam 3ft", a: "bantam", b: "bantam", length: 3, color: "orange", qty: 24, cents: 900 },
] as const;

async function profileByCatalog(ctx: MutationCtx, catalogId: string) {
  const rows = await ctx.db
    .query("deviceProfiles")
    .withIndex("by_catalog", (q) => q.eq("catalogId", catalogId))
    .collect();
  return rows.find((r) => r.scope === "global") ?? null;
}

export const run = internalMutation({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const orgId = args.orgId ?? DEMO_ORG;

    /* ── Wipe only what a previous run created ──────────────── */
    const oldSpaces = (
      await ctx.db
        .query("patchSpaces")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
    ).filter((s) => (s.description ?? "").includes(TAG));

    for (const space of oldSpaces) {
      for (const table of ["connections", "ports", "deviceInstances"] as const) {
        const rows = await ctx.db
          .query(table)
          .withIndex("by_patchSpace", (q) => q.eq("patchSpaceId", space._id))
          .collect();
        for (const row of rows) await ctx.db.delete(row._id);
      }
      const audit = await ctx.db
        .query("patchAudit")
        .withIndex("by_patchSpace_at", (q) => q.eq("patchSpaceId", space._id))
        .collect();
      for (const row of audit) await ctx.db.delete(row._id);
      await ctx.db.delete(space._id);
    }

    const oldGear = (
      await ctx.db
        .query("equipment")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
    ).filter((c) => (c.notes ?? "").includes(TAG));
    for (const row of oldGear) await ctx.db.delete(row._id);

    /* ── Cable stock ────────────────────────────────────────── */
    for (const cable of CABLE_STOCK) {
      await ctx.db.insert("equipment", {
        orgId,
        name: cable.name,
        category: "cable",
        status: "available",
        quantity: cable.qty,
        purchaseCents: cable.cents,
        currentValueCents: Math.round(cable.cents * 0.7),
        notes: TAG,
        cableSpec: {
          connectorA: cable.a,
          connectorB: cable.b,
          channels: cable.a === "db25" ? 8 : 1,
          lengthFt: cable.length,
          color: cable.color,
        },
      });
    }

    /* ── The room ───────────────────────────────────────────── */
    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const room = rooms.find((r) => r.name.includes("Studio A")) ?? rooms[0] ?? null;

    /* ── Gear the demo studio needs to own ──────────────────── */
    // A patch map is only honest if the studio owns what is drawn on it, so
    // the seed adds the rack gear the base demo does not already carry and
    // installs it in the room the canvas describes.
    const RACK_GEAR = [
      { name: "AMS Neve 1073DPX", category: "preamp" as const, cents: 479500 },
      { name: "Universal Audio Apollo x8p", category: "interface" as const, cents: 299900 },
      { name: "Royer R-121", category: "mic" as const, cents: 149500 },
      { name: "TT Patchbay 96-point", category: "other" as const, cents: 89900 },
    ];
    for (const gear of RACK_GEAR) {
      await ctx.db.insert("equipment", {
        orgId,
        name: gear.name,
        category: gear.category,
        installedInRoomId: room?._id,
        status: room ? "in_use" : "available",
        quantity: 1,
        purchaseCents: gear.cents,
        currentValueCents: Math.round(gear.cents * 0.85),
        notes: TAG,
      });
    }

    const at = Date.now();
    const patchSpaceId = await ctx.db.insert("patchSpaces", {
      orgId,
      name: room ? `${room.name} - tracking` : "Control Room",
      roomId: room?._id,
      description: `The main vocal and drum chain. ${TAG}`,
      revision: at,
      createdAt: at,
      createdBy: "Seed",
    });

    /* ── Place devices ──────────────────────────────────────── */
    const placed: Record<string, { deviceId: Id<"deviceInstances">; ports: Record<string, Id<"ports">> }> = {};

    async function place(
      key: string,
      opts: {
        label: string;
        position: { x: number; y: number };
        catalogId?: string;
        equipmentName?: string;
        category?: string;
        /** Set when the catalog slug is borrowed only for its port shape. */
        manufacturer?: string;
      },
    ) {
      let profileId: Id<"deviceProfiles"> | null = null;
      const category = opts.category ?? "other";

      // Only reuse a curated profile when it really describes this unit. The
      // seed borrows a catalog slug purely for its port shape in a couple of
      // places, and inheriting that entry's brand would print the wrong
      // manufacturer on the card, which is worse than printing none.
      if (opts.catalogId && !opts.manufacturer) {
        const profile = await profileByCatalog(ctx, opts.catalogId);
        profileId = profile?._id ?? null;
      }

      if (!profileId) {
        profileId = await ctx.db.insert("deviceProfiles", {
          orgId,
          scope: "studio",
          name: opts.label,
          manufacturer: opts.manufacturer ?? "",
          category,
          portTemplate: portsFor(opts.catalogId, category),
          phantomSensitive: isPhantomSensitive(opts.catalogId, opts.label),
          defaultNormalling: category === "patchbay" ? "half" : undefined,
          createdBy: "Seed",
        });
      }

      const profile = (await ctx.db.get(profileId))!;

      // Bind to the real inventory row when the studio owns one.
      let equipmentId: Id<"equipment"> | undefined;
      if (opts.equipmentName) {
        const gear = await ctx.db
          .query("equipment")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect();
        equipmentId = gear.find((g) =>
          g.name.toLowerCase().includes(opts.equipmentName!.toLowerCase()),
        )?._id;
      }

      const deviceId = await ctx.db.insert("deviceInstances", {
        orgId,
        patchSpaceId,
        profileId,
        equipmentId,
        label: opts.label,
        position: opts.position,
        normalling: profile.defaultNormalling,
        createdAt: Date.now(),
      });

      const ports: Record<string, Id<"ports">> = {};
      for (const t of profile.portTemplate) {
        const portId = await ctx.db.insert("ports", {
          orgId,
          patchSpaceId,
          deviceInstanceId: deviceId,
          label: t.label,
          direction: t.direction,
          signalLevel: t.signalLevel,
          connector: t.connector,
          channelIndex: t.channelIndex,
          capabilities: t.capabilities,
          state: {},
          bayRow: t.bayRow,
          bayColumn: t.bayColumn,
        });
        ports[t.label] = portId;
      }

      placed[key] = { deviceId, ports };
      await ctx.db.insert("patchAudit", {
        orgId,
        patchSpaceId,
        actor: "Seed",
        at: Date.now(),
        entityType: "device",
        entityId: deviceId,
        changeType: "create",
        summary: `Placed ${opts.label}`,
      });
    }

    // A real tracking chain, laid out left to right the way signal flows.
    await place("u47", {
      label: "Telefunken U47",
      position: { x: 32, y: 64 },
      catalogId: "neumann-u67",
      equipmentName: "Telefunken U47",
      category: "mic",
      manufacturer: "Telefunken",
    });
    await place("sm7b", {
      label: "Shure SM7B",
      position: { x: 32, y: 240 },
      catalogId: "shure-sm7b",
      equipmentName: "Shure SM7B",
      category: "mic",
    });
    await place("r121", {
      label: "Royer R-121",
      position: { x: 32, y: 400 },
      catalogId: "royer-r121",
      equipmentName: "Royer R-121",
      category: "mic",
    });
    await place("pre", {
      label: "AMS Neve 1073DPX",
      position: { x: 352, y: 64 },
      catalogId: "neve-1073dpx",
      equipmentName: "AMS Neve 1073DPX",
      category: "preamp",
    });
    await place("comp", {
      label: "UA 1176LN",
      position: { x: 352, y: 336 },
      catalogId: "ua-1176ln",
      equipmentName: "1176",
      category: "outboard",
    });
    await place("bay", {
      label: "Bay 1 - TT 96pt",
      position: { x: 688, y: 64 },
      catalogId: "patchbay-tt-96",
      equipmentName: "TT Patchbay 96-point",
      category: "patchbay",
    });
    await place("apollo", {
      label: "Apollo x8p",
      position: { x: 1024, y: 64 },
      catalogId: "ua-apollo-x8p",
      equipmentName: "Universal Audio Apollo x8p",
      category: "interface",
    });
    await place("monitors", {
      label: "Genelec 8351B",
      position: { x: 1024, y: 448 },
      catalogId: "yamaha-hs8",
      equipmentName: "Genelec",
      category: "monitor",
      manufacturer: "Genelec",
    });

    /* ── Patch it ───────────────────────────────────────────── */
    const cableRows = await ctx.db
      .query("equipment")
      .withIndex("by_org_category", (q) => q.eq("orgId", orgId).eq("category", "cable"))
      .collect();
    const xlr25 = cableRows.find((c) => c.name === "XLR 25ft")?._id;
    const xlr10 = cableRows.find((c) => c.name === "XLR 10ft")?._id;
    const tt = cableRows.find((c) => c.name === "TT bantam 3ft")?._id;

    async function patch(
      from: [string, string],
      to: [string, string],
      cableId?: Id<"equipment">,
      cableTag?: string,
    ) {
      const fromPort = placed[from[0]]?.ports[from[1]];
      const toPort = placed[to[0]]?.ports[to[1]];
      if (!fromPort || !toPort) return;
      // Read back the real labels. The log is for a human at 2am, so it must
      // say "Telefunken U47", not the key this script happened to use.
      const fromLabel = (await ctx.db.get(placed[from[0]].deviceId))?.label ?? from[0];
      const toLabel = (await ctx.db.get(placed[to[0]].deviceId))?.label ?? to[0];
      await ctx.db.insert("connections", {
        orgId,
        patchSpaceId,
        fromPortId: fromPort,
        toPortId: toPort,
        isNormalled: false,
        cableId,
        cableTag,
        createdAt: Date.now(),
      });
      await ctx.db.insert("patchAudit", {
        orgId,
        patchSpaceId,
        actor: "Seed",
        at: Date.now(),
        entityType: "connection",
        entityId: "seed",
        changeType: "create",
        summary: `Patched ${fromLabel} ${from[1]} to ${toLabel} ${to[1]}`,
      });
    }

    // Vocal chain: U47 into the Neve, Neve into the bay, bay into the 1176.
    await patch(["u47", "Out"], ["pre", "Mic In 1"], xlr25, "A-014");
    await patch(["pre", "Out 1"], ["bay", "Top 1"], tt, "TT-001");
    await patch(["bay", "Bottom 1"], ["comp", "In"], tt, "TT-002");
    await patch(["comp", "Out"], ["apollo", "Mic/Line In 1"], xlr10, "A-021");

    // Second mic straight into channel 2.
    await patch(["sm7b", "Out"], ["pre", "Mic In 2"], xlr25, "A-016");
    await patch(["pre", "Out 2"], ["apollo", "Mic/Line In 2"], xlr10, "A-022");

    // Ribbon on the guitar cab. No cable assigned yet on purpose, so the
    // pull list and the "no cable" marker both have something to show.
    await patch(["r121", "Out"], ["apollo", "Mic/Line In 3"]);

    // Monitoring.
    await patch(["apollo", "Monitor Out L"], ["monitors", "XLR In"], xlr10, "M-001");

    /* ── A little live state ────────────────────────────────── */
    const micIn1 = placed.pre?.ports["Mic In 1"];
    const micIn2 = placed.pre?.ports["Mic In 2"];
    if (micIn1) await ctx.db.patch(micIn1, { state: { phantom: true, hpf: true } });
    if (micIn2) await ctx.db.patch(micIn2, { state: { phantom: true, pad: true } });

    await ctx.db.patch(patchSpaceId, { revision: Date.now() });

    return {
      patchSpaceId,
      devices: Object.keys(placed).length,
      cableTypes: CABLE_STOCK.length,
    };
  },
});
