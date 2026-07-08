import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { currentOrg, assertOrg } from "./lib/tenant";
import { AccessError } from "./lib/access";

const statusV = v.union(
  v.literal("new"),
  v.literal("seen"),
  v.literal("actioned"),
  v.literal("dismissed"),
);

/** Open insights - the AI nudge feed. */
export const open = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    // Shell-chrome read: degrade instead of throw while auth settles.
    let orgId: string;
    try {
      orgId = await currentOrg(ctx);
    } catch (e) {
      if (e instanceof AccessError) return [];
      throw e;
    }
    const rows = await ctx.db
      .query("insights")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
    return rows
      .filter((r) => r.status === "new" || r.status === "seen")
      .slice(0, limit ?? 12);
  },
});

export const counts = query({
  args: {},
  handler: async (ctx) => {
    // Shell-chrome read: degrade instead of throw while auth settles.
    let orgId: string;
    try {
      orgId = await currentOrg(ctx);
    } catch (e) {
      if (e instanceof AccessError) return { new: 0, open: 0, warning: 0 };
      throw e;
    }
    // Newest 500 bounds the read; open insights live near the head anyway.
    const rows = await ctx.db
      .query("insights")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(500);
    return {
      new: rows.filter((r) => r.status === "new").length,
      open: rows.filter((r) => r.status === "new" || r.status === "seen").length,
      warning: rows.filter(
        (r) => r.severity === "warning" && (r.status === "new" || r.status === "seen"),
      ).length,
    };
  },
});

export const setStatus = mutation({
  args: { id: v.id("insights"), status: statusV },
  handler: async (ctx, { id, status }) => {
    const orgId = await currentOrg(ctx);
    const insight = await ctx.db.get(id);
    assertOrg(insight, orgId);
    await ctx.db.patch(id, { status });
  },
});

/** Bulk-mark every "new" insight as seen - used when the panel opens. */
export const markAllSeen = mutation({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("insights")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "new"))
      .collect();
    for (const r of rows) await ctx.db.patch(r._id, { status: "seen" });
  },
});
