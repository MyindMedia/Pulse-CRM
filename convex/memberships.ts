import { action, query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { stripeClient } from "./lib/stripe";
import { currentOrg } from "./lib/tenant";
import { requireCapability } from "./lib/access";

/* ============================================================
   Studio memberships - recurring revenue billed via Stripe Connect.

   A studio defines monthly/yearly tiers (priority booking + bundled
   hours + member discount). The studio creates a recurring Stripe
   Price in its own dashboard and pastes the price id onto the plan;
   `subscribeViaStripe` then opens a Stripe Checkout session in
   "subscription" mode on the studio's connected account so the
   client pays directly. Subscription events arrive at the existing
   /stripe/webhook and update the local membership row.

   Per-period perks (discount, priority) are applied via pure
   helpers so the booking flow can call them without re-fetching.
   ============================================================ */

function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

const intervalV = v.union(v.literal("month"), v.literal("year"));
const statusV = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("past_due"),
  v.literal("cancelled"),
  v.literal("trialing"),
);

/* ── Pure perks layer (testable without a database) ─────────── */

export type PlanPerks = {
  memberDiscountPct?: number; // 0-100
  priorityBooking?: boolean;
  bundledHoursPerPeriod?: number;
};

/** Discounted hourly/session rate for a member; non-members pay full price. */
export function applyMembershipDiscount(rateCents: number, plan: PlanPerks | null): number {
  if (!plan || !plan.memberDiscountPct || plan.memberDiscountPct <= 0) return rateCents;
  const pct = Math.max(0, Math.min(100, plan.memberDiscountPct));
  // Round to whole cents.
  return Math.max(0, Math.round(rateCents * (1 - pct / 100)));
}

/** Hours still available in the period for a member on a bundled-hours plan. */
export function remainingBundledHours(membership: { hoursUsedThisPeriod: number } | null, plan: PlanPerks | null): number | null {
  if (!plan || !membership || !plan.bundledHoursPerPeriod) return null;
  return Math.max(0, plan.bundledHoursPerPeriod - membership.hoursUsedThisPeriod);
}

export function hasPriorityBooking(plan: PlanPerks | null): boolean {
  return !!plan?.priorityBooking;
}

/* ── Plan CRUD (studio-only) ────────────────────────────────── */

export const listPlans = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, { activeOnly }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "sessions.read", { orgId });
    const rows = await ctx.db.query("membershipPlans").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    return rows
      .filter((p) => (activeOnly ? p.active : true))
      .sort((a, b) => a.priceCents - b.priceCents);
  },
});

export const createPlan = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    priceCents: v.number(),
    billingInterval: intervalV,
    bundledHoursPerPeriod: v.optional(v.number()),
    memberDiscountPct: v.optional(v.number()),
    priorityBooking: v.optional(v.boolean()),
    stripePriceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "sessions.edit", { orgId });
    if (args.priceCents <= 0) throw new ConvexError("Price must be positive.");
    if (args.memberDiscountPct != null && (args.memberDiscountPct < 0 || args.memberDiscountPct > 100)) {
      throw new ConvexError("Member discount must be between 0 and 100.");
    }
    return ctx.db.insert("membershipPlans", {
      orgId,
      name: args.name,
      description: args.description,
      priceCents: args.priceCents,
      billingInterval: args.billingInterval,
      bundledHoursPerPeriod: args.bundledHoursPerPeriod,
      memberDiscountPct: args.memberDiscountPct,
      priorityBooking: args.priorityBooking,
      active: true,
      stripePriceId: args.stripePriceId,
      createdAt: Date.now(),
    });
  },
});

export const setPlanActive = mutation({
  args: { id: v.id("membershipPlans"), active: v.boolean() },
  handler: async (ctx, { id, active }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "sessions.edit", { orgId });
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new ConvexError("Plan not found.");
    await ctx.db.patch(id, { active });
  },
});

/* ── Membership reads ───────────────────────────────────────── */

export const listMemberships = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "sessions.read", { orgId });
    const rows = await ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    return Promise.all(
      rows.map(async (m) => {
        const artist = await ctx.db.get(m.artistId);
        const plan = await ctx.db.get(m.planId);
        return {
          ...m,
          artistName: artist?.name ?? "Unknown",
          planName: plan?.name ?? "Unknown plan",
          planPriceCents: plan?.priceCents ?? 0,
        };
      }),
    );
  },
});

/** Active membership for one artist (with the plan for perk lookup). */
export const forArtist = query({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "artists.read", { orgId });
    const all = await ctx.db.query("memberships").withIndex("by_artist", (q) => q.eq("artistId", artistId)).collect();
    const active = all.find((m) => m.status === "active" || m.status === "trialing");
    if (!active) return null;
    const plan = await ctx.db.get(active.planId);
    return { membership: active, plan };
  },
});

/* ── Stripe Checkout (subscription, on studio's Connect account) ── */

export const _subscribeContext = internalQuery({
  args: { artistId: v.id("artists"), planId: v.id("membershipPlans") },
  handler: async (ctx, { artistId, planId }) => {
    const orgId = await currentOrg(ctx);
    const artist = await ctx.db.get(artistId);
    const plan = await ctx.db.get(planId);
    if (!artist || artist.orgId !== orgId) return null;
    if (!plan || plan.orgId !== orgId) return null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return {
      orgId,
      stripeAccountId: org?.stripeAccountId ?? null,
      chargesEnabled: Boolean(org?.stripeChargesEnabled),
      artist: { id: artist._id, name: artist.name, email: artist.email ?? null },
      plan: { id: plan._id, name: plan.name, stripePriceId: plan.stripePriceId ?? null, active: plan.active },
    };
  },
});

export const _createMembershipRow = internalMutation({
  args: { orgId: v.string(), artistId: v.id("artists"), planId: v.id("membershipPlans") },
  handler: async (ctx, args) => {
    return ctx.db.insert("memberships", {
      orgId: args.orgId,
      artistId: args.artistId,
      planId: args.planId,
      status: "pending",
      hoursUsedThisPeriod: 0,
      createdAt: Date.now(),
    });
  },
});

/** Open a Stripe Checkout subscription session on the studio's connected
 *  account. Returns the URL the artist (or studio) will visit to pay. */
export const subscribeViaStripe = action({
  args: { artistId: v.id("artists"), planId: v.id("membershipPlans") },
  handler: async (ctx, { artistId, planId }): Promise<{ url: string }> => {
    if (!process.env.STRIPE_SECRET_KEY) throw new ConvexError("Payments aren't configured yet.");
    const c = await ctx.runQuery(internal.memberships._subscribeContext, { artistId, planId });
    if (!c) throw new ConvexError("Plan or artist not found.");
    if (!c.plan.active) throw new ConvexError("This plan is no longer active.");
    if (!c.plan.stripePriceId) throw new ConvexError("This plan has no Stripe price linked yet.");
    if (!c.stripeAccountId || !c.chargesEnabled) throw new ConvexError("This studio has not finished connecting Stripe yet.");

    const membershipId: Id<"memberships"> = await ctx.runMutation(
      internal.memberships._createMembershipRow,
      { orgId: c.orgId, artistId, planId },
    );

    const stripe = stripeClient();
    const checkout = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        line_items: [{ price: c.plan.stripePriceId, quantity: 1 }],
        customer_email: c.artist.email ?? undefined,
        success_url: `${appUrl()}/dashboard?membership=active`,
        cancel_url: `${appUrl()}/dashboard?membership=cancelled`,
        metadata: { orgId: c.orgId, artistId, planId, membershipId },
        subscription_data: {
          metadata: { orgId: c.orgId, artistId, planId, membershipId },
        },
      },
      { stripeAccount: c.stripeAccountId },
    );

    if (!checkout.url) throw new ConvexError("Stripe did not return a checkout URL.");
    return { url: checkout.url };
  },
});

/* ── Webhook helpers (called from billingWebhooks) ──────────── */

/** Apply a Connect-side subscription event to the matching membership row.
 *  Idempotent: matches by stripeSubscriptionId (or falls back to the
 *  membershipId in metadata for the first activation). */
export const _applySubscriptionEvent = internalMutation({
  args: {
    stripeSubscriptionId: v.string(),
    stripeCustomerId: v.optional(v.string()),
    status: statusV,
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    membershipIdHint: v.optional(v.id("memberships")),
  },
  handler: async (ctx, args) => {
    let m: Doc<"memberships"> | null = null;
    const bySub = await ctx.db
      .query("memberships")
      .withIndex("by_stripe_subscription", (q) => q.eq("stripeSubscriptionId", args.stripeSubscriptionId))
      .first();
    m = bySub ?? null;
    if (!m && args.membershipIdHint) {
      m = (await ctx.db.get(args.membershipIdHint)) ?? null;
    }
    if (!m) return;

    await ctx.db.patch(m._id, {
      status: args.status,
      stripeSubscriptionId: args.stripeSubscriptionId,
      stripeCustomerId: args.stripeCustomerId ?? m.stripeCustomerId,
      currentPeriodStart: args.currentPeriodStart ?? m.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd ?? m.currentPeriodEnd,
      // A fresh period resets the bundled-hours counter.
      hoursUsedThisPeriod:
        args.currentPeriodStart && args.currentPeriodStart !== m.currentPeriodStart ? 0 : m.hoursUsedThisPeriod,
    });
  },
});
