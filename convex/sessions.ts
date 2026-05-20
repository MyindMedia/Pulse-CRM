import { query, mutation, QueryCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { currentOrg } from "./lib/tenant";
import {
  assertNoBufferConflict,
  recomputeRoomStatus,
} from "./lib/roomStatus";
import { stageChecklistsFor, dropPreChecklistFor } from "./checklists";

const serviceV = v.union(
  v.literal("recording"),
  v.literal("mixing"),
  v.literal("mastering"),
  v.literal("production"),
  v.literal("consultation"),
  v.literal("rehearsal"),
  v.literal("writing"),
);
const statusV = v.union(
  v.literal("tentative"),
  v.literal("confirmed"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("cancelled"),
  v.literal("no_show"),
);

/** Hydrate a session with its artist / song / room / engineer names. */
async function hydrate(ctx: QueryCtx, s: Doc<"sessions">) {
  const [artist, song, room, engineer] = await Promise.all([
    s.artistId ? ctx.db.get(s.artistId) : null,
    s.songId ? ctx.db.get(s.songId) : null,
    s.roomId ? ctx.db.get(s.roomId) : null,
    s.engineerId ? ctx.db.get(s.engineerId) : null,
  ]);
  return {
    ...s,
    artistName: artist?.name ?? "Unknown",
    songTitle: song?.title ?? null,
    roomName: room?.name ?? null,
    engineerName: engineer?.name ?? null,
  };
}

export const list = query({
  args: { status: v.optional(statusV) },
  handler: async (ctx, { status }) => {
    const orgId = await currentOrg(ctx);
    const rows = status
      ? await ctx.db.query("sessions").withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", status)).collect()
      : await ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const hydrated = await Promise.all(rows.map((r) => hydrate(ctx, r)));
    return hydrated.sort((a, b) => a.startTime - b.startTime);
  },
});

export const inRange = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", from).lte("startTime", to))
      .collect();
    return Promise.all(rows.map((r) => hydrate(ctx, r)));
  },
});

export const upcoming = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const orgId = await currentOrg(ctx);
    const now = Date.now();
    const rows = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", now))
      .take(limit ?? 8);
    return Promise.all(rows.map((r) => hydrate(ctx, r)));
  },
});

export const get = query({
  args: { id: v.id("sessions") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const s = await ctx.db.get(id);
    if (!s || s.orgId !== orgId) return null;
    const log = await ctx.db.query("engineeringLogs").withIndex("by_session", (q) => q.eq("sessionId", id)).first();
    return { ...(await hydrate(ctx, s)), engineeringLog: log };
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    artistId: v.id("artists"),
    songId: v.optional(v.id("songs")),
    serviceType: serviceV,
    roomId: v.optional(v.id("rooms")),
    engineerId: v.optional(v.id("members")),
    startTime: v.number(),
    endTime: v.number(),
    rateCents: v.number(),
    depositCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);
    const artist = await ctx.db.get(args.artistId);
    if (!artist || artist.orgId !== orgId) throw new Error("Artist not found");

    // 15-minute reset buffer between sessions in the same room.
    await assertNoBufferConflict(ctx, args.roomId, args.startTime, args.endTime);

    // Smart-deposit shield: a session is only tentative until the deposit clears.
    const deposit = args.depositCents ?? Math.round(args.rateCents * 0.3);
    const id = await ctx.db.insert("sessions", {
      orgId,
      title: args.title,
      artistId: args.artistId,
      songId: args.songId,
      serviceType: args.serviceType,
      roomId: args.roomId,
      engineerId: args.engineerId,
      startTime: args.startTime,
      endTime: args.endTime,
      status: "tentative",
      rateCents: args.rateCents,
      depositCents: deposit,
      depositPaid: false,
      intakeCompleted: false,
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "session.created",
      summary: `${args.title} held for ${artist.name} - awaiting deposit`,
      entityType: "session",
      entityId: id,
      accent: "info",
    });
    // Stage the pre + post checklists so engineers and interns can tick
    // through them before / after the session.
    await stageChecklistsFor(ctx, {
      orgId,
      sessionId: id,
      roomId: args.roomId,
    });
    // Auto-recompute the room's status so the dashboard reflects the change.
    if (args.roomId) await recomputeRoomStatus(ctx, args.roomId);
    return id;
  },
});

export const payDeposit = mutation({
  args: { id: v.id("sessions") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const s = await ctx.db.get(id);
    if (!s || s.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { depositPaid: true, status: "confirmed" });
    if (s.roomId) await recomputeRoomStatus(ctx, s.roomId);
    await ctx.db.insert("activity", {
      orgId,
      kind: "session.confirmed",
      summary: `Deposit cleared - ${s.title} is confirmed on the calendar`,
      entityType: "session",
      entityId: id,
      accent: "positive",
    });
    // Surface a pre-session checklist alert via the existing insights bell.
    await ctx.db.insert("insights", {
      orgId,
      kind: "recap",
      severity: "info",
      title: `Pre-session checklist ready - ${s.title}`,
      body: `Confirmed for ${longDateLite(s.startTime)}. Walk the pre-session checklist before the artist arrives.`,
      entityType: "session",
      entityId: id,
      status: "new",
    });
  },
});

/** Local one-liner to avoid importing the whole format lib server-side. */
function longDateLite(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const setStatus = mutation({
  args: { id: v.id("sessions"), status: statusV },
  handler: async (ctx, { id, status }) => {
    const orgId = await currentOrg(ctx);
    const s = await ctx.db.get(id);
    if (!s || s.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { status });
    // Status change cascades to the room: cancelling an active session
    // flips the room back to available; starting one flips it to in_use.
    if (s.roomId) await recomputeRoomStatus(ctx, s.roomId);

    // Cancelled / no-show before-it-ran -> drop the unused pre-checklist
    // so we don't keep alerting staff for a session that won't happen.
    if (status === "cancelled" || status === "no_show") {
      await dropPreChecklistFor(ctx, id);
    }

    if (status === "no_show") {
      const artist = await ctx.db.get(s.artistId);
      if (artist) await ctx.db.patch(s.artistId, { reliability: "watch" });
      await ctx.db.insert("activity", {
        orgId, kind: "session.no_show",
        summary: `No-show flagged - ${artist?.name ?? "client"} marked for review`,
        entityType: "session", entityId: id, accent: "critical",
      });
    }

    // Session completed → fan out: invoice the balance + queue a recap insight.
    if (status === "completed") {
      const artist = await ctx.db.get(s.artistId);
      await ctx.db.patch(s.artistId, {
        sessionCount: (artist?.sessionCount ?? 0) + 1,
        lifetimeValueCents: (artist?.lifetimeValueCents ?? 0) + s.rateCents,
        lastContactAt: Date.now(),
        status: artist?.status === "lead" ? "active" : artist?.status,
      });
      const balance = s.rateCents - (s.depositPaid ? s.depositCents : 0);
      if (balance > 0) {
        const num = `PLS-${String(Date.now()).slice(-6)}`;
        await ctx.db.insert("invoices", {
          orgId, number: num, artistId: s.artistId, songId: s.songId, sessionId: id,
          status: "draft",
          lineItems: [{ label: `${s.title} - balance`, amountCents: balance }],
          amountCents: balance,
          dueDate: Date.now() + 14 * 86400000,
        });
      }
      await ctx.db.insert("insights", {
        orgId, kind: "recap", severity: "info",
        title: `Post-session checklist + recap - ${s.title}`,
        body: `Session complete. Walk the post-session checklist (clean / reset / lock the room) and log the engineering recall sheet for ${artist?.name ?? "the client"}.`,
        entityType: "session", entityId: id, status: "new",
      });
      await ctx.db.insert("activity", {
        orgId, kind: "session.completed",
        summary: `${s.title} completed - balance invoiced automatically`,
        entityType: "session", entityId: id, accent: "positive",
      });
    }
  },
});

export const completeIntake = mutation({
  args: { id: v.id("sessions") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const s = await ctx.db.get(id);
    if (!s || s.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { intakeCompleted: true });
  },
});
