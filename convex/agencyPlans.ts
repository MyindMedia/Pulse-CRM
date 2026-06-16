import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCapability, resolveViewer } from "./lib/access";

/* ============================================================
   Agency price book - the plans an agency sells to its sub-account
   studios (GoHighLevel "SaaS Mode"). Reads gated by agency.viewAll,
   writes by billing.edit. One agency's plans are never visible to
   another's (scoped by viewer.agencyId).
   ============================================================ */

const intervalV = v.union(v.literal("month"), v.literal("year"));

async function agencyIdOf(ctx: QueryCtx | MutationCtx): Promise<string> {
  const viewer = await resolveViewer(ctx);
  if (viewer.kind !== "agency_member") throw new Error("Agency users only.");
  return viewer.agencyId;
}

/** All plans for the caller's agency, each with the count of studios on it. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await resolveViewer(ctx).catch(() => null);
    if (!viewer || viewer.kind !== "agency_member" || !viewer.capabilities.has("agency.viewAll")) {
      return [];
    }
    const plans = await ctx.db
      .query("agencyPlans")
      .withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId))
      .collect();
    // Count assignments per plan (small N - one agency's studios).
    const orgs = await ctx.db
      .query("orgs")
      .withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId))
      .collect();
    const counts = new Map<string, number>();
    for (const o of orgs) {
      if (o.agencyPlanId) counts.set(o.agencyPlanId, (counts.get(o.agencyPlanId) ?? 0) + 1);
    }
    return plans
      .map((p) => ({ ...p, assignedCount: counts.get(p._id) ?? 0 }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.priceCents - b.priceCents);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    priceCents: v.number(),
    billingInterval: intervalV,
    trialDays: v.number(),
    requireCardAfterTrial: v.boolean(),
    isPromo: v.boolean(),
    promoEndsAt: v.optional(v.number()),
    featureCaps: v.optional(v.array(v.string())),
    isDefault: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "billing.edit");
    const agencyId = await agencyIdOf(ctx);
    if (!args.name.trim()) throw new Error("Name is required.");
    if (args.priceCents < 0) throw new Error("Price cannot be negative.");
    if (args.trialDays < 0 || args.trialDays > 365) throw new Error("Trial must be 0-365 days.");

    if (args.isDefault) await clearDefaults(ctx, agencyId);
    return await ctx.db.insert("agencyPlans", {
      agencyId,
      name: args.name.trim(),
      description: args.description?.trim() || undefined,
      priceCents: Math.round(args.priceCents),
      billingInterval: args.billingInterval,
      trialDays: Math.round(args.trialDays),
      requireCardAfterTrial: args.requireCardAfterTrial,
      isPromo: args.isPromo,
      promoEndsAt: args.promoEndsAt,
      featureCaps: args.featureCaps,
      isDefault: Boolean(args.isDefault),
      active: true,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    planId: v.id("agencyPlans"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    priceCents: v.optional(v.number()),
    billingInterval: v.optional(intervalV),
    trialDays: v.optional(v.number()),
    requireCardAfterTrial: v.optional(v.boolean()),
    isPromo: v.optional(v.boolean()),
    promoEndsAt: v.optional(v.union(v.number(), v.null())),
    featureCaps: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { planId, ...patch }) => {
    await requireCapability(ctx, "billing.edit");
    const plan = await mineOrThrow(ctx, planId);
    const next: Record<string, unknown> = {};
    if (patch.name !== undefined && patch.name.trim()) next.name = patch.name.trim();
    if (patch.description !== undefined) next.description = patch.description.trim() || undefined;
    if (patch.priceCents !== undefined) next.priceCents = Math.max(0, Math.round(patch.priceCents));
    if (patch.billingInterval !== undefined) next.billingInterval = patch.billingInterval;
    if (patch.trialDays !== undefined) next.trialDays = Math.max(0, Math.round(patch.trialDays));
    if (patch.requireCardAfterTrial !== undefined) next.requireCardAfterTrial = patch.requireCardAfterTrial;
    if (patch.isPromo !== undefined) next.isPromo = patch.isPromo;
    if (patch.promoEndsAt !== undefined) next.promoEndsAt = patch.promoEndsAt ?? undefined;
    if (patch.featureCaps !== undefined) next.featureCaps = patch.featureCaps;
    await ctx.db.patch(plan._id, next);
  },
});

export const setActive = mutation({
  args: { planId: v.id("agencyPlans"), active: v.boolean() },
  handler: async (ctx, { planId, active }) => {
    await requireCapability(ctx, "billing.edit");
    const plan = await mineOrThrow(ctx, planId);
    await ctx.db.patch(plan._id, { active, ...(active ? {} : { isDefault: false }) });
  },
});

export const setDefault = mutation({
  args: { planId: v.id("agencyPlans") },
  handler: async (ctx, { planId }) => {
    await requireCapability(ctx, "billing.edit");
    const plan = await mineOrThrow(ctx, planId);
    await clearDefaults(ctx, plan.agencyId);
    await ctx.db.patch(plan._id, { isDefault: true, active: true });
  },
});

export const remove = mutation({
  args: { planId: v.id("agencyPlans") },
  handler: async (ctx, { planId }) => {
    await requireCapability(ctx, "billing.edit");
    const plan = await mineOrThrow(ctx, planId);
    const assigned = (
      await ctx.db
        .query("orgs")
        .withIndex("by_agency", (q) => q.eq("agencyId", plan.agencyId))
        .collect()
    ).some((o) => o.agencyPlanId === plan._id);
    if (assigned) {
      throw new Error("Move studios off this plan before deleting it. You can deactivate it instead.");
    }
    await ctx.db.delete(plan._id);
  },
});

/* The three first-adopter tiers, mirroring the public pricing page
   (Solo / Studio / Label). Each seeds two packages:
   - Free Forever: $0, not a promo, no trial -> comped (free with no end date, no card).
   - 1 Year Free: priced at the tier rate but with a 365-day promo trial and a
     required card, so studios run free for a full year, then convert to paid. */
const FIRST_ADOPTER_TIERS = [
  {
    tier: "Solo",
    priceCents: 4900,
    forever: "Solo, free forever for early studios. One workspace and the full booking CRM. No card, no expiry.",
    yearOne: "Solo free for a full year, then $49/mo. Card required up front.",
  },
  {
    tier: "Studio",
    priceCents: 12900,
    forever: "Studio, free forever for early studios. Unlimited rooms and team scheduling. No card, no expiry.",
    yearOne: "Studio free for a full year, then $129/mo. Card required up front.",
    isDefault: true,
  },
  {
    tier: "Label",
    priceCents: 19900,
    forever: "Label, free forever for early studios. Multi-studio dashboard and cross-studio reporting. No card, no expiry.",
    yearOne: "Label free for a full year, then $199/mo. Card required up front.",
  },
];

/** Inserts the 6 first-adopter packages (Free Forever + 1 Year Free for every
    tier) for an agency and returns the id of the one marked default
    (Studio: Free Forever). Shared by seedStarter / reseedStarter. */
async function insertStarterPlans(
  ctx: MutationCtx,
  agencyId: string,
): Promise<Id<"agencyPlans">> {
  const now = Date.now();
  let order = 0;
  let defaultId: Id<"agencyPlans"> | null = null;
  for (const t of FIRST_ADOPTER_TIERS) {
    // Free forever: $0, not a promo -> comped state, no card, no end date.
    const freeId = await ctx.db.insert("agencyPlans", {
      agencyId,
      name: `${t.tier}: Free Forever`,
      description: t.forever,
      priceCents: 0,
      billingInterval: "month",
      trialDays: 0,
      requireCardAfterTrial: false,
      isPromo: false,
      isDefault: Boolean(t.isDefault),
      active: true,
      createdAt: now + order++,
    });
    if (t.isDefault) defaultId = freeId;
    // 1 year free, card required: 365-day promo trial, then the tier price.
    await ctx.db.insert("agencyPlans", {
      agencyId,
      name: `${t.tier}: 1 Year Free`,
      description: t.yearOne,
      priceCents: t.priceCents,
      billingInterval: "month",
      trialDays: 365,
      requireCardAfterTrial: true,
      isPromo: true,
      isDefault: false,
      active: true,
      createdAt: now + order++,
    });
  }
  if (!defaultId) throw new Error("Starter set has no default tier.");
  return defaultId;
}

/** One-tap starter set: free-forever and 1-year-free first-adopter packages
    for every tier (Solo / Studio / Label). Only for a fresh price book. */
export const seedStarter = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "billing.edit");
    const agencyId = await agencyIdOf(ctx);
    const existing = await ctx.db
      .query("agencyPlans")
      .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
      .first();
    if (existing) throw new Error("You already have plans. Add one with “New plan”.");
    await insertStarterPlans(ctx, agencyId);
  },
});

/** Replace the whole price book with the 6 first-adopter packages. Any studio
    currently on an old plan is rehomed to the new default (Studio: Free
    Forever) before the old plans are deleted, so nobody is left planless. */
export const reseedStarter = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "billing.edit");
    const agencyId = await agencyIdOf(ctx);

    const oldPlans = await ctx.db
      .query("agencyPlans")
      .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
      .collect();
    const oldIds = new Set<string>(oldPlans.map((p) => p._id));

    // Lay down the fresh 6 first, so we have a default to rehome studios onto.
    const newDefaultId = await insertStarterPlans(ctx, agencyId);

    // Move every studio off an old plan onto the new default.
    const orgs = await ctx.db
      .query("orgs")
      .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
      .collect();
    let moved = 0;
    for (const o of orgs) {
      if (o.agencyPlanId && oldIds.has(o.agencyPlanId)) {
        await ctx.db.patch(o._id, { agencyPlanId: newDefaultId });
        moved++;
      }
    }

    // Now that nothing points at them, drop the old plans.
    for (const p of oldPlans) await ctx.db.delete(p._id);

    return { replaced: oldPlans.length, seeded: 6, studiosMoved: moved };
  },
});

// ── helpers ──────────────────────────────────────────────────
async function clearDefaults(ctx: MutationCtx, agencyId: string) {
  const defaults = (
    await ctx.db
      .query("agencyPlans")
      .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
      .collect()
  ).filter((p) => p.isDefault);
  for (const p of defaults) await ctx.db.patch(p._id, { isDefault: false });
}

async function mineOrThrow(ctx: MutationCtx, planId: Id<"agencyPlans">): Promise<Doc<"agencyPlans">> {
  const agencyId = await agencyIdOf(ctx);
  const plan = await ctx.db.get(planId);
  if (!plan || plan.agencyId !== agencyId) throw new Error("Plan not found.");
  return plan;
}
