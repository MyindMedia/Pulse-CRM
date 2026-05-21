/* ============================================================
   Queries + mutations for AI-generated artifacts (session recaps,
   prep packets, reminders, briefings, rate-cut promos).
   ============================================================ */
import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { currentOrg } from "./lib/tenant";

/** Newest-first list, optionally filtered by kind. Used by the dashboard
 * "Pulse AI" feed. Dismissed artifacts are hidden by default; pass
 * includeDismissed: true to surface them again. */
export const list = query({
  args: {
    kind: v.optional(v.string()),
    limit: v.optional(v.number()),
    includeDismissed: v.optional(v.boolean()),
  },
  handler: async (ctx, { kind, limit, includeDismissed }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("aiArtifacts")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    let filtered = kind ? rows.filter((r) => r.kind === kind) : rows;
    if (!includeDismissed) {
      filtered = filtered.filter((r) => r.status !== "dismissed");
    }
    return filtered.sort((a, b) => b.generatedAt - a.generatedAt).slice(0, limit ?? 20);
  },
});

/** Most recent artifact for one session, or null. Used by the session sheet. */
export const forSession = query({
  args: { sessionId: v.id("sessions"), kind: v.optional(v.string()) },
  handler: async (ctx, { sessionId, kind }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("aiArtifacts")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    const filtered = rows.filter(
      (r) => r.orgId === orgId && (!kind || r.kind === kind),
    );
    return filtered.sort((a, b) => b.generatedAt - a.generatedAt);
  },
});

/** Flip an artifact's status (acknowledged means staff read it; dismissed
 * means it's hidden from the unread feed). */
export const setStatus = mutation({
  args: {
    id: v.id("aiArtifacts"),
    status: v.union(
      v.literal("ready"),
      v.literal("acknowledged"),
      v.literal("dismissed"),
    ),
  },
  handler: async (ctx, { id, status }) => {
    const orgId = await currentOrg(ctx);
    const a = await ctx.db.get(id);
    if (!a || a.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { status });
  },
});

/** Delete every artifact of a kind. Useful when the prompt template
 * changes and the stale rows would otherwise clutter the dashboard. */
export const removeByKind = mutation({
  args: {
    kind: v.union(
      v.literal("session_recap"),
      v.literal("prep_packet"),
      v.literal("reminder_24h"),
      v.literal("reminder_1h"),
      v.literal("weekly_briefing"),
      v.literal("rate_cut_promo"),
    ),
  },
  handler: async (ctx, { kind }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("aiArtifacts")
      .withIndex("by_org_kind", (q) => q.eq("orgId", orgId).eq("kind", kind))
      .collect();
    let deleted = 0;
    for (const r of rows) {
      await ctx.db.delete(r._id);
      deleted++;
    }
    return { deleted };
  },
});

/** Internal insert used by AI actions to write their results. */
export const insertInternal = internalMutation({
  args: {
    orgId: v.string(),
    kind: v.union(
      v.literal("session_recap"),
      v.literal("prep_packet"),
      v.literal("reminder_24h"),
      v.literal("reminder_1h"),
      v.literal("weekly_briefing"),
      v.literal("rate_cut_promo"),
    ),
    sessionId: v.optional(v.id("sessions")),
    roomId: v.optional(v.id("rooms")),
    title: v.string(),
    summary: v.string(),
    body: v.optional(v.string()),
    emailDraft: v.optional(
      v.object({
        to: v.optional(v.string()),
        subject: v.string(),
        body: v.string(),
      }),
    ),
    source: v.union(v.literal("openai"), v.literal("fallback")),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("aiArtifacts", {
      ...args,
      status: "ready",
      generatedAt: Date.now(),
    });
  },
});
