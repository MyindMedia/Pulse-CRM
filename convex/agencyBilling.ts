import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireCapability, resolveViewer } from "./lib/access";
import { currentOrg } from "./lib/tenant";
import { stripeClient } from "./lib/stripe";
import { evaluateBillingGate, effectivePriceCents, DAY_MS } from "./lib/billingGate";
import { sendEmail } from "./lib/email";

/* ============================================================
   Agency rebilling - the per-sub-account billing/trial state. The
   agency assigns one of its agencyPlans to a studio; this module
   runs the state machine (trialing → active / past_due / comped),
   the "add a card" Stripe setup flow, and the daily trial sweep.

   Reads/writes over a sub-account are gated by capability + the
   engine's agency-over-org scope check. The studio-self-serve pair
   (myBilling / startMyPaymentSetup) lets a studio owner add a card.
   ============================================================ */

async function orgByIdOrThrow(ctx: QueryCtx | MutationCtx, orgId: string): Promise<Doc<"orgs">> {
  const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  if (!org) throw new Error("Subaccount not found.");
  return org;
}

function billingView(org: Doc<"orgs">, plan: Doc<"agencyPlans"> | null, now: number) {
  const gate = evaluateBillingGate(org, plan, now);
  return {
    plan: plan
      ? {
          _id: plan._id,
          name: plan.name,
          priceCents: plan.priceCents,
          billingInterval: plan.billingInterval,
          trialDays: plan.trialDays,
          requireCardAfterTrial: plan.requireCardAfterTrial,
          isPromo: plan.isPromo,
        }
      : null,
    billingStatus: org.billingStatus ?? null,
    trialStartedAt: org.trialStartedAt ?? null,
    trialEndsAt: org.trialEndsAt ?? null,
    paymentMethodOnFile: Boolean(org.paymentMethodOnFile),
    priceCentsOverride: org.priceCentsOverride ?? null,
    effectivePriceCents: effectivePriceCents(org.priceCentsOverride, plan?.priceCents),
    billingNote: org.billingNote ?? null,
    ...gate,
  };
}

/** Agency-side view of one sub-account's billing. */
export const subaccountBilling = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireCapability(ctx, "agency.viewAll", { orgId });
    const org = await orgByIdOrThrow(ctx, orgId);
    const plan = org.agencyPlanId ? await ctx.db.get(org.agencyPlanId) : null;
    return billingView(org, plan, Date.now());
  },
});

/** Apply a plan's state machine to an org and return the patch. */
function planTransition(plan: Doc<"agencyPlans">, hasCard: boolean, now: number) {
  if (plan.priceCents === 0 && !plan.isPromo) {
    return { billingStatus: "comped" as const, trialStartedAt: undefined, trialEndsAt: undefined };
  }
  if (plan.trialDays > 0) {
    return {
      billingStatus: "trialing" as const,
      trialStartedAt: now,
      trialEndsAt: now + plan.trialDays * DAY_MS,
    };
  }
  return {
    billingStatus: hasCard ? ("active" as const) : ("past_due" as const),
    trialStartedAt: undefined,
    trialEndsAt: undefined,
  };
}

/** Assign (or change) a sub-account's agency plan and start its trial/billing. */
export const assignPlan = mutation({
  args: { orgId: v.string(), planId: v.id("agencyPlans") },
  handler: async (ctx, { orgId, planId }) => {
    const viewer = await requireCapability(ctx, "billing.edit", { orgId });
    const org = await orgByIdOrThrow(ctx, orgId);
    const plan = await ctx.db.get(planId);
    if (!plan || (viewer.kind === "agency_member" && plan.agencyId !== viewer.agencyId)) {
      throw new Error("Plan not found.");
    }
    const t = planTransition(plan, Boolean(org.paymentMethodOnFile), Date.now());
    await ctx.db.patch(org._id, { agencyPlanId: planId, ...t });
    // Apply any plan-level feature caps on top of existing disabled features.
    if (plan.featureCaps && plan.featureCaps.length) {
      const merged = new Set([...(org.disabledFeatures ?? []), ...plan.featureCaps]);
      await ctx.db.patch(org._id, { disabledFeatures: [...merged] });
    }
    return { billingStatus: t.billingStatus };
  },
});

/** Free forever - the agency comps a studio (e.g. a partner or in-house room). */
export const comp = mutation({
  args: { orgId: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, { orgId, note }) => {
    await requireCapability(ctx, "billing.edit", { orgId });
    const org = await orgByIdOrThrow(ctx, orgId);
    await ctx.db.patch(org._id, {
      billingStatus: "comped",
      billingNote: note?.trim() || undefined,
      trialEndsAt: undefined,
    });
  },
});

/** Push a trial deadline out by N days (and re-open a lapsed trial). */
export const extendTrial = mutation({
  args: { orgId: v.string(), days: v.number() },
  handler: async (ctx, { orgId, days }) => {
    await requireCapability(ctx, "billing.edit", { orgId });
    const org = await orgByIdOrThrow(ctx, orgId);
    const add = Math.round(days) * DAY_MS;
    const base = Math.max(org.trialEndsAt ?? 0, Date.now());
    await ctx.db.patch(org._id, {
      billingStatus: "trialing",
      trialStartedAt: org.trialStartedAt ?? Date.now(),
      trialEndsAt: base + add,
    });
  },
});

/** Per-account custom price (overrides the plan's price). null clears it. */
export const setPriceOverride = mutation({
  args: { orgId: v.string(), priceCents: v.union(v.number(), v.null()) },
  handler: async (ctx, { orgId, priceCents }) => {
    await requireCapability(ctx, "billing.edit", { orgId });
    const org = await orgByIdOrThrow(ctx, orgId);
    await ctx.db.patch(org._id, {
      priceCentsOverride: priceCents === null ? undefined : Math.max(0, Math.round(priceCents)),
    });
  },
});

/** Manually mark a studio as having a card / being active (no-Stripe / offline
    payment path). Agency-gated. */
export const markActiveManually = mutation({
  args: { orgId: v.string(), onFile: v.boolean() },
  handler: async (ctx, { orgId, onFile }) => {
    await requireCapability(ctx, "billing.edit", { orgId });
    const org = await orgByIdOrThrow(ctx, orgId);
    await ctx.db.patch(org._id, {
      paymentMethodOnFile: onFile,
      billingStatus: onFile ? "active" : (org.billingStatus ?? "past_due"),
    });
  },
});

// ── Stripe "add a card" setup flow ───────────────────────────

export const _orgForSetup = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) return null;
    return {
      orgId: org.orgId,
      name: org.name,
      ownerEmail: org.ownerEmail ?? null,
      billingCustomerId: org.billingCustomerId ?? null,
    };
  },
});

/** Action-side guard: assert the caller can edit billing for this org. */
export const _assertBillingEdit = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireCapability(ctx, "billing.edit", { orgId });
    return true;
  },
});

/** Action-side resolver: the signed-in studio's own org id. */
export const _myOrgId = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await currentOrg(ctx);
  },
});

export const _markPaymentMethodOnFile = internalMutation({
  args: { orgId: v.string(), customerId: v.optional(v.string()), subscriptionId: v.optional(v.string()) },
  handler: async (ctx, { orgId, customerId, subscriptionId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) return;
    await ctx.db.patch(org._id, {
      paymentMethodOnFile: true,
      billingStatus: "active",
      ...(customerId ? { billingCustomerId: customerId } : {}),
      ...(subscriptionId ? { billingSubscriptionId: subscriptionId } : {}),
    });
  },
});

/** Build a Stripe Checkout (setup mode) so a studio adds a card. Shared by the
    agency-initiated and studio-self-serve paths. Returns a simulated result when
    Stripe isn't configured so the flow still completes in demo. */
async function buildSetupCheckout(
  ctx: ActionCtx,
  orgId: string,
): Promise<{ url: string | null; simulated: boolean }> {
  const org = await ctx.runQuery(internal.agencyBilling._orgForSetup, { orgId });
  if (!org) throw new Error("Subaccount not found.");
  if (!process.env.STRIPE_SECRET_KEY) {
    // No Stripe in this environment - mark the card on file directly so the
    // gate clears (used in demo / local). Real deployments hit the webhook path.
    await ctx.runMutation(internal.agencyBilling._markPaymentMethodOnFile, { orgId });
    return { url: null, simulated: true };
  }
  const stripe = stripeClient();
  let customerId = org.billingCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: org.ownerEmail ?? undefined,
      name: org.name,
      metadata: { orgId, kind: "subaccount_billing" },
    });
    customerId = customer.id;
  }
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    payment_method_types: ["card"],
    success_url: `${baseUrl}/billing/added?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/dashboard`,
    metadata: { kind: "subaccount_billing", orgId },
    setup_intent_data: { metadata: { kind: "subaccount_billing", orgId } },
  });
  return { url: session.url ?? null, simulated: false };
}

/** Agency-initiated: get a link the studio owner can use to add their card. */
export const startPaymentSetup = action({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }): Promise<{ url: string | null; simulated: boolean }> => {
    await ctx.runQuery(internal.agencyBilling._assertBillingEdit, { orgId });
    return await buildSetupCheckout(ctx, orgId);
  },
});

// ── Studio self-serve (the sub-account owner) ────────────────

/** The signed-in studio's own billing state, for the in-app banner/gate. */
export const myBilling = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) return null;
    // Agency operators acting-as a studio are never gated - they're here to fix it.
    const viewer = await resolveViewer(ctx).catch(() => null);
    const isAgencyActing = viewer?.kind === "agency_member";
    const plan = org.agencyPlanId ? await ctx.db.get(org.agencyPlanId) : null;
    const view = billingView(org, plan, Date.now());
    return { ...view, locked: isAgencyActing ? false : view.locked, isAgencyActing, name: org.name };
  },
});

/** Studio owner adds their own card to clear the gate. */
export const startMyPaymentSetup = action({
  args: {},
  handler: async (ctx): Promise<{ url: string | null; simulated: boolean }> => {
    const orgId = await ctx.runQuery(internal.agencyBilling._myOrgId, {});
    return await buildSetupCheckout(ctx, orgId);
  },
});

// ── Daily trial sweep (cron) ─────────────────────────────────

export const _sweepTrials = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const trialing = (await ctx.db.query("orgs").collect()).filter(
      (o) => o.billingStatus === "trialing" && o.trialEndsAt !== undefined && now >= o.trialEndsAt,
    );
    const flipped: { orgId: string; ownerEmail?: string; name: string; locked: boolean }[] = [];
    for (const org of trialing) {
      const plan = org.agencyPlanId ? await ctx.db.get(org.agencyPlanId) : null;
      const hasCard = Boolean(org.paymentMethodOnFile);
      const next = hasCard ? "active" : "past_due";
      await ctx.db.patch(org._id, { billingStatus: next });
      const locked = !hasCard && Boolean(plan?.requireCardAfterTrial);
      flipped.push({ orgId: org.orgId, ownerEmail: org.ownerEmail ?? undefined, name: org.name, locked });
    }
    if (flipped.length) {
      await ctx.scheduler.runAfter(0, internal.agencyBilling._notifyExpired, { items: flipped });
    }
    return { swept: flipped.length };
  },
});

export const _notifyExpired = internalAction({
  args: {
    items: v.array(v.object({
      orgId: v.string(),
      ownerEmail: v.optional(v.string()),
      name: v.string(),
      locked: v.boolean(),
    })),
  },
  handler: async (_ctx, { items }) => {
    for (const it of items) {
      if (!it.ownerEmail) continue;
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      await sendEmail({
        to: it.ownerEmail,
        subject: it.locked ? "Action needed: add a payment method to keep Pulse" : "Your Pulse trial has ended",
        html: `<p>Your free window for <strong>${it.name}</strong> has ended.</p>
          <p>${it.locked
            ? "Add a payment method to keep using your studio dashboard."
            : "You're all set - billing has started on your card on file."}</p>
          <p><a href="${baseUrl}/dashboard">Open Pulse</a></p>`,
      }).catch(() => undefined);
    }
  },
});
