import { internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import { v } from "convex/values";
import { orgGate } from "./lib/tier";
import { capabilitiesForTier } from "./lib/entitlements";
import { inUse, type GatedFeature } from "./lib/planGates";

/* ============================================================
   One-time notice for studios below Growth that already use the AI
   receptionist or visitor check-in (truth-plan-gates, decision 2b:
   30 days' notice). Nothing here runs on its own.

   1. planGates:reportPlanGateUsers - REPORT ONLY. One page of studios at a
      time: which studios are using a Growth feature their plan does not
      include, and their current notice date.
   2. planGates:setPlanGateGrace - sets the notice date for the listed
      studios. dryRun defaults to TRUE: it reports what it would change and
      writes nothing. Only { dryRun: false } writes.
   ============================================================ */

const FEATURES: GatedFeature[] = ["aiReceptionist", "visitors"];

export const reportPlanGateUsers = internalQuery({
  args: { cursor: v.optional(v.union(v.string(), v.null())), numItems: v.optional(v.number()) },
  handler: async (ctx, { cursor, numItems }) => {
    const page = await ctx.db.query("orgs").paginate({ cursor: cursor ?? null, numItems: Math.min(numItems ?? 50, 200) });
    const studios = [];
    for (const org of page.page) {
      const { tier } = await orgGate(ctx, org.orgId);
      const caps = capabilitiesForTier(tier);
      const using: GatedFeature[] = [];
      for (const key of FEATURES) {
        if (!caps.has(key) && (await inUse(ctx, org.orgId, key))) using.push(key);
      }
      if (using.length) {
        studios.push({ orgId: org.orgId, name: org.name, tier, using, planGraceUntil: org.planGraceUntil ?? null });
      }
    }
    return { studios, cursor: page.continueCursor, isDone: page.isDone };
  },
});

export const setPlanGateGrace = internalMutation({
  args: {
    orgIds: v.array(v.string()),
    days: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { orgIds, days, dryRun }) => {
    const write = dryRun === false;
    const until = Date.now() + Math.max(0, days ?? 30) * 86_400_000;
    const changes = [];
    for (const orgId of orgIds.slice(0, 500)) {
      const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
      if (!org) { changes.push({ orgId, skipped: "not found" }); continue; }
      changes.push({ orgId, from: org.planGraceUntil ?? null, to: until });
      if (write) await ctx.db.patch(org._id, { planGraceUntil: until });
    }
    return { dryRun: !write, until, changes };
  },
});
