import { MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { tierForPriceId } from "./lib/stripe";
import { tierForPlan } from "./lib/tier";
import { settlePayment } from "./payments";
import { settleInvoice } from "./invoicePay";
import { applyPackagePurchase } from "./packages";
import { internal } from "./_generated/api";
import { normalizeEmail } from "./lib/emailKey";
import { applyOrgSubscription, toSubscriptionShape } from "./trialBilling";
import type { Doc } from "./_generated/dataModel";
import type { TierKey } from "./lib/pricing";
import { agencyActionForStatus, invoiceSubscriptionId, shouldEmailPaymentFailed } from "./lib/platformSubscription";

/* ============================================================
   Stripe webhook handlers. Idempotent via the stripeEvents ledger
   (one row per event.id, indexed by_event).
   Each handler patches Convex state and returns early.
   ============================================================ */

const eventV = v.object({
  id: v.string(),
  type: v.string(),
  // Populated by Stripe on events originating from a connected (studio) account.
  account: v.optional(v.string()),
  data: v.any(),
});

/** Map Stripe's subscription status -> our membership status. */
function mapSubStatus(s: string): "active" | "past_due" | "cancelled" | "trialing" | "pending" {
  if (s === "active") return "active";
  if (s === "trialing") return "trialing";
  if (s === "past_due") return "past_due";
  if (s === "canceled" || s === "cancelled") return "cancelled";
  if (s === "unpaid") return "past_due";
  return "pending";
}

async function alreadyProcessed(ctx: MutationCtx, eventId: string): Promise<boolean> {
  const seen = await ctx.db
    .query("stripeEvents")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .first();
  if (seen) return true;
  // TRANSITION: events processed before stripeEvents existed were marked in
  // auditEvents. Read them by index (never a table scan) until Stripe's retry
  // window has passed, then drop this and the by_action_viewer index.
  const legacy = await ctx.db
    .query("auditEvents")
    .withIndex("by_action_viewer", (q) => q.eq("action", "stripe.event").eq("viewerId", eventId))
    .first();
  return Boolean(legacy);
}

async function markProcessed(ctx: MutationCtx, eventId: string, eventType: string) {
  await ctx.db.insert("stripeEvents", { eventId, type: eventType, processedAt: Date.now() });
}

async function agencyByCustomer(ctx: MutationCtx, customerId: unknown): Promise<Doc<"agencies"> | null> {
  if (typeof customerId !== "string" || !customerId) return null;
  return await ctx.db
    .query("agencies")
    .filter((q) => q.eq(q.field("stripeCustomerId"), customerId))
    .first();
}

/** Pause the agency and every studio under it, remembering which studios this
 *  lock paused so a recovered payment turns back on only those. */
async function lockAgency(ctx: MutationCtx, ag: Doc<"agencies">) {
  const paused = new Set<Id<"orgs">>(ag.billingPausedOrgIds ?? []);
  const subs = await ctx.db
    .query("orgs")
    .withIndex("by_agency", (q) => q.eq("agencyId", ag.agencyId))
    .collect();
  for (const s of subs) {
    if (s.status !== "paused") {
      await ctx.db.patch(s._id, { status: "paused" });
      paused.add(s._id);
    }
  }
  // A paused plan has no payment left to fix or confirm: drop those prompts.
  await ctx.db.patch(ag._id, { status: "paused", billingPausedOrgIds: [...paused], paymentFailedAt: undefined, paymentActionUrl: undefined });
}

async function unlockAgencyStudios(ctx: MutationCtx, ag: Doc<"agencies">) {
  for (const id of ag.billingPausedOrgIds ?? []) {
    const org = await ctx.db.get(id);
    if (org?.status === "paused") await ctx.db.patch(id, { status: "active" });
  }
  await ctx.db.patch(ag._id, { billingPausedOrgIds: undefined });
}

/** Mirror a platform subscription's Stripe status onto its agency. */
async function applyAgencySubscription(ctx: MutationCtx, ag: Doc<"agencies">, stripeStatus: string, tier: TierKey | null) {
  const action = agencyActionForStatus(stripeStatus);
  if (tier) await ctx.db.patch(ag._id, { plan: tier });
  if (action.kind === "ignore") return;
  if (action.kind === "lock") {
    await lockAgency(ctx, ag);
    return;
  }
  await ctx.db.patch(ag._id, {
    status: action.status,
    ...(action.status === "past_due" ? {} : { paymentFailedAt: undefined, paymentActionUrl: undefined }),
  });
  if (ag.status === "paused" && ag.billingPausedOrgIds?.length) await unlockAgencyStudios(ctx, ag);
}

async function connectedAccountOwnsOrg(ctx: MutationCtx, stripeAccountId: string | undefined, orgId: string): Promise<boolean> {
  if (!stripeAccountId) return false;
  const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  return org?.stripeAccountId === stripeAccountId;
}

export const handle = internalMutation({
  args: { event: eventV },
  returns: v.union(
    v.object({ duplicate: v.literal(true) }),
    v.object({ duplicate: v.literal(false) }),
    v.object({ ok: v.literal(true) }),
  ),
  handler: async (ctx, { event }): Promise<
    { duplicate: true } | { duplicate: false } | { ok: true }
  > => {
    if (await alreadyProcessed(ctx, event.id)) return { duplicate: true };
    const e = event as { id: string; type: string; data: { object: Record<string, unknown> } };
    const obj = e.data.object;

    if (
      event.account &&
      typeof obj.id === "string" &&
      (e.type === "payout.created" ||
        e.type === "payout.updated" ||
        e.type === "payout.paid" ||
        e.type === "payout.failed" ||
        e.type === "payout.canceled" ||
        e.type === "payout.reconciliation_completed")
    ) {
      await ctx.scheduler.runAfter(0, internal.stripeLedger.syncPayout, {
        stripeAccountId: event.account,
        stripePayoutId: obj.id,
      });
      await markProcessed(ctx, event.id, e.type);
      return { ok: true };
    }

    if (e.type === "checkout.session.completed") {
      const meta = (obj.metadata as Record<string, string>) ?? {};

      // Public booking deposit/balance paid on a studio's connected account.
      if (meta.sessionId) {
        const sessionId = ctx.db.normalizeId("sessions", meta.sessionId);
        const session = sessionId ? await ctx.db.get(sessionId) : null;
        if (!session || !await connectedAccountOwnsOrg(ctx, event.account, session.orgId)) {
          await markProcessed(ctx, event.id, `${e.type}.account_mismatch`);
          return { ok: true };
        }
        const kind = (meta.kind as "deposit" | "balance" | "full") ?? "deposit";
        try {
          await settlePayment(ctx, {
            sessionId: session._id,
            kind,
            provider: "stripe",
            reference: (obj.payment_intent as string) ?? (obj.id as string),
          });
        } catch (err) {
          // Already-paid / released bookings settle to a no-op; don't 500 the webhook.
          console.error("[webhook] settlePayment skipped:", (err as Error).message);
        }
        // Mark processed so a Stripe retry of this event can't double-record the
        // payment (settlePayment is not idempotent per-event).
        await markProcessed(ctx, event.id, e.type);
        return { ok: true };
      }

      // Prepaid hour-block package bought on a studio's connected account.
      // Metadata carries kind/productId/artistId/orgId; create the credit. The
      // event-id guard above makes this idempotent (a Stripe retry short-circuits
      // at alreadyProcessed, so the credit is never double-created).
      if (meta.kind === "package" && meta.productId && meta.artistId && meta.orgId) {
        if (!await connectedAccountOwnsOrg(ctx, event.account, meta.orgId)) {
          await markProcessed(ctx, event.id, `${e.type}.account_mismatch`);
          return { ok: true };
        }
        try {
          await applyPackagePurchase(ctx, {
            orgId: meta.orgId,
            productId: meta.productId as Id<"packageProducts">,
            artistId: meta.artistId as Id<"artists">,
            stripeReference: (obj.payment_intent as string) ?? (obj.id as string),
          });
        } catch (err) {
          console.error("[webhook] package credit skipped:", (err as Error).message);
        }
        await markProcessed(ctx, event.id, e.type);
        return { ok: true };
      }

      // Public invoice paid on a studio's connected account.
      if (meta.invoiceId) {
        const invoiceId = ctx.db.normalizeId("invoices", meta.invoiceId);
        const invoice = invoiceId ? await ctx.db.get(invoiceId) : null;
        if (!invoice || !await connectedAccountOwnsOrg(ctx, event.account, invoice.orgId)) {
          await markProcessed(ctx, event.id, `${e.type}.account_mismatch`);
          return { ok: true };
        }
        try {
          await settleInvoice(ctx, invoice._id);
        } catch (err) {
          console.error("[webhook] invoice settle skipped:", (err as Error).message);
        }
        await markProcessed(ctx, event.id, e.type);
        return { ok: true };
      }

      // Studio membership subscription completed checkout on a Connect account.
      if (meta.membershipId) {
        const membershipId = ctx.db.normalizeId("memberships", meta.membershipId);
        const membership = membershipId ? await ctx.db.get(membershipId) : null;
        if (!membership || !await connectedAccountOwnsOrg(ctx, event.account, membership.orgId)) {
          await markProcessed(ctx, event.id, `${e.type}.account_mismatch`);
          return { ok: true };
        }
        const subscriptionId = obj.subscription as string | undefined;
        const customerId = obj.customer as string | undefined;
        if (subscriptionId) {
          await ctx.scheduler.runAfter(0, internal.memberships._applySubscriptionEvent, {
            stripeSubscriptionId: subscriptionId,
            stripeCustomerId: customerId,
            status: "active",
            membershipIdHint: membership._id,
          });
        }
        await markProcessed(ctx, event.id, e.type);
        return { ok: true };
      }

      // Sub-account "add a card" (Stripe Checkout setup mode). Only free,
      // comped or Beta studios use it now; on a paid plan the card is recorded
      // but the studio is NOT activated (no subscription, nothing charges it).
      if (meta.kind === "subaccount_billing" && meta.orgId) {
        await ctx.scheduler.runAfter(0, internal.agencyBilling._markPaymentMethodOnFile, {
          orgId: meta.orgId,
          customerId: (obj.customer as string | undefined) ?? undefined,
          subscriptionId: (obj.subscription as string | undefined) ?? undefined,
        });
        await markProcessed(ctx, event.id, e.type);
        return { ok: true };
      }

      /* Card-required trial (agency plan), a paid agency plan with no trial
         (charged on completion), or beta-to-paid checkout, on the platform
         account. The studio starts HERE and nowhere else: the sync reads the
         subscription from Stripe and mirrors its trial window or first charge. */
      if (
        !event.account &&
        (meta.kind === "subaccount_trial" || meta.kind === "subaccount_plan" || meta.kind === "beta_conversion") &&
        meta.orgId &&
        typeof obj.subscription === "string"
      ) {
        await ctx.scheduler.runAfter(0, internal.trialBilling.syncOrgSubscription, {
          orgId: meta.orgId,
          subscriptionId: obj.subscription,
        });
        await markProcessed(ctx, event.id, e.type);
        return { ok: true };
      }

      // Everything below provisions a PLATFORM agency. A connected (studio)
      // account's checkout can carry any metadata its creator chose, so it must
      // never reach this branch.
      if (event.account) {
        await markProcessed(ctx, event.id, e.type);
        return { ok: true };
      }

      const customerId = obj.customer as string;
      const subscriptionId = obj.subscription as string;
      // Only platform subscription checkouts go past here.
      if (!subscriptionId) return { ok: true };
      // Unknown or missing metadata resolves to core, never to a paid tier.
      const intendedTier = tierForPlan(meta.intendedTier as string | undefined);
      const clerkUserId = meta.clerkUserId as string;
      const agencyName = (meta.intendedAgencyName as string) || "My Agency";
      const ownerEmail =
        ((obj.customer_details as { email?: string } | undefined)?.email ??
          (obj.customer_email as string | undefined)) ||
        "";

      // Pay-first signup: email the buyer their activation link so they can
      // finish creating their login even if they closed the success page.
      if (meta.kind === "platform_signup" && ownerEmail) {
        await ctx.scheduler.runAfter(0, internal.billing.sendActivationEmail, {
          email: normalizeEmail(ownerEmail),
          sessionId: obj.id as string,
        });
      }

      // Pay-first signups (no clerkUserId yet) are provisioned post-signup by
      // billing.claimCheckout, so skip them here. Only the legacy authed flow
      // (clerkUserId already set) provisions at webhook time.
      if (clerkUserId) {
        const slug =
          agencyName.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-") ||
          `ag-${Date.now()}`;
        const agencyId = `agency_${slug}_${Date.now().toString(36)}`;
        await ctx.db.insert("agencies", {
          agencyId,
          name: agencyName,
          slug,
          plan: intendedTier,
          status: "trial",
          ownerClerkUserId: clerkUserId,
          ownerEmail,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
        });
        await ctx.db.insert("agencyMembers", {
          agencyId,
          clerkUserId,
          email: normalizeEmail(ownerEmail),
          name: ownerEmail,
          role: "owner",
          status: "active",
          invitedAt: Date.now(),
        });
      }
    }

    // Recurring membership invoices are earned revenue. Store one normalized
    // entry per Stripe invoice so payment_succeeded and invoice.paid cannot
    // double count the same collection.
    if (event.account && (e.type === "invoice.paid" || e.type === "invoice.payment_succeeded")) {
      const subscriptionDetails = (obj.parent as { subscription_details?: { subscription?: unknown; metadata?: Record<string, string> } } | undefined)?.subscription_details
        ?? (obj.subscription_details as { subscription?: unknown; metadata?: Record<string, string> } | undefined);
      const subscriptionValue = obj.subscription ?? subscriptionDetails?.subscription;
      const subscriptionId = typeof subscriptionValue === "string"
        ? subscriptionValue
        : subscriptionValue && typeof subscriptionValue === "object" && typeof (subscriptionValue as { id?: unknown }).id === "string"
          ? (subscriptionValue as { id: string }).id
          : undefined;
      const invoiceId = typeof obj.id === "string" ? obj.id : undefined;
      const amountPaid = typeof obj.amount_paid === "number" ? Math.round(obj.amount_paid) : 0;
      if (subscriptionId && invoiceId && amountPaid > 0) {
        let membership = await ctx.db
          .query("memberships")
          .withIndex("by_stripe_subscription", (q) => q.eq("stripeSubscriptionId", subscriptionId))
          .first();
        if (!membership && subscriptionDetails?.metadata?.membershipId) {
          const membershipId = ctx.db.normalizeId("memberships", subscriptionDetails.metadata.membershipId);
          membership = membershipId ? await ctx.db.get(membershipId) : null;
        }
        const org = membership
          ? await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", membership.orgId)).first()
          : null;
        const prior = await ctx.db
          .query("revenueEntries")
          .withIndex("by_provider_reference", (q) => q.eq("provider", "stripe").eq("providerReference", invoiceId))
          .first();
        if (membership && org?.stripeAccountId === event.account && !prior) {
          if (membership.stripeSubscriptionId === undefined) {
            await ctx.db.patch(membership._id, { stripeSubscriptionId: subscriptionId });
          }
          await ctx.db.insert("revenueEntries", {
            orgId: membership.orgId,
            sourceType: "membership",
            sourceId: membership._id,
            provider: "stripe",
            providerReference: invoiceId,
            incomeCategory: "memberships",
            amountCents: amountPaid,
            currency: typeof obj.currency === "string" ? obj.currency.toUpperCase() : "USD",
            collectedAt: typeof obj.status_transitions === "object" && obj.status_transitions !== null
              && typeof (obj.status_transitions as { paid_at?: unknown }).paid_at === "number"
              ? (obj.status_transitions as { paid_at: number }).paid_at * 1000
              : Date.now(),
          });
        }
      }
      await markProcessed(ctx, event.id, e.type);
      return { ok: true };
    }

    // Stripe Connect: a studio's connected account changed (finished onboarding,
    // charges enabled, etc.). Mirror the flags onto the owning org.
    if (e.type === "account.updated") {
      const acct = obj as { id?: string; charges_enabled?: boolean; details_submitted?: boolean };
      if (acct.id) {
        const org = await ctx.db
          .query("orgs")
          .withIndex("by_stripe_account", (q) => q.eq("stripeAccountId", acct.id!))
          .first();
        if (org) {
          await ctx.db.patch(org._id, {
            stripeChargesEnabled: Boolean(acct.charges_enabled),
            stripeDetailsSubmitted: Boolean(acct.details_submitted),
          });
        }
      }
    }

    /* A studio's own Pulse subscription (agency-plan trial or beta-to-paid),
       tagged with its orgId at checkout. Mirrored straight from the event:
       status, trial window (Stripe is the source of truth) and card. */
    const subMeta = (obj.metadata as Record<string, string> | undefined) ?? {};
    if (
      !event.account &&
      subMeta.orgId &&
      (e.type === "customer.subscription.created" ||
        e.type === "customer.subscription.updated" ||
        e.type === "customer.subscription.deleted")
    ) {
      await applyOrgSubscription(ctx, subMeta.orgId, toSubscriptionShape(obj));
      await markProcessed(ctx, event.id, e.type);
      return { ok: true };
    }

    /* Three days before a trial converts. Email the owner that the saved card
       will be charged, and record it. Studio subscriptions carry an orgId;
       a platform (agency) subscription is found by its customer. */
    if (!event.account && e.type === "customer.subscription.trial_will_end") {
      const trialEnd = typeof obj.trial_end === "number" ? obj.trial_end * 1000 : Date.now() + 3 * 86_400_000;
      await ctx.scheduler.runAfter(0, internal.trialBilling.notifyTrialWillEnd, {
        orgId: subMeta.orgId || undefined,
        customerId: subMeta.orgId ? undefined : (typeof obj.customer === "string" ? obj.customer : undefined),
        trialEndMs: trialEnd,
      });
      await markProcessed(ctx, event.id, e.type);
      return { ok: true };
    }

    if (e.type === "customer.subscription.updated") {
      // Connect-account event: a studio's client subscription. Route to memberships.
      if (event.account) {
        const subId = obj.id as string;
        const periodStart = obj.current_period_start as number | undefined;
        const periodEnd = obj.current_period_end as number | undefined;
        await ctx.scheduler.runAfter(0, internal.memberships._applySubscriptionEvent, {
          stripeSubscriptionId: subId,
          stripeCustomerId: obj.customer as string | undefined,
          status: mapSubStatus(obj.status as string),
          currentPeriodStart: periodStart ? periodStart * 1000 : undefined,
          currentPeriodEnd: periodEnd ? periodEnd * 1000 : undefined,
        });
        await markProcessed(ctx, event.id, e.type);
        return { ok: true };
      }
    }

    /* The platform subscription (Core / Growth / Max). Every tier is recorded,
       downgrades to core included, and the Stripe status drives access:
       past_due keeps studios on while Stripe retries; unpaid, paused or
       canceled pauses them; a recovered payment turns them back on. */
    if (!event.account && (e.type === "customer.subscription.created" || e.type === "customer.subscription.updated")) {
      const items = (obj.items as { data?: Array<{ price?: { id?: string } }> } | undefined)?.data ?? [];
      const priceId = items[0]?.price?.id;
      const match = priceId ? tierForPriceId(priceId) : null;
      const ag = await agencyByCustomer(ctx, obj.customer);
      if (ag && (match || !priceId)) {
        await applyAgencySubscription(ctx, ag, String(obj.status ?? ""), match?.tier ?? null);
      }
    }

    /* Platform invoices. invoice.payment_failed marks the agency past_due and
       emails the owner (first and last attempt); payment_action_required sends
       the owner to Stripe's page to confirm the charge with their bank;
       invoice.paid clears both. Studio-level invoices carry other customers,
       so no agency matches and they fall through. */
    if (!event.account && (e.type === "invoice.payment_failed" || e.type === "invoice.payment_action_required" || e.type === "invoice.paid")) {
      const ag = invoiceSubscriptionId(obj) ? await agencyByCustomer(ctx, obj.customer) : null;
      if (ag) {
        const amountCents = typeof obj.amount_due === "number" ? obj.amount_due : undefined;
        if (e.type === "invoice.paid") {
          await ctx.db.patch(ag._id, {
            paymentFailedAt: undefined,
            paymentActionUrl: undefined,
            ...(ag.status === "past_due" ? { status: "active" as const } : {}),
          });
        } else if (e.type === "invoice.payment_failed") {
          await ctx.db.patch(ag._id, {
            paymentFailedAt: ag.paymentFailedAt ?? Date.now(),
            ...(ag.status === "active" || ag.status === "trial" ? { status: "past_due" as const } : {}),
          });
          if (shouldEmailPaymentFailed(obj)) {
            const next = typeof obj.next_payment_attempt === "number" ? obj.next_payment_attempt * 1000 : undefined;
            await ctx.scheduler.runAfter(0, internal.platformBilling.notifyPaymentFailed, {
              customerId: obj.customer as string,
              amountCents,
              nextAttemptMs: next,
            });
          }
        } else {
          const url = typeof obj.hosted_invoice_url === "string" ? obj.hosted_invoice_url : undefined;
          await ctx.db.patch(ag._id, { paymentActionUrl: url });
          if (url) {
            await ctx.scheduler.runAfter(0, internal.platformBilling.notifyActionRequired, {
              customerId: obj.customer as string,
              amountCents,
              confirmUrl: url,
            });
          }
        }
      }
    }

    if (e.type === "customer.subscription.deleted") {
      // Connect-account event: a studio's client subscription was cancelled.
      if (event.account) {
        const subId = obj.id as string;
        await ctx.scheduler.runAfter(0, internal.memberships._applySubscriptionEvent, {
          stripeSubscriptionId: subId,
          status: "cancelled",
        });
        await markProcessed(ctx, event.id, e.type);
        return { ok: true };
      }
      const ag = await agencyByCustomer(ctx, obj.customer);
      if (ag) await lockAgency(ctx, ag);
    }

    await markProcessed(ctx, event.id, e.type);
    return { duplicate: false };
  },
});
