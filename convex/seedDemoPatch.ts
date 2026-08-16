import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { DEMO_ORG } from "./lib/tenant";
import { portsFor, isPhantomSensitive } from "./lib/portTemplates";
import { cableFit } from "./lib/connectors";

/* ============================================================
   Demo patch seed - three rooms that show what the module does.

   Built from the studio's real inventory: gear it already owns
   is bound to, and only what is missing gets created. A patch
   map is worth nothing if it draws boxes the studio does not
   have, so the demo has to be honest about that too.

   One room, wired to cover the module rather than to look busy.
   The tracking chain runs mics into preamps, through a
   half-normalled TT bay, into the interface and out to monitors,
   and along the way it puts every state the canvas can show on
   screen at once:

     exact        seven runs patched with the right lead, which is
                  what a well-kept locker looks like.
     mismatch     one run deliberately patched with a TT lead into
                  an XLR jack, so the connector check is visibly
                  catching something rather than being described.
     vague        one lead recorded in the locker by name only, so
                  the honest "cannot be sure" verdict appears.
     unassigned   the ribbon is patched with no cable chosen yet,
                  which is what the pull list is for.

   Plus a phantom-sensitive ribbon, per-end cable labels beside
   single-label ones, four notes doing real work, and one device
   whose I/O is still an unconfirmed guess so that state is on
   screen too.

   Idempotent: every row it writes is tagged, so a re-run wipes
   only its own work and leaves a real studio's patch alone.
   Run with: npx convex run seedDemoPatch:run
   ============================================================ */

const TAG = "[demo_patch]";

/** Cable stock the demo room actually needs. */
/*
 * Cable stock, recorded the way a well-run locker actually is: the exact
 * connector at each end and which end is male. That precision is what lets
 * the mating check say "exact" instead of shrugging - and the one row that
 * omits it is deliberate, so the "recorded too vaguely to be sure" state
 * has something to show.
 */
const CABLE_STOCK = [
  { name: "XLR 10ft", a: "xlr3", b: "xlr3", ga: "female", gb: "male", length: 10, color: "black", qty: 12, cents: 1800 },
  { name: "XLR 25ft", a: "xlr3", b: "xlr3", ga: "female", gb: "male", length: 25, color: "blue", qty: 8, cents: 2600 },
  { name: "XLR 50ft", a: "xlr3", b: "xlr3", ga: "female", gb: "male", length: 50, color: "red", qty: 4, cents: 4200 },
  { name: "TRS 6ft patch", a: "trs", b: "trs", length: 6, color: "yellow", qty: 16, cents: 1200 },
  { name: "TS 10ft instrument", a: "ts", b: "ts", length: 10, color: "white", qty: 6, cents: 1400 },
  { name: "DB25 to XLR-M fan 10ft", a: "db25", b: "xlr3", gb: "male", length: 10, color: "green", qty: 3, cents: 14500 },
  { name: "TT bantam 3ft", a: "bantam", b: "bantam", length: 3, color: "orange", qty: 24, cents: 900 },
  // The leads that actually get a rack onto a bay. Without these the demo
  // would be patching XLR into TT with a TT-to-TT cable, which no engineer
  // would let past.
  { name: "XLR-M to TT 5ft", a: "xlr3", b: "bantam", ga: "male", length: 5, color: "orange", qty: 16, cents: 1900 },
  { name: "XLR-F to TT 5ft", a: "xlr3", b: "bantam", ga: "female", length: 5, color: "orange", qty: 16, cents: 1900 },
  { name: "TRS to XLR-M 10ft", a: "trs", b: "xlr3", gb: "male", length: 10, color: "grey", qty: 8, cents: 1700 },
  { name: "ADAT optical 3ft", a: "adat_optical", b: "adat_optical", length: 3, color: "black", qty: 4, cents: 1100 },
  { name: "Word clock BNC 3ft", a: "wordclock_bnc", b: "wordclock_bnc", length: 3, color: "yellow", qty: 4, cents: 1600 },
  { name: "Thunderbolt 3ft", a: "thunderbolt", b: "thunderbolt", length: 3, color: "white", qty: 2, cents: 4900 },
  // Deliberately under-recorded: someone typed the name and nothing else.
  { name: "Unmarked patch lead", a: "other", b: "other", length: 6, color: "violet", qty: 5, cents: 800 },
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
      for (const table of [
        "connections",
        "ports",
        "deviceInstances",
        "patchAnnotations",
      ] as const) {
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
          genderA: "ga" in cable ? (cable.ga as "male" | "female") : undefined,
          genderB: "gb" in cable ? (cable.gb as "male" | "female") : undefined,
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

        /*
         * Refresh a reused profile's ports from the curated map before
         * placing on it. A profile minted before the connector vocabulary
         * was split still carries the legacy catch-alls, and those mate with
         * anything - so every run on this demo would grade "vague" and the
         * connector check would look like it does nothing. The hand-written
         * map is the source of truth; the stored copy is just a cache.
         */
        if (profile) {
          await ctx.db.patch(profile._id, {
            portTemplate: portsFor(opts.catalogId, opts.category ?? profile.category),
          });
        }
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
    const stock = (name: string) => cableRows.find((c) => c.name === name)?._id;
    const xlr25 = stock("XLR 25ft");
    const xlr10 = stock("XLR 10ft");
    const tt = stock("TT bantam 3ft");
    const trs = stock("TRS 6ft patch");
    const xlrmTT = stock("XLR-M to TT 5ft");
    const xlrfTT = stock("XLR-F to TT 5ft");
    const trsXlr = stock("TRS to XLR-M 10ft");
    const vague = stock("Unmarked patch lead");

    async function patch(
      from: [string, string],
      to: [string, string],
      cableId?: Id<"equipment">,
      cableTag?: string,
      /** Per-end labelling, the way a well-marked loom really reads. */
      ends?: { source: string; target: string },
    ) {
      const fromPort = placed[from[0]]?.ports[from[1]];
      const toPort = placed[to[0]]?.ports[to[1]];
      if (!fromPort || !toPort) return;

      /*
       * Grade the run the same way the app does when someone patches by
       * hand. Seeding these unset would leave the demo silent on the one
       * thing the connector engine exists for.
       */
      let fit: "exact" | "compatible" | "vague" | "mismatch" | undefined;
      if (cableId) {
        const cable = await ctx.db.get(cableId);
        const a = await ctx.db.get(fromPort);
        const b = await ctx.db.get(toPort);
        if (cable?.cableSpec && a && b) {
          fit = cableFit(
            { connector: cable.cableSpec.connectorA, gender: cable.cableSpec.genderA },
            { connector: cable.cableSpec.connectorB, gender: cable.cableSpec.genderB },
            { connector: a.connector, gender: a.gender, label: a.label },
            { connector: b.connector, gender: b.gender, label: b.label },
          ).verdict;
        }
      }
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
        cableTag: ends ? undefined : cableTag,
        cableLabelMode: ends ? "perEnd" : cableTag ? "single" : undefined,
        cableTagSource: ends?.source,
        cableTagTarget: ends?.target,
        cableFit: fit,
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
    // Labelled per end, which is how a marked-up loom actually reads: each
    // end says where the OTHER end goes, because that is the question you
    // are asking when you pick a cable up.
    await patch(["u47", "Out"], ["pre", "Mic In 1"], xlr25, undefined, {
      source: "OUT TO NEVE CH1",
      target: "IN FROM U47",
    });
    await patch(["pre", "Out 1"], ["bay", "Top 1"], xlrfTT, "TT-001");
    await patch(["bay", "Bottom 1"], ["comp", "In"], xlrmTT, "TT-002");
    await patch(["comp", "Out"], ["apollo", "Mic/Line In 1"], xlr10, "A-021");

    // Second mic straight into channel 2.
    await patch(["sm7b", "Out"], ["pre", "Mic In 2"], xlr25, "A-016");
    await patch(["pre", "Out 2"], ["apollo", "Mic/Line In 2"], xlr10, "A-022");

    // Ribbon on the guitar cab. No cable assigned yet on purpose, so the
    // pull list and the "no cable" marker both have something to show.
    await patch(["r121", "Out"], ["apollo", "Mic/Line In 3"]);

    /*
     * One run patched with the wrong thing on purpose. A TT bantam lead into
     * an XLR jack does not fit, and the demo is far more convincing when the
     * connector check is visibly catching something than when every line is
     * green. This is the row that proves the validation is real.
     */
    await patch(["pre", "Out 2"], ["apollo", "Mic/Line In 4"], tt, "A-099");

    /*
     * And one recorded too vaguely to grade: the locker row says "patch
     * lead" and nothing about its ends, so the fit is "vague" rather than a
     * confident yes. That is the honest answer, and it is worth showing.
     */
    await patch(["comp", "Out"], ["bay", "Top 3"], vague, "U-001");

    // Monitoring, both sides.
    await patch(["apollo", "Monitor Out L"], ["monitors", "XLR In"], trsXlr, undefined, {
      source: "OUT TO MONITORS L",
      target: "IN FROM APOLLO",
    });

    /* ── A little live state ────────────────────────────────── */
    const micIn1 = placed.pre?.ports["Mic In 1"];
    const micIn2 = placed.pre?.ports["Mic In 2"];
    if (micIn1) await ctx.db.patch(micIn1, { state: { phantom: true, hpf: true } });
    if (micIn2) await ctx.db.patch(micIn2, { state: { phantom: true, pad: true } });

    /* ── Notes on the wall ──────────────────────────────────────
       Half of what an engineer needs to say about a rig is not a
       connection. Without somewhere to write it, it goes on actual tape
       and is lost, so the demo shows the notes doing real work. */
    const NOTES = [
      {
        text: "Neve ch2 crackles above +6. Booked for service Thursday - do not repatch.",
        color: "red",
        position: { x: 352, y: 620 },
      },
      {
        text: "R-121 on the guitar cab. NEVER send 48V down this line: it will destroy the ribbon.",
        color: "amber",
        position: { x: 32, y: 600 },
      },
      {
        text: "Bay rows 1-8 are half-normalled to the Neve. Patching the bottom row breaks the normal.",
        color: "blue",
        position: { x: 688, y: 470 },
      },
      {
        text: "Leave the vocal chain patched for Maya's session Friday.",
        color: "green",
        position: { x: 1024, y: 620 },
      },
    ] as const;

    for (const note of NOTES) {
      await ctx.db.insert("patchAnnotations", {
        orgId,
        patchSpaceId,
        text: note.text,
        color: note.color,
        position: note.position,
        size: { width: 240, height: 132 },
        createdAt: Date.now(),
        createdBy: "Seed",
      });
    }

    /* ── Where each device's I/O came from ──────────────────────
       The canvas distinguishes a hand-verified port list from a guess, and
       that only means something if the demo contains both. The rack gear is
       confirmed; the odd item is left openly unconfirmed so the "these
       ports are a guess" state is on screen rather than described. */
    for (const key of ["u47", "sm7b", "r121", "pre", "comp", "bay", "apollo"]) {
      const device = placed[key];
      if (!device) continue;
      const instance = await ctx.db.get(device.deviceId);
      if (instance) {
        await ctx.db.patch(instance.profileId, {
          specSource: "curated",
          specVerifiedAt: Date.now(),
          specVerifiedBy: "Studio",
        });
      }
    }
    if (placed.monitors) {
      const instance = await ctx.db.get(placed.monitors.deviceId);
      if (instance) {
        await ctx.db.patch(instance.profileId, {
          specSource: "ai",
          specNote: "2 line inputs (XLR and TRS)",
          specVerifiedAt: undefined,
          specVerifiedBy: undefined,
        });
      }
    }

    await ctx.db.patch(patchSpaceId, { revision: Date.now() });

    return {
      patchSpaceId,
      devices: Object.keys(placed).length,
      cableTypes: CABLE_STOCK.length,
      notes: NOTES.length,
    };
  },
});


/**
 * Remove everything a seed run created for one org, and create nothing.
 *
 * Exists because seeding the wrong org id leaves a patch space nothing in
 * the app will ever surface - invisible junk in a production database is
 * still junk, and there was no way to take it back out.
 */
export const clear = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const spaces = (
      await ctx.db
        .query("patchSpaces")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
    ).filter((space) => (space.description ?? "").includes(TAG));

    for (const space of spaces) {
      for (const table of [
        "connections",
        "ports",
        "deviceInstances",
        "patchAnnotations",
      ] as const) {
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

    const gear = (
      await ctx.db
        .query("equipment")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
    ).filter((row) => (row.notes ?? "").includes(TAG));
    for (const row of gear) await ctx.db.delete(row._id);

    return { spaces: spaces.length, gear: gear.length };
  },
});
