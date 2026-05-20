import { query } from "./_generated/server";
import { v } from "convex/values";
import { currentOrg } from "./lib/tenant";

/** Recent activity feed - newest first. */
export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("activity")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(limit ?? 20);
    return rows;
  },
});

/** Activity scoped to a single entity (artist, song, session...). */
export const forEntity = query({
  args: { entityType: v.string(), entityId: v.string() },
  handler: async (ctx, { entityType, entityId }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("activity")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
    return rows.filter((r) => r.entityType === entityType && r.entityId === entityId);
  },
});
