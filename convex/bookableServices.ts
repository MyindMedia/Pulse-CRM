import { query } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { v, ConvexError } from "convex/values";
import { currentOrg, assertOrg } from "./lib/tenant";

/* ============================================================
   Bookable services - the studio's catalogue.

   A service is what the studio SELLS; a room is the resource that service
   consumes. Slang City runs recording, podcast, interviews, green screen and
   photoshoots out of two rooms, so a booking page that asks a client to pick
   "Live Room / Work Space" is asking them to know something only the studio
   knows. They pick "Podcast"; Pulse books the room behind it.

   Several services can share one room on purpose: booking the podcast at 3pm
   has to take the green screen off the market at 3pm when they are the same
   four walls. That is the whole reason a service points at a room instead of
   being one.
   ============================================================ */

const pricingModeV = v.union(v.literal("hourly"), v.literal("flat"));

const serviceTypeV = v.union(
  v.literal("recording"),
  v.literal("mixing"),
  v.literal("mastering"),
  v.literal("production"),
  v.literal("consultation"),
  v.literal("rehearsal"),
  v.literal("writing"),
  v.literal("custom"),
);

/** The studio's catalogue, in display order, with the room each one uses. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = (
      await ctx.db
        .query("bookableServices")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
    ).sort((a, b) => a.order - b.order);

    return await Promise.all(
      rows.map(async (s) => {
        const room = await ctx.db.get(s.roomId);
        const addOns = (
          await Promise.all((s.addOnFeeIds ?? []).map((id) => ctx.db.get(id)))
        )
          .filter((f) => f !== null)
          .map((f) => ({ _id: f._id, label: f.label, amountCents: f.amountCents }));
        return {
          ...s,
          roomName: room?.name ?? "Room removed",
          roomBookable: room?.bookable !== false && room?.status !== "retired",
          addOns,
        };
      }),
    );
  },
});

function assertTerms(args: {
  pricingMode: "hourly" | "flat";
  priceCents: number;
  minimumHours?: number;
  blockHours?: number;
  depositPct?: number;
}) {
  if (args.priceCents < 0) throw new ConvexError("A price cannot be negative.");
  if (args.depositPct !== undefined && (args.depositPct < 0 || args.depositPct > 100)) {
    throw new ConvexError("A deposit is a percentage between 0 and 100.");
  }
  /* A flat service is a block at a price. Without the block there is nothing
     to book - "$150" is not a length of time - and the picker would quietly
     fall back to an hour. */
  if (args.pricingMode === "flat" && !(args.blockHours && args.blockHours > 0)) {
    throw new ConvexError("A flat-price service needs the length of the block it sells.");
  }
  if (args.pricingMode === "hourly" && args.minimumHours !== undefined && args.minimumHours <= 0) {
    throw new ConvexError("A minimum booking is at least one hour.");
  }
}

export const create = mutation({
  args: {
    name: v.string(),
    blurb: v.optional(v.string()),
    pricingMode: pricingModeV,
    priceCents: v.number(),
    minimumHours: v.optional(v.number()),
    blockHours: v.optional(v.number()),
    depositPct: v.optional(v.number()),
    roomId: v.id("rooms"),
    sessionServiceType: v.optional(serviceTypeV),
    addOnFeeIds: v.optional(v.array(v.id("feeTemplates"))),
    heroImageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);
    const name = args.name.trim();
    if (!name) throw new ConvexError("Give the service a name.");
    const room = await ctx.db.get(args.roomId);
    assertOrg(room, orgId);
    assertTerms(args);

    const existing = await ctx.db
      .query("bookableServices")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    return await ctx.db.insert("bookableServices", {
      ...args,
      orgId,
      name,
      blurb: args.blurb?.trim() || undefined,
      // Last in line by default: a new service should not jump the catalogue.
      order: existing.length ? Math.max(...existing.map((s) => s.order)) + 1 : 0,
      active: true,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("bookableServices"),
    name: v.optional(v.string()),
    blurb: v.optional(v.string()),
    pricingMode: v.optional(pricingModeV),
    priceCents: v.optional(v.number()),
    minimumHours: v.optional(v.number()),
    blockHours: v.optional(v.number()),
    depositPct: v.optional(v.number()),
    roomId: v.optional(v.id("rooms")),
    sessionServiceType: v.optional(serviceTypeV),
    addOnFeeIds: v.optional(v.array(v.id("feeTemplates"))),
    heroImageUrl: v.optional(v.string()),
    order: v.optional(v.number()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrg(ctx);
    const svc = await ctx.db.get(id);
    assertOrg(svc, orgId);
    if (patch.roomId) {
      const room = await ctx.db.get(patch.roomId);
      assertOrg(room, orgId);
    }
    // Terms are validated as they will END UP, not as they arrived: a partial
    // edit that flips to flat without a block is the same broken service.
    assertTerms({
      pricingMode: patch.pricingMode ?? svc!.pricingMode,
      priceCents: patch.priceCents ?? svc!.priceCents,
      minimumHours: patch.minimumHours ?? svc!.minimumHours,
      blockHours: patch.blockHours ?? svc!.blockHours,
      depositPct: patch.depositPct ?? svc!.depositPct,
    });

    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, val]) => val !== undefined),
    );
    if (typeof clean.name === "string") {
      const name = clean.name.trim();
      if (!name) throw new ConvexError("Give the service a name.");
      clean.name = name;
    }
    await ctx.db.patch(id, clean);
  },
});

/** Delete a service. Sessions already booked through it keep their own copy of
 *  the name and price, so removing it changes nothing that has happened. */
export const remove = mutation({
  args: { id: v.id("bookableServices") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const svc = await ctx.db.get(id);
    assertOrg(svc, orgId);
    await ctx.db.delete(id);
  },
});

/* ── Ops ──────────────────────────────────────────────────────
   Loading a studio's catalogue from their brochure, the way
   pricingImport loads their price list. Idempotent by name so a
   corrected brochure can be re-run without doubling the page. */
export const _importForOrg = internalMutation({
  args: {
    orgId: v.string(),
    apply: v.optional(v.boolean()),
    catalog: v.optional(v.union(v.literal("rooms"), v.literal("services"))),
    services: v.array(
      v.object({
        name: v.string(),
        blurb: v.optional(v.string()),
        pricingMode: pricingModeV,
        priceCents: v.number(),
        minimumHours: v.optional(v.number()),
        blockHours: v.optional(v.number()),
        depositPct: v.optional(v.number()),
        /** Matched against room NAMES, since an ops caller has no ids. */
        roomName: v.string(),
        sessionServiceType: v.optional(serviceTypeV),
        /** Matched against feeTemplate LABELS, same reason. */
        addOnLabels: v.optional(v.array(v.string())),
      }),
    ),
  },
  handler: async (ctx, { orgId, apply, catalog, services }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new ConvexError(`No studio with orgId ${orgId}`);

    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const fees = await ctx.db
      .query("feeTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const existing = await ctx.db
      .query("bookableServices")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const created: string[] = [];
    const updated: string[] = [];
    const missingRooms: string[] = [];
    const missingFees: string[] = [];

    let order = 0;
    for (const s of services) {
      const room = rooms.find((r) => same(r.name, s.roomName));
      if (!room) {
        missingRooms.push(`${s.name} -> ${s.roomName}`);
        continue;
      }
      const addOnFeeIds = [];
      for (const label of s.addOnLabels ?? []) {
        const fee = fees.find((f) => same(f.label, label));
        if (fee) addOnFeeIds.push(fee._id);
        else missingFees.push(`${s.name} -> ${label}`);
      }

      const row = {
        name: s.name.trim(),
        blurb: s.blurb?.trim() || undefined,
        pricingMode: s.pricingMode,
        priceCents: s.priceCents,
        minimumHours: s.minimumHours,
        blockHours: s.blockHours,
        depositPct: s.depositPct,
        roomId: room._id,
        sessionServiceType: s.sessionServiceType,
        addOnFeeIds: addOnFeeIds.length ? addOnFeeIds : undefined,
        order: order++,
        active: true,
      };

      const match = existing.find((e) => same(e.name, s.name));
      if (match) {
        updated.push(s.name);
        if (apply) await ctx.db.patch(match._id, row);
      } else {
        created.push(s.name);
        if (apply) await ctx.db.insert("bookableServices", { ...row, orgId, createdAt: Date.now() });
      }
    }

    if (apply && catalog) await ctx.db.patch(org._id, { bookingCatalog: catalog });

    return {
      applied: Boolean(apply),
      studio: org.name,
      catalog: catalog ?? org.bookingCatalog ?? "rooms",
      created,
      updated,
      /* Named rather than invented. A service pointing at a room that does not
         exist would be a card a client can click and never book. */
      missingRooms,
      missingFees,
    };
  },
});
