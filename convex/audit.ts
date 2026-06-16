import { query } from "./_generated/server";
import { v } from "convex/values";
import { resolveViewer } from "./lib/access";

/* ============================================================
   Audit log read API for the agency console viewer.
   Only agency_member viewers with audit.read see anything; everyone
   else (demo / studio / unscoped) gets [] rather than a thrown
   access error, so the console tab renders an empty state instead
   of tripping the route error boundary.
   ============================================================ */

export const list = query({
  args: {
    limit: v.optional(v.number()),
    actionFilter: v.optional(v.string()),
    resultFilter: v.optional(v.union(v.literal("allow"), v.literal("deny"))),
  },
  handler: async (ctx, args) => {
    const viewer = await resolveViewer(ctx).catch(() => null);
    if (!viewer || viewer.kind !== "agency_member" || !viewer.capabilities.has("audit.read")) {
      return [];
    }
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
