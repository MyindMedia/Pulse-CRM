import { query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import { ConvexError, v } from "convex/values";
import { currentOrg } from "./lib/tenant";

/* ============================================================
   Credit Approval (Grilled decision 5): a Member's imported credits
   stay inside the Studio until an owner or manager approves them for
   the booking page. A credit never moves money; only a signed split
   sheet does.
   ============================================================ */

async function mySeat(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in first." });
  const orgId = await currentOrg(ctx);
  const me = await ctx.db
    .query("members")
    .withIndex("by_org_clerk", (q) => q.eq("orgId", orgId).eq("clerkUserId", identity.subject))
    .first();
  if (!me) throw new ConvexError({ code: "SCOPE_DENIED", message: "You're not on this studio's team." });
  return { orgId, me, approver: me.role === "owner" || me.role === "manager" };
}

/** A Member's imported credits: for that Member, or an owner or manager. */
export const forMember = query({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) => {
    const { orgId, me, approver } = await mySeat(ctx);
    if (!approver && me._id !== memberId) return null;
    const member = await ctx.db.get(memberId);
    if (!member || member.orgId !== orgId) return null;
    const rows = await ctx.db
      .query("importedCredits")
      .withIndex("by_org_member", (q) => q.eq("orgId", orgId).eq("memberId", memberId))
      .take(1000);
    const songs = new Map<string, { title: string; artistName: string } | null>();
    const out = [];
    for (const r of rows) {
      if (!songs.has(r.songId)) {
        const song = await ctx.db.get(r.songId);
        const artist = song ? await ctx.db.get(song.artistId) : null;
        songs.set(r.songId, song && song.orgId === orgId ? { title: song.title, artistName: artist?.name ?? "" } : null);
      }
      const s = songs.get(r.songId);
      if (!s) continue;
      out.push({ _id: r._id, songId: r.songId, ...s, role: r.role, source: r.source, approved: r.approved });
    }
    return { canApprove: approver, credits: out };
  },
});

/** Approve (or withdraw) imported credits for the booking page. */
export const approve = mutation({
  args: {
    memberId: v.id("members"),
    creditIds: v.array(v.id("importedCredits")),
    approved: v.boolean(),
  },
  handler: async (ctx, { memberId, creditIds, approved }) => {
    const { orgId, me, approver } = await mySeat(ctx);
    if (!approver) throw new ConvexError({ code: "CAPABILITY_DENIED", message: "Only an owner or manager can approve credits." });
    if (creditIds.length > 500) throw new ConvexError({ code: "BAD_REQUEST", message: "Approve at most 500 at a time." });
    let changed = 0;
    for (const id of creditIds) {
      const row = await ctx.db.get(id);
      if (!row || row.orgId !== orgId || row.memberId !== memberId || row.approved === approved) continue;
      await ctx.db.patch(id, approved
        ? { approved: true, approvedBy: me.clerkUserId ?? me._id, approvedAt: Date.now() }
        : { approved: false, approvedBy: undefined, approvedAt: undefined });
      changed++;
    }
    return { changed };
  },
});
