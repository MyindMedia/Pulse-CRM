import { MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { tierForPriceId } from "./lib/stripe";
import { settlePayment } from "./payments";
import { settleInvoice } from "./invoicePay";
import { applyPackagePurchase } from "./packages";
import { internal } from "./_generated/api";
import { normalizeEmail } from "./lib/emailKey";

/* ============================================================
   Stripe webhook handlers. Idempotent via auditEvents-keyed
   event ledger (one row per event.id with action="stripe.event").
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
  const existing = await ctx.db
    .query("auditEvents")
    .filter((q) =>
      q.and(
        q.eq(q.field("action"), "stripe.event"),
        q.eq(q.field("viewerId"), eventId),
      ),
    )
    .first();
  return Boolean(existing);
}

async function markProcessed(ctx: MutationCtx, eventId: string, eventType: string) {
  await ctx.db.insert("auditEvents", {
    viewerType: "guest",
    viewerId: eventId,
    action: "stripe.event",
    result: "allow",
    reason: eventType,
  });
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

      // Sub-account "add a card" (Stripe Checkout setup mode). The agency
      // re-bills this studio; once a card is captured we clear the trial gate.
      if (meta.kind === "subaccount_billing" && meta.orgId) {
        await ctx.scheduler.runAfter(0, internal.agencyBilling._markPaymentMethodOnFile, {
          orgId: meta.orgId,
          customerId: (obj.customer as string | undefined) ?? undefined,
          subscriptionId: (obj.subscription as string | undefined) ?? undefined,
        });
        await markProcessed(ctx, event.id, e.type);
        return { ok: true };
      }

      const customerId = obj.customer as string;
      const subscriptionId = obj.subscription as string;
      // Only platform subscription checkouts go past here.
      if (!subscriptionId) return { ok: true };
      const intendedTier =
        (meta.intendedTier as "studio" | "pro" | "growth" | "enterprise" | "agency") ?? "studio";
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
      if (intendedTier !== "studio" && clerkUserId) {
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
      const stripeCustomerId = obj.customer as string;
      const items = (obj.items as { data?: Array<{ price?: { id?: string } }> } | undefined)?.data ?? [];
      const priceId = items[0]?.price?.id;
      const tier = priceId ? tierForPriceId(priceId) : null;
      const ag = await ctx.db
        .query("agencies")
        .filter((q) => q.eq(q.field("stripeCustomerId"), stripeCustomerId))
        .first();
      if (ag && tier && tier !== "studio") {
        await ctx.db.patch(ag._id, {
          plan: tier,
          status: obj.status === "active" ? "active" : "trial",
        });
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
      const stripeCustomerId = obj.customer as string;
      const ag = await ctx.db
        .query("agencies")
        .filter((q) => q.eq(q.field("stripeCustomerId"), stripeCustomerId))
        .first();
      if (ag) {
        await ctx.db.patch(ag._id, { status: "paused" });
        const subs = await ctx.db
          .query("orgs")
          .withIndex("by_agency", (q) => q.eq("agencyId", ag.agencyId))
          .collect();
        for (const s of subs) {
          if (s.status !== "paused") await ctx.db.patch(s._id, { status: "paused" });
        }
      }
    }

    await markProcessed(ctx, event.id, e.type);
    return { duplicate: false };
  },
});
