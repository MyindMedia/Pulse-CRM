import { query } from "./_generated/server";
import { v } from "convex/values";
import { currentOrg } from "./lib/tenant";

/* Notifications — the confirmation / reminder log. Written by the notify()
   seam; surfaced read-only in the internal Bookings view. */

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const orgId = await currentOrg(ctx);
    return await ctx.db
      .query("notifications")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(limit ?? 30);
  },
});

export const forSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    return rows
      .filter((r) => r.orgId === orgId)
      .sort((a, b) => b._creationTime - a._creationTime);
  },
});
