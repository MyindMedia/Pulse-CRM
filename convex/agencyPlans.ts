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

/** One-tap starter set: a free first-adopter promo + a paid plan. */
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
    const now = Date.now();
    await ctx.db.insert("agencyPlans", {
      agencyId,
      name: "First Adopter",
      description: "Free for early studios. 30-day window, then add a card to keep going.",
      priceCents: 0,
      billingInterval: "month",
      trialDays: 30,
      requireCardAfterTrial: true,
      isPromo: true,
      isDefault: true,
      active: true,
      createdAt: now,
    });
    await ctx.db.insert("agencyPlans", {
      agencyId,
      name: "Studio",
      description: "The standard monthly plan for your studios.",
      priceCents: 9900,
      billingInterval: "month",
      trialDays: 14,
      requireCardAfterTrial: true,
      isPromo: false,
      isDefault: false,
      active: true,
      createdAt: now + 1,
    });
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
