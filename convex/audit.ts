import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./lib/access";

/* ============================================================
   Audit log read API for the agency console viewer.
   Only agency_member viewers see anything; everyone else gets [].
   ============================================================ */

export const list = query({
  args: {
    limit: v.optional(v.number()),
    actionFilter: v.optional(v.string()),
    resultFilter: v.optional(v.union(v.literal("allow"), v.literal("deny"))),
  },
  handler: async (ctx, args) => {
    const viewer = await requireCapability(ctx, "audit.read");
    if (viewer.kind !== "agency_member") return [];
    const cap = args.limit ?? 200;
    let rows = await ctx.db
      .query("auditEvents")
      .withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId))
      .order("desc")
      .take(cap);
    if (args.actionFilter) rows = rows.filter((r) => r.action.startsWith(args.actionFilter!));
    if (args.resultFilter) rows = rows.filter((r) => r.result === args.resultFilter);
    return rows;
  },
});
