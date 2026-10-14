import { query } from "./_generated/server";
import { mutation } from "./functions";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { currentOrgWithCapability, currentMoneySight } from "./lib/tenant";
import { requireCapability } from "./lib/access";
import { bookingFeatures, sessionHoldsSlot } from "./lib/roomBusy";
import { orgTz, whenLabel } from "./lib/tz";
import { blockRange, blockValueCents } from "./lib/roomBlockRange";
import { currentMemberId } from "./sessions";

/* Room blocks: an owner or manager holds a room for a day, week or month
   range (a client buyout, maintenance, a build-out). Gated by
   orgs.bookingFeatures.roomBlocks. The shared busy check
   (lib/roomBusy.ts) already treats blocks as busy for the public page,
   createBooking and internal create / reschedule.

   Who: "rooms.edit" is held by owners and managers and NOT by engineers.
   Read ("rooms.read") is open to any staff so the calendar can show them.
   Value: hours in the range x the room's hourly rate at the time of the
   block. The studio has no stored open hours, so every elapsed hour counts
   (24 per local day). It is a separate "blocked value" figure, never revenue. */

const granularityV = v.union(v.literal("day"), v.literal("week"), v.literal("month"));

async function getOrg(ctx: { db: any }, orgId: string): Promise<Doc<"orgs"> | null> {
  return await ctx.db.query("orgs").withIndex("by_org", (q: any) => q.eq("orgId", orgId)).first();
}

function requireSwitch(org: Doc<"orgs"> | null) {
  if (!bookingFeatures(org).roomBlocks) {
    throw new ConvexError("Room blocks are turned off for this studio. Turn them on in Settings.");
  }
}

async function conflictingSessions(
  ctx: { db: any },
  orgId: string,
  roomId: Id<"rooms">,
  start: number,
  end: number,
  tz: string,
): Promise<string[]> {
  const DAY = 86_400_000;
  const rows: Doc<"sessions">[] = await ctx.db
    .query("sessions")
    .withIndex("by_org_start", (q: any) => q.eq("orgId", orgId).gte("startTime", start - DAY).lt("startTime", end))
    .collect();
  return rows
    .filter((s) => s.roomId === roomId && sessionHoldsSlot(s) && s.startTime < end && s.endTime > start)
    .sort((a, b) => a.startTime - b.startTime)
    .map((s) => `${s.title} (${whenLabel(s.startTime, tz)}, ${s.status})`);
}

async function overlappingBlock(
  ctx: { db: any },
  roomId: Id<"rooms">,
  start: number,
  end: number,
  excludeId?: Id<"roomBlocks">,
): Promise<Doc<"roomBlocks"> | null> {
  const rows: Doc<"roomBlocks">[] = await ctx.db
    .query("roomBlocks")
    .withIndex("by_room_start", (q: any) => q.eq("roomId", roomId).gte("startTime", start - 62 * 86_400_000).lt("startTime", end))
    .collect();
  return rows.find((b) => b._id !== excludeId && b.startTime < end && b.endTime > start) ?? null;
}

async function checkRange(
  ctx: { db: any },
  args: {
    orgId: string;
    org: Doc<"orgs"> | null;
    roomId: Id<"rooms">;
    start: number;
    end: number;
    force?: boolean;
    isOwner: boolean;
    excludeBlockId?: Id<"roomBlocks">;
  },
) {
  const tz = orgTz(args.org);
  const clash = await overlappingBlock(ctx, args.roomId, args.start, args.end, args.excludeBlockId);
  if (clash) throw new ConvexError(`This room is already blocked then ("${clash.label}").`);
  const sessions = await conflictingSessions(ctx, args.orgId, args.roomId, args.start, args.end, tz);
  if (sessions.length > 0) {
    if (args.force && !args.isOwner) {
      throw new ConvexError("Only an owner can block over existing sessions.");
    }
    if (!args.force) {
      throw new ConvexError(
        `${sessions.length} session${sessions.length === 1 ? "" : "s"} already booked in that range: ${sessions.join("; ")}. Move or cancel them first${args.isOwner ? ", or block anyway" : ""}.`,
      );
    }
  }
}

async function loadRoom(ctx: { db: any }, orgId: string, roomId: Id<"rooms">): Promise<Doc<"rooms">> {
  const room = await ctx.db.get(roomId);
  if (!room || room.orgId !== orgId) throw new ConvexError("Room not found.");
  return room;
}

async function checkArtist(ctx: { db: any }, orgId: string, artistId?: Id<"artists">) {
  if (!artistId) return;
  const a = await ctx.db.get(artistId);
  if (!a || a.orgId !== orgId) throw new ConvexError("Client not found.");
}

export const create = mutation({
  args: {
    roomId: v.id("rooms"),
    granularity: granularityV,
    startDate: v.string(), // YYYY-MM-DD, studio-local
    endDate: v.string(),
    label: v.string(),
    artistId: v.optional(v.id("artists")),
    note: v.optional(v.string()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "rooms.edit");
    const viewer = await requireCapability(ctx, "rooms.edit");
    const org = await getOrg(ctx, orgId);
    requireSwitch(org);
    const label = args.label.trim();
    if (!label) throw new ConvexError("Add a label, like a client name or Maintenance.");
    const room = await loadRoom(ctx, orgId, args.roomId);
    await checkArtist(ctx, orgId, args.artistId);

    let range;
    try {
      range = blockRange(args.granularity, args.startDate, args.endDate, orgTz(org));
    } catch (e) {
      throw new ConvexError((e as Error).message);
    }
    await checkRange(ctx, {
      orgId, org, roomId: args.roomId, start: range.startTime, end: range.endTime,
      force: args.force, isOwner: (viewer as { role?: string }).role === "owner",
    });

    const hourlyRateCents = room.hourlyRateCents ?? 0;
    return await ctx.db.insert("roomBlocks", {
      orgId,
      roomId: args.roomId,
      startTime: range.startTime,
      endTime: range.endTime,
      granularity: args.granularity,
      label,
      artistId: args.artistId,
      hourlyRateCents,
      valueCents: blockValueCents(hourlyRateCents, range.startTime, range.endTime),
      createdByMemberId: await currentMemberId(ctx),
      note: args.note?.trim() || undefined,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("roomBlocks"),
    roomId: v.optional(v.id("rooms")),
    // Change the range by sending all three.
    granularity: v.optional(granularityV),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    label: v.optional(v.string()),
    artistId: v.optional(v.union(v.id("artists"), v.null())),
    note: v.optional(v.string()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "rooms.edit");
    const viewer = await requireCapability(ctx, "rooms.edit");
    const org = await getOrg(ctx, orgId);
    requireSwitch(org);
    const block = await ctx.db.get(args.id);
    if (!block || block.orgId !== orgId) throw new ConvexError("Block not found.");

    const patch: Partial<Doc<"roomBlocks">> = {};
    if (args.label !== undefined) {
      const label = args.label.trim();
      if (!label) throw new ConvexError("Add a label, like a client name or Maintenance.");
      patch.label = label;
    }
    if (args.note !== undefined) patch.note = args.note.trim() || undefined;
    if (args.artistId !== undefined) {
      if (args.artistId === null) patch.artistId = undefined;
      else {
        await checkArtist(ctx, orgId, args.artistId);
        patch.artistId = args.artistId;
      }
    }

    const rangeFields = [args.granularity, args.startDate, args.endDate];
    const anyRange = rangeFields.some((f) => f !== undefined);
    if (anyRange && rangeFields.some((f) => f === undefined)) {
      throw new ConvexError("To change the dates, send the granularity, start and end together.");
    }
    const roomChanged = args.roomId !== undefined && args.roomId !== block.roomId;
    if (anyRange || roomChanged) {
      const roomId = args.roomId ?? block.roomId;
      const room = await loadRoom(ctx, orgId, roomId);
      let start = block.startTime;
      let end = block.endTime;
      if (anyRange) {
        try {
          const r = blockRange(args.granularity!, args.startDate!, args.endDate!, orgTz(org));
          start = r.startTime;
          end = r.endTime;
        } catch (e) {
          throw new ConvexError((e as Error).message);
        }
        patch.granularity = args.granularity;
      }
      await checkRange(ctx, {
        orgId, org, roomId, start, end, force: args.force,
        isOwner: (viewer as { role?: string }).role === "owner", excludeBlockId: block._id,
      });
      const rate = room.hourlyRateCents ?? 0;
      patch.roomId = roomId;
      patch.startTime = start;
      patch.endTime = end;
      patch.hourlyRateCents = rate;
      patch.valueCents = blockValueCents(rate, start, end);
    }
    await ctx.db.patch(block._id, patch);
    return block._id;
  },
});

export const remove = mutation({
  args: { id: v.id("roomBlocks") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "rooms.edit");
    const org = await getOrg(ctx, orgId);
    requireSwitch(org);
    const block = await ctx.db.get(id);
    if (!block || block.orgId !== orgId) throw new ConvexError("Block not found.");
    await ctx.db.delete(id);
  },
});

/** Blocks overlapping [from, to]. Any staff may read (the calendar shows
 *  them); the dollar value is hidden from people who cannot see money. An
 *  off switch returns an empty list so the calendar needs no special case. */
export const list = query({
  args: { from: v.number(), to: v.number(), roomId: v.optional(v.id("rooms")) },
  handler: async (ctx, { from, to, roomId }) => {
    const orgId = await currentOrgWithCapability(ctx, "rooms.read");
    const org = await getOrg(ctx, orgId);
    if (!bookingFeatures(org).roomBlocks) return [];
    const rows = await ctx.db
      .query("roomBlocks")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", from - 62 * 86_400_000).lte("startTime", to))
      .collect();
    const sight = await currentMoneySight(ctx);
    const out = [];
    for (const b of rows) {
      if (b.endTime <= from || b.startTime > to) continue;
      if (roomId && b.roomId !== roomId) continue;
      const artist = b.artistId ? await ctx.db.get(b.artistId) : null;
      out.push({
        _id: b._id,
        roomId: b.roomId,
        startTime: b.startTime,
        endTime: b.endTime,
        granularity: b.granularity,
        label: b.label,
        artistId: b.artistId ?? null,
        artistName: artist?.name ?? null,
        note: b.note ?? null,
        hourlyRateCents: sight.money ? b.hourlyRateCents : null,
        valueCents: sight.money ? b.valueCents : null,
      });
    }
    return out.sort((a, b) => a.startTime - b.startTime);
  },
});

/** Preview of a block's range and value for the dialog, before saving. */
export const preview = query({
  args: {
    roomId: v.id("rooms"),
    granularity: granularityV,
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "rooms.edit");
    const org = await getOrg(ctx, orgId);
    const room = await ctx.db.get(args.roomId);
    if (!room || room.orgId !== orgId) return null;
    let range;
    try {
      range = blockRange(args.granularity, args.startDate, args.endDate, orgTz(org));
    } catch {
      return null;
    }
    const sight = await currentMoneySight(ctx);
    const rate = room.hourlyRateCents ?? 0;
    return {
      startTime: range.startTime,
      endTime: range.endTime,
      hours: Math.round(((range.endTime - range.startTime) / 3_600_000) * 10) / 10,
      valueCents: sight.money ? blockValueCents(rate, range.startTime, range.endTime) : null,
    };
  },
});

/** Is the room-blocks switch on for this studio? The UI hides the button and
 *  bands when it is not. */
export const enabled = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "rooms.read");
    return bookingFeatures(await getOrg(ctx, orgId)).roomBlocks;
  },
});
