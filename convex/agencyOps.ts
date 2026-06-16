/* ============================================================
   Ops Autopilot - agency portfolio roll-up.

   For an agency owner/admin: one board across every subaccount showing
   which studios need attention (open high-priority ops actions), plus a
   last-scan timestamp. Reuses the Access Engine - only agency viewers
   with `ops.portfolio.view` get in, and the roll-up is scoped to their
   own agency's subaccounts.
   ============================================================ */
import { query } from "./_generated/server";
import { resolveViewer } from "./lib/access";

export const portfolio = query({
  args: {},
  handler: async (ctx) => {
    // Degrade gracefully for non-agency viewers (demo / studio / unscoped):
    // return an empty portfolio so the Autopilot tab renders its empty state
    // instead of throwing and tripping the route error boundary.
    const viewer = await resolveViewer(ctx).catch(() => null);
    if (!viewer || viewer.kind !== "agency_member" || !viewer.capabilities.has("ops.portfolio.view")) {
      return [];
    }
    const agencyId = viewer.agencyId;

    const subs = await ctx.db
      .query("orgs")
      .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
      .collect();

    const studios = [];
    for (const org of subs) {
      const actions = await ctx.db
        .query("opsActions")
        .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
        .collect();
      const open = actions.filter((a) => a.status === "proposed" || a.status === "snoozed");
      const lastScanAt = actions.reduce((m, a) => Math.max(m, a.createdAt), 0);
      studios.push({
        orgId: org.orgId,
        name: org.name,
        openTotal: open.length,
        openHigh: open.filter((a) => a.priority === "high").length,
        lastScanAt: lastScanAt || null,
      });
    }

    // Most attention-needing first.
    studios.sort((a, b) => b.openHigh - a.openHigh || b.openTotal - a.openTotal);
    return studios;
  },
});
