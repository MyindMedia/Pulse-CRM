import { internalAction, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { stripeClient } from "./lib/stripe";
import { sendEmail } from "./lib/email";
import { formatUsd, isTierKey } from "./lib/pricing";
import { currentPriceCents } from "./lib/billingGate";
import {
  isBetaPlan,
  isDuplicateSubscription,
  isGrandfatheredCardFreeTrial,
  isLiveSubscriptionStatus,
  isPaidTrialPlan,
  orgPatchFromSubscription,
  type SubscriptionShape,
} from "./lib/trialCheckout";
import {
  trialCardRequiredHtml,
  trialCardRequiredSubject,
  trialWillEndHtml,
  trialWillEndSubject,
} from "./lib/emailTemplates/trialEmails";

/* ============================================================
   Card-required trials: the Stripe mirror, the trial-ending notice
   and the grandfathered-trial report.

   Stripe owns every trial. A trial starts when Checkout completes
   (webhook -> syncOrgSubscription), its end date is Stripe's trial_end
   mirrored into orgs.trialEndsAt, and Stripe charges the saved card
   when it ends. Nothing here starts a trial on its own.

   Runbook (grandfathered card-free trials, see
   openspec/changes/trial-requires-card/design.md):
     npx convex run trialBilling:cardFreeTrialReport --prod
     npx convex run trialBilling:sendTrialCardRequiredReminders --prod            # dry run
     npx convex run trialBilling:sendTrialCardRequiredReminders '{"apply":true}' --prod
   ============================================================ */

function appBase(): string {
  return process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://studiopulse.tech";
}

function dateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

const subV = v.object({
  id: v.string(),
  status: v.string(),
  customer: v.optional(v.union(v.string(), v.null())),
  trial_start: v.optional(v.union(v.number(), v.null())),
  trial_end: v.optional(v.union(v.number(), v.null())),
  default_payment_method: v.optional(v.any()),
  metadata: v.optional(v.union(v.record(v.string(), v.string()), v.null())),
});

/** Narrow a raw Stripe subscription (webhook object or API result) to the
 *  fields the mirror reads. */
export function toSubscriptionShape(obj: Record<string, unknown>): SubscriptionShape {
  const customer = obj.customer;
  const pm = obj.default_payment_method;
  return {
    id: String(obj.id ?? ""),
    status: String(obj.status ?? ""),
    customer:
      typeof customer === "string"
        ? customer
        : customer && typeof customer === "object" && typeof (customer as { id?: unknown }).id === "string"
          ? (customer as { id: string }).id
          : null,
    trial_start: typeof obj.trial_start === "number" ? obj.trial_start : null,
    trial_end: typeof obj.trial_end === "number" ? obj.trial_end : null,
    default_payment_method:
      typeof pm === "string" ? pm : pm && typeof pm === "object" ? (pm as { id?: string }).id ?? "pm" : null,
    metadata: (obj.metadata as Record<string, string> | null | undefined) ?? null,
  };
}

/**
 * Apply a Stripe subscription to the org it belongs to. Shared by the webhook
 * (inside its mutation) and the post-checkout sync. Idempotent: replaying the
 * same subscription state writes the same patch.
 */
export async function applyOrgSubscription(
  ctx: MutationCtx,
  orgId: string,
  sub: SubscriptionShape,
): Promise<{ applied: boolean; reason?: string }> {
  const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  if (!org) return { applied: false, reason: "no_org" };
  const now = Date.now();

  // Double-charge guard: a second live subscription for a studio that already
  // has one is canceled before it can bill, and the first one stays.
  if (isDuplicateSubscription(org, sub)) {
    await ctx.scheduler.runAfter(0, internal.trialBilling._cancelDuplicateSubscription, {
      subscriptionId: sub.id,
      orgId,
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "billing.duplicate_subscription",
      summary: "A second subscription was started for this studio and canceled automatically",
      accent: "critical",
    });
    return { applied: false, reason: "duplicate" };
  }

  // An event about an older subscription we have since replaced.
  if (org.billingSubscriptionId && org.billingSubscriptionId !== sub.id && !isLiveSubscriptionStatus(sub.status)) {
    return { applied: false, reason: "stale" };
  }

  const patch: Record<string, unknown> = { ...orgPatchFromSubscription(sub, org, now) };
  // Keep the first start date of a trial that began before it moved to Stripe.
  if (org.trialStartedAt !== undefined) delete patch.trialStartedAt;
  // A Stripe-backed subscription is no longer a grandfathered card-free trial.
  if (patch.billingStatus === "trialing" || patch.billingStatus === "active") {
    patch.trialCardRequiredBy = undefined;
  }

  const meta = sub.metadata ?? {};
  if (meta.planId && !org.agencyPlanId) {
    const planId = ctx.db.normalizeId("agencyPlans", meta.planId);
    if (planId) patch.agencyPlanId = planId;
  }
  /* Beta to paid. The chosen tier is recorded at checkout; the studio keeps
     the beta (Max) until the first charge lands, which is the end of the beta
     year when they subscribed early. That first charge is the graduation. */
  if (meta.kind === "beta_conversion") {
    if (isTierKey(meta.tier)) patch.tier = meta.tier;
    if (org.betaCohort && !org.graduatedAt && sub.status === "active") {
      patch.graduatedAt = now;
      await ctx.db.insert("activity", {
        orgId,
        kind: "account.graduated",
        summary: `${org.name} moved from the beta onto a paid plan`,
        accent: "gold",
      });
    }
  }

  await ctx.db.patch(org._id, patch);
  return { applied: true };
}

/** Internal - apply a subscription state to an org (post-checkout sync). */
export const _applyOrgSubscription = internalMutation({
  args: { orgId: v.string(), sub: subV },
  handler: async (ctx, { orgId, sub }) => applyOrgSubscription(ctx, orgId, sub),
});

/**
 * After Checkout completes: read the subscription from Stripe (the session
 * object carries no trial dates) and mirror it. This is the only way a
 * card-required trial begins on our side.
 */
export const syncOrgSubscription = internalAction({
  args: { orgId: v.string(), subscriptionId: v.string() },
  handler: async (ctx, { orgId, subscriptionId }): Promise<{ applied: boolean; reason?: string }> => {
    const stripe = stripeClient();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const shape = toSubscriptionShape(sub as unknown as Record<string, unknown>);
    // The subscription must say it is this org's, so a forged session cannot
    // attach somebody else's subscription.
    if (shape.metadata?.orgId && shape.metadata.orgId !== orgId) {
      return { applied: false, reason: "org_mismatch" };
    }
    return await ctx.runMutation(internal.trialBilling._applyOrgSubscription, { orgId, sub: shape });
  },
});

/** Cancel a duplicate subscription before it bills. Nothing has been charged
 *  when it was a trial; an immediate one is flagged in activity for a refund
 *  check. */
export const _cancelDuplicateSubscription = internalAction({
  args: { subscriptionId: v.string(), orgId: v.string() },
  handler: async (_ctx, { subscriptionId }) => {
    const stripe = stripeClient();
    try {
      await stripe.subscriptions.cancel(subscriptionId);
      return { canceled: true };
    } catch (err) {
      console.error("[trialBilling] duplicate cancel failed:", (err as Error).message);
      return { canceled: false };
    }
  },
});

/** Push a Stripe-backed trial's end date. The webhook mirrors it back. */
export const _extendStripeTrial = internalAction({
  args: { subscriptionId: v.string(), trialEndMs: v.number() },
  handler: async (_ctx, { subscriptionId, trialEndMs }) => {
    const stripe = stripeClient();
    await stripe.subscriptions.update(subscriptionId, {
      trial_end: Math.floor(trialEndMs / 1000),
      proration_behavior: "none",
    });
    return { ok: true };
  },
});

/* ── customer.subscription.trial_will_end ─────────────────── */

export const _trialWillEndTarget = internalQuery({
  args: { orgId: v.optional(v.string()), customerId: v.optional(v.string()) },
  handler: async (ctx, { orgId, customerId }) => {
    if (orgId) {
      const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
      if (!org?.ownerEmail) return null;
      const plan = org.agencyPlanId ? await ctx.db.get(org.agencyPlanId) : null;
      const cents = plan ? currentPriceCents(org.priceCentsOverride, plan, org.paidSince, Date.now()) : 0;
      return {
        kind: "org" as const,
        email: org.ownerEmail,
        ownerName: org.ownerName ?? null,
        name: org.name,
        priceLabel: plan && cents > 0 ? `${formatUsd(cents)}/${plan.billingInterval}` : null,
      };
    }
    if (customerId) {
      const ag = await ctx.db
        .query("agencies")
        .filter((q) => q.eq(q.field("stripeCustomerId"), customerId))
        .first();
      if (!ag?.ownerEmail) return null;
      return { kind: "agency" as const, email: ag.ownerEmail, ownerName: null, name: ag.name, priceLabel: null };
    }
    return null;
  },
});

export const _recordTrialWillEnd = internalMutation({
  args: { orgId: v.optional(v.string()), customerId: v.optional(v.string()), trialEndMs: v.number() },
  handler: async (ctx, { orgId, customerId, trialEndMs }) => {
    const now = Date.now();
    if (orgId) {
      const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
      if (!org) return;
      await ctx.db.patch(org._id, { trialWillEndNotifiedAt: now });
      await ctx.db.insert("activity", {
        orgId,
        kind: "billing.trial_will_end",
        summary: `Trial ends ${dateLabel(trialEndMs)}; the owner was emailed that the saved card will be charged`,
        accent: "info",
      });
      return;
    }
    if (customerId) {
      const ag = await ctx.db
        .query("agencies")
        .filter((q) => q.eq(q.field("stripeCustomerId"), customerId))
        .first();
      if (ag) await ctx.db.patch(ag._id, { trialWillEndNotifiedAt: now });
    }
  },
});

/** Stripe fires trial_will_end three days before the trial converts. Email the
 *  owner in the Pulse client layout and record that we did. */
export const notifyTrialWillEnd = internalAction({
  args: {
    orgId: v.optional(v.string()),
    customerId: v.optional(v.string()),
    trialEndMs: v.number(),
  },
  handler: async (ctx, { orgId, customerId, trialEndMs }): Promise<{ status: string }> => {
    const target = await ctx.runQuery(internal.trialBilling._trialWillEndTarget, { orgId, customerId });
    if (!target) return { status: "no_target" };
    const status = await sendEmail({
      to: target.email,
      subject: trialWillEndSubject(target.name),
      html: trialWillEndHtml({
        ownerName: target.ownerName ?? undefined,
        studioName: target.name,
        endsOnLabel: dateLabel(trialEndMs),
        priceLabel: target.priceLabel ?? undefined,
        manageUrl: `${appBase()}/billing`,
      }),
      audience: "client",
    });
    await ctx.runMutation(internal.trialBilling._recordTrialWillEnd, { orgId, customerId, trialEndMs });
    return { status };
  },
});

/* ── Grandfathered card-free trials ───────────────────────── */

type GrandfatherRow = {
  orgId: string;
  trialEndsAt: number | null;
  planKind: "paid_trial" | "free_trial" | "other";
  reminderSentAt: number | null;
};

/** Report: trials that started card-free before the rule, still running.
 *  Ids and dates only, no names or emails, so it is safe to paste or log. */
export const cardFreeTrialReport = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ count: number; orgIds: string[]; rows: GrandfatherRow[] }> => {
    const orgs = (await ctx.db.query("orgs").collect()).filter((o) => o.billingStatus === "trialing");
    const rows: GrandfatherRow[] = [];
    for (const org of orgs) {
      const plan = org.agencyPlanId ? await ctx.db.get(org.agencyPlanId) : null;
      if (!isGrandfatheredCardFreeTrial(org, plan)) continue;
      rows.push({
        orgId: org.orgId,
        trialEndsAt: org.trialEndsAt ?? null,
        planKind: isPaidTrialPlan(plan) ? "paid_trial" : plan && plan.priceCents === 0 && !isBetaPlan(plan) ? "free_trial" : "other",
        reminderSentAt: org.trialCardReminderSentAt ?? null,
      });
    }
    return { count: rows.length, orgIds: rows.map((r) => r.orgId), rows };
  },
});

/** Internal - the reminder list with addresses. Never logged. */
export const _grandfatheredDue = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const orgs = (await ctx.db.query("orgs").collect()).filter((o) => o.billingStatus === "trialing");
    const due: { orgId: string; email: string; ownerName: string | null; name: string; trialEndsAt: number }[] = [];
    for (const org of orgs) {
      const plan = org.agencyPlanId ? await ctx.db.get(org.agencyPlanId) : null;
      if (!isGrandfatheredCardFreeTrial(org, plan)) continue;
      if (!org.ownerEmail || !org.trialEndsAt || org.trialEndsAt <= now) continue;
      if (org.trialCardReminderSentAt) continue; // once per trial
      due.push({
        orgId: org.orgId,
        email: org.ownerEmail,
        ownerName: org.ownerName ?? null,
        name: org.name,
        trialEndsAt: org.trialEndsAt,
      });
    }
    return due;
  },
});

export const _markTrialCardReminder = internalMutation({
  args: { orgId: v.string(), requiredBy: v.number() },
  handler: async (ctx, { orgId, requiredBy }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) return;
    await ctx.db.patch(org._id, { trialCardRequiredBy: requiredBy, trialCardReminderSentAt: Date.now() });
  },
});

/**
 * "Add a card before your trial ends" for grandfathered trials. Dry run by
 * default: returns who would be emailed (ids only). With apply, sends each
 * owner one branded email and stamps trialCardRequiredBy = their trial end,
 * which makes the card due at that date whatever the plan's switch says.
 */
export const sendTrialCardRequiredReminders = internalAction({
  args: { apply: v.optional(v.boolean()) },
  handler: async (ctx, { apply }): Promise<{ dryRun: boolean; eligible: number; sent: number; orgIds: string[] }> => {
    const due = await ctx.runQuery(internal.trialBilling._grandfatheredDue, {});
    if (!apply) return { dryRun: true, eligible: due.length, sent: 0, orgIds: due.map((d) => d.orgId) };
    let sent = 0;
    for (const d of due) {
      const status = await sendEmail({
        to: d.email,
        subject: trialCardRequiredSubject(d.name),
        html: trialCardRequiredHtml({
          ownerName: d.ownerName ?? undefined,
          studioName: d.name,
          endsOnLabel: dateLabel(d.trialEndsAt),
          addCardUrl: `${appBase()}/billing`,
        }),
        audience: "client",
      });
      // Stamp regardless of status, so a bounce cannot become a resend loop.
      await ctx.runMutation(internal.trialBilling._markTrialCardReminder, {
        orgId: d.orgId,
        requiredBy: d.trialEndsAt,
      });
      if (status === "sent") sent++;
    }
    console.log(`[trialBilling] card-required reminders: eligible=${due.length} sent=${sent}`);
    return { dryRun: false, eligible: due.length, sent, orgIds: due.map((d) => d.orgId) };
  },
});
