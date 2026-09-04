import { query } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCapability, resolveViewer } from "./lib/access";
import {
  PLAN_LIMITS, SELLABLE_TIERS, EARLY_ADOPTER_MONTHS, BETA_PLAN_NAME,
  earlyAdopterApplies, earlyAdopterPriceCents, type TierKey,
} from "./lib/plans";

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
    introPriceCents: v.optional(v.number()),
    introMonths: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "billing.edit");
    const agencyId = await agencyIdOf(ctx);
    if (!args.name.trim()) throw new Error("Name is required.");
    if (args.priceCents < 0) throw new Error("Price cannot be negative.");
    if (args.trialDays < 0 || args.trialDays > 365) throw new Error("Trial must be 0-365 days.");
    assertIntro(args.introPriceCents, args.introMonths, args.priceCents);

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
    introPriceCents: v.optional(v.union(v.number(), v.null())),
    introMonths: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, { planId, ...patch }) => {
    await requireCapability(ctx, "billing.edit");
    const plan = await mineOrThrow(ctx, planId);
    const next: Record<string, unknown> = {};
    if (patch.name !== undefined && patch.name.trim()) next.name = patch.name.trim();
    if (patch.description !== undefined) next.description = patch.description.trim() || undefined;
    if (patch.priceCents !== undefined) next.priceCents = Math.max(0, Math.round(patch.priceCents));
    if (patch.introPriceCents !== undefined) {
      next.introPriceCents =
        patch.introPriceCents === null ? undefined : Math.max(0, Math.round(patch.introPriceCents));
    }
    if (patch.introMonths !== undefined) {
      next.introMonths =
        patch.introMonths === null ? undefined : Math.max(0, Math.round(patch.introMonths));
    }
    assertIntro(
      (next.introPriceCents ?? plan.introPriceCents) as number | undefined,
      (next.introMonths ?? plan.introMonths) as number | undefined,
      (next.priceCents ?? plan.priceCents) as number,
    );
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

/* ============================================================
   The price book, derived.

   These used to be hand-typed here ($49 / $129 / $199 against tier names
   that no longer existed), which is how the console came to offer a ladder
   the product had not sold for months. Every number below now comes from
   PLAN_LIMITS, so repricing happens in exactly one file.

   Three kinds of plan, and no generic free trial among them:

     Beta          the trial. One plan, 365 days, no card. Which tier a
                   beta studio actually gets is set on the org, not here,
                   so one plan serves the whole cohort.
     Early adopter half price for the first 3 months, then the real price.
     Standard      the real price from day one.
   ============================================================ */

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

const BETA_DAYS = 365;

/** Lays down the price book for an agency and returns the id of the default
    plan (Beta - every new sub-account starts there). */
async function insertStarterPlans(
  ctx: MutationCtx,
  agencyId: string,
): Promise<Id<"agencyPlans">> {
  const now = Date.now();
  let order = 0;

  /* The beta IS the trial, so it is the default and the only plan with a
     trial window. requireCardAfterTrial is false on purpose: the end of a
     beta year is handled by the beta hard stop, which asks them to pick a
     plan, not by a card prompt against a plan that costs nothing. */
  const betaId = await ctx.db.insert("agencyPlans", {
    agencyId,
    name: BETA_PLAN_NAME,
    description:
      "The beta programme. Everything unlocked, free for 365 days. The year " +
      "starts on their first sign-in after signing the agreement, and ends " +
      "with a prompt to pick a plan.",
    priceCents: 0,
    billingInterval: "month",
    trialDays: BETA_DAYS,
    requireCardAfterTrial: false,
    isPromo: true,
    isDefault: true,
    active: true,
    createdAt: now + order++,
  });

  for (const tier of SELLABLE_TIERS) {
    const p = PLAN_LIMITS[tier as TierKey];
    const intro = earlyAdopterPriceCents(tier as TierKey);

    if (earlyAdopterApplies(tier as TierKey, "month")) {
      await ctx.db.insert("agencyPlans", {
        agencyId,
        name: `${p.label} - Early Adopter`,
        description:
          `${money(intro)}/mo for the first ${EARLY_ADOPTER_MONTHS} months, ` +
          `then ${money(p.priceCents)}/mo. ${p.pitch}`,
        priceCents: p.priceCents,
        introPriceCents: intro,
        introMonths: EARLY_ADOPTER_MONTHS,
        billingInterval: "month",
        trialDays: 0,
        requireCardAfterTrial: true,
        isPromo: true,
        isDefault: false,
        active: true,
        createdAt: now + order++,
      });
    }

    await ctx.db.insert("agencyPlans", {
      agencyId,
      name: p.label,
      description: `${money(p.priceCents)}/mo. ${p.pitch}`,
      priceCents: p.priceCents,
      billingInterval: "month",
      trialDays: 0,
      requireCardAfterTrial: true,
      isPromo: false,
      isDefault: false,
      active: true,
      createdAt: now + order++,
    });
  }

  return betaId;
}

/** One-tap starter set: Beta, plus Early Adopter and standard plans for every
    sellable tier, all priced from PLAN_LIMITS. Only for a fresh price book. */
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

/** Replace the whole price book with the current one. Any studio on an old
    plan is rehomed to the new default (Beta) before the old plans are
    deleted, so nobody is left planless. */
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

    // Lay down the fresh book first, so we have a default to rehome studios onto.
    const newDefaultId = await insertStarterPlans(ctx, agencyId);
    const seeded = (
      await ctx.db.query("agencyPlans").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).collect()
    ).filter((p) => !oldIds.has(p._id)).length;

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

    return { replaced: oldPlans.length, seeded, studiosMoved: moved, defaultName: BETA_PLAN_NAME };
  },
});

// ── helpers ──────────────────────────────────────────────────

/* Intro pricing is two fields that only mean anything together, and an intro
   that is not actually cheaper is a promise the studio will notice is empty.
   Both are rejected here rather than being allowed to sit in the price book
   looking like an offer. */
function assertIntro(
  introPriceCents: number | undefined,
  introMonths: number | undefined,
  priceCents: number,
) {
  const hasPrice = typeof introPriceCents === "number";
  const hasMonths = typeof introMonths === "number" && introMonths > 0;
  if (!hasPrice && !hasMonths) return;
  if (hasPrice !== hasMonths) {
    throw new Error("Intro pricing needs both an intro price and a number of months.");
  }
  if (introPriceCents! >= priceCents) {
    throw new Error("The intro price has to be lower than the regular price.");
  }
}
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

/** Ops entry point for the same reseed, for running the price book out to an
 *  agency from the CLI. Same implementation, no interactive session. */
export const _reseedForAgency = internalMutation({
  args: { agencyId: v.string() },
  handler: async (ctx, { agencyId }) => {
    const oldPlans = await ctx.db
      .query("agencyPlans")
      .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
      .collect();
    const oldIds = new Set<string>(oldPlans.map((p) => p._id));

    const newDefaultId = await insertStarterPlans(ctx, agencyId);

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
    for (const p of oldPlans) await ctx.db.delete(p._id);

    const seeded = (
      await ctx.db.query("agencyPlans").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).collect()
    ).length;
    return { replaced: oldPlans.length, seeded, studiosMoved: moved, defaultName: BETA_PLAN_NAME };
  },
});
