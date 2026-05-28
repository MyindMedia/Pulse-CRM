import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { currentOrg } from "./lib/tenant";
import { requireCapability } from "./lib/access";
import { upsertProposed, type ProposedAction } from "./opsBrain";

/* ============================================================
   Waitlist + smart-fill.

   Studios add artists to a waitlist (optionally scoped to a room,
   a service, and a desired date window). When a slot frees up - a
   hold expires or a booking is cancelled - `proposeWaitlistFill`
   ranks the waiting artists against the freed slot and drops a
   single `waitlist_fill` action (an email to the best match) into
   the approval inbox. The owner approves to notify; nothing sends
   automatically unless they graduate the type to auto.

   The ranking layer is pure data in / data out so it is unit-tested
   without a database.
   ============================================================ */

const serviceLiteral = v.union(
  v.literal("recording"),
  v.literal("mixing"),
  v.literal("mastering"),
  v.literal("production"),
  v.literal("consultation"),
  v.literal("rehearsal"),
  v.literal("writing"),
);

/* ── Pure ranking layer ─────────────────────────────────────── */

export type FreedSlot = {
  roomId?: string;
  serviceType?: string;
  startTime: number;
};

export type RankableEntry = {
  _id: string;
  artistId: string;
  roomId?: string;
  serviceType?: string;
  priority: "standard" | "high";
  preferredFrom?: number;
  preferredTo?: number;
  createdAt: number;
};

/**
 * Score one waiting entry against a freed slot. Higher = better fit.
 * A specified-but-mismatched room or service is penalised; a flexible
 * (unspecified) preference is a mild positive. Outside the desired date
 * window is a strong penalty so we never nudge someone toward a slot they
 * explicitly did not want.
 */
export function scoreEntry(slot: FreedSlot, e: RankableEntry): number {
  let score = 0;
  if (e.priority === "high") score += 100;

  // Room fit.
  if (e.roomId == null) score += 10;
  else if (slot.roomId != null && e.roomId === slot.roomId) score += 40;
  else if (slot.roomId != null && e.roomId !== slot.roomId) score -= 60;

  // Service fit.
  if (e.serviceType == null) score += 8;
  else if (slot.serviceType != null && e.serviceType === slot.serviceType) score += 30;
  else if (slot.serviceType != null && e.serviceType !== slot.serviceType) score -= 40;

  // Desired-window fit.
  const fromOk = e.preferredFrom == null || slot.startTime >= e.preferredFrom;
  const toOk = e.preferredTo == null || slot.startTime <= e.preferredTo;
  if (fromOk && toOk) score += 25;
  else score -= 50;

  return score;
}

/** Rank waiting entries best-first; FIFO (oldest first) breaks ties. */
export function rankWaitlist<T extends RankableEntry>(slot: FreedSlot, entries: T[]): T[] {
  return [...entries]
    .map((e) => ({ e, s: scoreEntry(slot, e) }))
    .sort((a, b) => (b.s - a.s) || (a.e.createdAt - b.e.createdAt))
    .map((x) => x.e);
}

/** Best positive-fit entry for a freed slot, or null if none fit. */
export function bestFit<T extends RankableEntry>(slot: FreedSlot, entries: T[]): T | null {
  const ranked = rankWaitlist(slot, entries);
  const top = ranked[0];
  return top && scoreEntry(slot, top) > 0 ? top : null;
}

/* ── Slot-fill: build the approval action ───────────────────── */

function formatSlot(startTime: number): string {
  return new Date(startTime).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * When `session` frees up, propose notifying the best-matched waiting artist.
 * Reuses `upsertProposed` so dedupe (`waitlist_fill:<sessionId>`) + autonomy
 * graduation work exactly like every other ops action. Safe no-op when the
 * waitlist is empty or no one fits.
 */
export async function proposeWaitlistFill(ctx: MutationCtx, session: Doc<"sessions">): Promise<boolean> {
  // Never offer a slot that has already started - it is not fillable.
  if (session.startTime < Date.now()) return false;

  const waiting = await ctx.db
    .query("waitlistEntries")
    .withIndex("by_org_status", (q) => q.eq("orgId", session.orgId).eq("status", "waiting"))
    .collect();
  if (waiting.length === 0) return false;

  const slot: FreedSlot = {
    roomId: session.roomId ?? undefined,
    serviceType: session.serviceType ?? undefined,
    startTime: session.startTime,
  };
  const rankable: (RankableEntry & { _id: Id<"waitlistEntries"> })[] = waiting.map((e) => ({
    _id: e._id,
    artistId: e.artistId,
    roomId: e.roomId ?? undefined,
    serviceType: e.serviceType ?? undefined,
    priority: e.priority,
    preferredFrom: e.preferredFrom ?? undefined,
    preferredTo: e.preferredTo ?? undefined,
    createdAt: e.createdAt,
  }));
  const winner = bestFit(slot, rankable);
  if (!winner) return false;

  const artist = await ctx.db.get(winner.artistId as Id<"artists">);
  if (!artist || !artist.email) return false;

  const room = session.roomId ? await ctx.db.get(session.roomId) : null;
  const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", session.orgId)).first();
  const studioName = org?.name ?? "the studio";
  const where = room ? ` in ${room.name}` : "";
  const when = formatSlot(session.startTime);

  const candidate: ProposedAction = {
    type: "waitlist_fill",
    priority: winner.priority === "high" ? "high" : "medium",
    title: `Offer the open ${when} slot to ${artist.name}`,
    rationale: `${artist.name} is on the waitlist and is the best match for the slot that just opened${where} on ${when}. Offer it before it goes cold.`,
    entityType: "session",
    entityId: session._id,
    payload: {
      kind: "email",
      to: artist.email,
      subject: `A studio slot just opened up - ${when}`,
      body: `Hi ${artist.name},\n\nA session slot just opened up at ${studioName}${where} on ${when}. You are on our waitlist, so you get first pick.\n\nWant it? Reply to this email and we will lock it in.`,
      notifyKind: "waitlist.offer",
    },
  };

  await upsertProposed(ctx, session.orgId, [candidate]);
  await ctx.db.patch(winner._id as Id<"waitlistEntries">, { status: "notified", lastNotifiedAt: Date.now() });
  return true;
}

/* ── Studio-facing CRUD ─────────────────────────────────────── */

/** Waitlist for the current studio, newest first, with artist + room labels. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "sessions.read", { orgId });
    const rows = await ctx.db
      .query("waitlistEntries")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const active = rows
      .filter((r) => r.status === "waiting" || r.status === "notified")
      .sort((a, b) => b.createdAt - a.createdAt);
    return Promise.all(
      active.map(async (r) => {
        const artist = await ctx.db.get(r.artistId);
        const room = r.roomId ? await ctx.db.get(r.roomId) : null;
        return {
          ...r,
          artistName: artist?.name ?? "Unknown",
          artistEmail: artist?.email ?? null,
          roomName: room?.name ?? null,
        };
      }),
    );
  },
});

/** Add an artist to the waitlist. */
export const add = mutation({
  args: {
    artistId: v.id("artists"),
    roomId: v.optional(v.id("rooms")),
    serviceType: v.optional(serviceLiteral),
    priority: v.optional(v.union(v.literal("standard"), v.literal("high"))),
    preferredFrom: v.optional(v.number()),
    preferredTo: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "sessions.edit", { orgId });
    const artist = await ctx.db.get(args.artistId);
    if (!artist || artist.orgId !== orgId) throw new Error("Artist not found");
    return ctx.db.insert("waitlistEntries", {
      orgId,
      artistId: args.artistId,
      roomId: args.roomId,
      serviceType: args.serviceType,
      priority: args.priority ?? "standard",
      status: "waiting",
      preferredFrom: args.preferredFrom,
      preferredTo: args.preferredTo,
      note: args.note,
      createdAt: Date.now(),
    });
  },
});

/** Remove (or re-activate) a waitlist entry. */
export const setStatus = mutation({
  args: {
    id: v.id("waitlistEntries"),
    status: v.union(v.literal("waiting"), v.literal("notified"), v.literal("booked"), v.literal("removed")),
  },
  handler: async (ctx, { id, status }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "sessions.edit", { orgId });
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { status });
  },
});
