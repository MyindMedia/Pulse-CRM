import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation } from "./functions";
import { currentOrg, currentOrgWithCapability, currentMoneySight } from "./lib/tenant";

/* The Messages page: every client conversation in a studio, one row each,
   beside the thread and the client card. Messages themselves stay in
   clientMessages; this module only groups them and keeps each conversation's
   read, archived and AI-replies state (messageThreads). */

/** How far back the conversation list looks. A studio's busiest month fits
 *  many times over; older conversations are still on each client's page. */
const SCAN = 3000;
const LIST_MAX = 300;

const viewV = v.union(v.literal("all"), v.literal("unread"), v.literal("waiting"), v.literal("archived"));

export type Conversation = {
  artistId: Id<"artists">;
  name: string;
  phone: string | null;
  lastAt: number;
  lastBody: string;
  lastDirection: "in" | "out";
  lastChannel: Doc<"clientMessages">["channel"];
  unread: boolean;
  waiting: boolean;
  archived: boolean;
};

async function threadState(ctx: QueryCtx | MutationCtx, orgId: string, artistId: Id<"artists">) {
  return ctx.db
    .query("messageThreads")
    .withIndex("by_org_artist", (q) => q.eq("orgId", orgId).eq("artistId", artistId))
    .first();
}

/** The studio's conversations, newest first. unread: the client wrote after
 *  the studio last opened it. waiting: the client wrote last and nobody
 *  replied or marked it handled (the same rule as the client page). */
export const conversations = query({
  args: { view: v.optional(viewV), search: v.optional(v.string()) },
  handler: async (ctx, { view = "all", search }): Promise<Conversation[]> => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db.query("clientMessages").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(SCAN);

    const latest = new Map<Id<"artists">, Doc<"clientMessages">>();
    const latestIn = new Map<Id<"artists">, number>();
    for (const m of rows) {
      if (!latest.has(m.artistId)) latest.set(m.artistId, m);
      if (m.direction === "in" && !latestIn.has(m.artistId)) latestIn.set(m.artistId, m._creationTime);
    }
    const states = new Map(
      (await ctx.db.query("messageThreads").withIndex("by_org_artist", (q) => q.eq("orgId", orgId)).collect()).map((t) => [t.artistId, t]),
    );
    const needle = search?.trim().toLowerCase() ?? "";

    const out: Conversation[] = [];
    for (const [artistId, m] of latest) {
      const artist = await ctx.db.get(artistId);
      if (!artist || artist.orgId !== orgId || artist.erasedAt) continue;
      const state = states.get(artistId);
      const inAt = latestIn.get(artistId);
      const c: Conversation = {
        artistId,
        name: artist.name,
        phone: artist.phone ?? null,
        lastAt: m._creationTime,
        lastBody: m.body,
        lastDirection: m.direction,
        lastChannel: m.channel,
        unread: inAt !== undefined && inAt > (state?.readAt ?? 0),
        waiting: m.direction === "in" && !m.handledAt,
        archived: state?.archivedAt !== undefined && state.archivedAt >= m._creationTime,
      };
      if (view === "archived" ? !c.archived : c.archived) continue;
      if (view === "unread" && !c.unread) continue;
      if (view === "waiting" && !c.waiting) continue;
      if (needle && !`${c.name} ${c.phone ?? ""} ${c.lastBody}`.toLowerCase().includes(needle)) continue;
      out.push(c);
    }
    return out.sort((a, b) => b.lastAt - a.lastAt).slice(0, LIST_MAX);
  },
});

/** How many conversations have something the studio has not seen. */
export const unreadCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db.query("clientMessages").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(SCAN);
    const latestIn = new Map<Id<"artists">, number>();
    for (const m of rows) if (m.direction === "in" && !latestIn.has(m.artistId)) latestIn.set(m.artistId, m._creationTime);
    let n = 0;
    for (const [artistId, at] of latestIn) {
      const state = await threadState(ctx, orgId, artistId);
      if (at > (state?.readAt ?? 0) && !(state?.archivedAt !== undefined && state.archivedAt >= at)) n++;
    }
    return n;
  },
});

export type ThreadMessage = Doc<"clientMessages"> & {
  /** Who wrote an outbound message, as the studio reads it. */
  author: { kind: "person"; name: string } | { kind: "agent" } | { kind: "auto" } | null;
};

/** One client's conversation, oldest first, with each outbound message
 *  attributed: a team member, the Pulse agent, or an automatic text. */
export const thread = query({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }): Promise<ThreadMessage[]> => {
    const orgId = await currentOrg(ctx);
    const artist = await ctx.db.get(artistId);
    if (!artist || artist.orgId !== orgId) return [];
    const rows = await ctx.db.query("clientMessages").withIndex("by_artist", (q) => q.eq("artistId", artistId)).collect();
    const names = new Map<string, string | null>();
    const out: ThreadMessage[] = [];
    for (const m of rows.sort((a, b) => a._creationTime - b._creationTime)) {
      let author: ThreadMessage["author"] = null;
      if (m.direction === "out") {
        const by = m.sentBy;
        if (!by || by === "Autopilot") author = { kind: "auto" };
        else if (by.startsWith("receptionist")) author = { kind: "agent" };
        else {
          if (!names.has(by)) {
            const member = await ctx.db
              .query("members")
              .withIndex("by_org_clerk", (q) => q.eq("orgId", orgId).eq("clerkUserId", by))
              .first();
            names.set(by, member?.name ?? null);
          }
          const name = names.get(by);
          author = { kind: "person", name: name ?? "Your studio" };
        }
      }
      out.push({ ...m, author });
    }
    return out;
  },
});

/** The client card beside a conversation. Money only for roles that see money. */
export const contact = query({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => {
    const orgId = await currentOrg(ctx);
    const artist = await ctx.db.get(artistId);
    if (!artist || artist.orgId !== orgId || artist.erasedAt) return null;
    const now = Date.now();
    const sessions = await ctx.db.query("sessions").withIndex("by_artist", (q) => q.eq("artistId", artistId)).collect();
    const next = sessions
      .filter((s) => s.startTime > now && s.status !== "cancelled" && s.status !== "no_show")
      .sort((a, b) => a.startTime - b.startTime)[0];
    const room = next?.roomId ? await ctx.db.get(next.roomId) : null;
    const sight = await currentMoneySight(ctx);
    let outstandingCents: number | null = null;
    if (sight.money) {
      const invoices = await ctx.db.query("invoices").withIndex("by_artist", (q) => q.eq("artistId", artistId)).collect();
      outstandingCents = invoices
        .filter((i) => i.status === "sent" || i.status === "viewed" || i.status === "overdue")
        .reduce((s, i) => s + i.amountCents, 0);
    }
    const state = await threadState(ctx, orgId, artistId);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return {
      artistId,
      name: artist.name,
      phone: artist.phone ?? null,
      email: artist.email ?? null,
      status: artist.status,
      tags: artist.tags ?? [],
      sessionCount: sessions.filter((s) => s.status === "completed").length,
      next: next ? { sessionId: next._id, title: next.title, startTime: next.startTime, endTime: next.endTime, room: room?.name ?? null } : null,
      outstandingCents,
      receptionistOn: org?.aiReceptionistEnabled === true,
      aiRepliesOff: state?.aiRepliesOff === true,
    };
  },
});

async function upsertState(
  ctx: MutationCtx,
  orgId: string,
  artistId: Id<"artists">,
  patch: Partial<Pick<Doc<"messageThreads">, "readAt" | "archivedAt" | "aiRepliesOff">>,
) {
  const row = await threadState(ctx, orgId, artistId);
  if (row) await ctx.db.patch(row._id, patch);
  else await ctx.db.insert("messageThreads", { orgId, artistId, ...patch });
}

async function ownArtist(ctx: MutationCtx, orgId: string, artistId: Id<"artists">) {
  const artist = await ctx.db.get(artistId);
  if (!artist || artist.orgId !== orgId || artist.erasedAt) throw new ConvexError("Client not found.");
}

/** Opening a conversation reads it. */
export const markRead = mutation({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => {
    const orgId = await currentOrg(ctx);
    await ownArtist(ctx, orgId, artistId);
    await upsertState(ctx, orgId, artistId, { readAt: Date.now() });
  },
});

export const setArchived = mutation({
  args: { artistId: v.id("artists"), archived: v.boolean() },
  handler: async (ctx, { artistId, archived }) => {
    const orgId = await currentOrgWithCapability(ctx, "artists.edit");
    await ownArtist(ctx, orgId, artistId);
    await upsertState(ctx, orgId, artistId, { archivedAt: archived ? Date.now() : undefined });
  },
});

/** Turn the AI receptionist's replies off (or back on) for one client. */
export const setAiReplies = mutation({
  args: { artistId: v.id("artists"), on: v.boolean() },
  handler: async (ctx, { artistId, on }) => {
    const orgId = await currentOrgWithCapability(ctx, "artists.edit");
    await ownArtist(ctx, orgId, artistId);
    await upsertState(ctx, orgId, artistId, { aiRepliesOff: !on });
  },
});
