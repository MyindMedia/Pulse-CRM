import { action, internalAction, internalQuery, query } from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { stripeClient } from "./lib/stripe";
import { currentOrg } from "./lib/tenant";
import { requireCapability } from "./lib/access";
import { notify, notifyTeam } from "./lib/notify";
import { money } from "./lib/money";
import { autoChargeDecision, feeEmailBody, NO_SHOW_CHARGE_DELAY_MS, paidTowardSession } from "./lib/cardConsent";
import { markFeeInvoicePaid } from "./lib/cardOnFileWebhook";

/* ============================================================
   Card on file - the No-Show Shield's auto-charge path.

   A client's card is saved on the studio's OWN connected Stripe account in
   one of two ways:
   - at checkout, when the studio has card charging switched on and the client
     ticks the agreement (booking.payViaStripe, setup_future_usage), or
   - by staff with "Add a card" (createSetupIntent below).
   Either way Pulse records the card ONLY from Stripe's webhook
   (lib/cardOnFileWebhook.ts). No function a browser can call takes a payment
   method id.

   A fee is charged to the card only when the studio switched charging on
   (orgs.noShowAutoCharge, OFF by default), the client agreed at checkout for
   that booking (sessions.cardConsent) and that same card is still on file
   (lib/cardConsent.ts autoChargeDecision). Otherwise, and whenever the charge
   fails or needs the client present, the fee stays a draft invoice and staff
   are told to send it.
   ============================================================ */

/** Internal - the artist + connected-account context for saving a card. */
export const _artistCtx = internalQuery({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => {
    const orgId = await currentOrg(ctx);
    // Saving a client's card for later collection is finance work.
    await requireCapability(ctx, "invoices.send", { orgId });
    const artist = await ctx.db.get(artistId);
    if (!artist || artist.orgId !== orgId) return null;
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    return {
      orgId,
      name: artist.name,
      email: artist.email ?? null,
      stripeCustomerId: artist.stripeCustomerId ?? null,
      stripeCustomerAccountId: artist.stripeCustomerAccountId ?? null,
      stripeAccountId: org?.stripeAccountId ?? null,
      chargesEnabled: Boolean(org?.stripeChargesEnabled),
    };
  },
});

/** Record the client's Stripe customer on a connected account. A customer
 *  already recorded on that same account wins (two clicks at once make two
 *  customers; the first recorded wins and both callers use it). A customer
 *  recorded on another account, or a legacy one Stripe says is gone, is
 *  replaced, and the card saved under it is cleared: it cannot be charged on
 *  this account. Returns the customer to use. */
export const _saveCustomer = internalMutation({
  args: { artistId: v.id("artists"), stripeCustomerId: v.string(), stripeAccountId: v.string() },
  handler: async (ctx, { artistId, stripeCustomerId, stripeAccountId }): Promise<string> => {
    const artist = await ctx.db.get(artistId);
    if (!artist) throw new ConvexError("Client not found.");
    const existing = artist.stripeCustomerId;
    if (existing && artist.stripeCustomerAccountId === stripeAccountId) return existing;
    if (existing === stripeCustomerId) {
      // A legacy customer Stripe confirmed is on this account: remember that.
      await ctx.db.patch(artistId, { stripeCustomerAccountId: stripeAccountId });
      return existing;
    }
    await ctx.db.patch(artistId, {
      stripeCustomerId,
      stripeCustomerAccountId: stripeAccountId,
      ...(existing
        ? {
            defaultPaymentMethodId: undefined,
            cardBrand: undefined,
            cardLast4: undefined,
            cardSavedAt: undefined,
            cardSavedVia: undefined,
          }
        : {}),
    });
    if (existing) {
      await ctx.db.insert("activity", {
        orgId: artist.orgId,
        kind: "client.stripe_customer_replaced",
        summary: `${artist.name}'s Stripe customer was from a previous Stripe connection; a new one was made${artist.defaultPaymentMethodId ? " and the old saved card was cleared" : ""}`,
        entityType: "artist",
        entityId: artistId,
        accent: "info",
      });
    }
    return stripeCustomerId;
  },
});

/** Stripe says this customer id does not exist (or was deleted) on the account. */
function customerMissing(err: unknown): boolean {
  const e = err as { code?: string; statusCode?: number } | null;
  return e?.code === "resource_missing" || e?.statusCode === 404;
}

/** The client's Stripe customer on the studio's connected account, created
 *  when missing. Shared by staff "Add a card" and checkout. A stored id is
 *  reused only when it was made on this same account; a legacy id with no
 *  recorded account is checked with Stripe first. */
export async function ensureCustomer(
  ctx: Pick<ActionCtx, "runMutation">,
  c: {
    artistId: Id<"artists">;
    orgId: string;
    name: string;
    email: string | null;
    stripeCustomerId: string | null;
    stripeCustomerAccountId?: string | null;
    stripeAccountId: string;
  },
): Promise<string> {
  if (c.stripeCustomerId && c.stripeCustomerAccountId === c.stripeAccountId) return c.stripeCustomerId;
  if (c.stripeCustomerId && !c.stripeCustomerAccountId) {
    try {
      const found = (await stripeClient().customers.retrieve(c.stripeCustomerId, {}, { stripeAccount: c.stripeAccountId })) as {
        id: string;
        deleted?: boolean;
      };
      if (!found.deleted) {
        return await ctx.runMutation(internal.cardOnFile._saveCustomer, {
          artistId: c.artistId,
          stripeCustomerId: c.stripeCustomerId,
          stripeAccountId: c.stripeAccountId,
        });
      }
    } catch (err) {
      // Only a customer Stripe says is missing is replaced; any other error
      // (network, outage) never throws away a customer that may be valid.
      if (!customerMissing(err)) throw err;
    }
  }
  const customer = await stripeClient().customers.create(
    {
      name: c.name,
      email: c.email ?? undefined,
      metadata: { artistId: c.artistId, orgId: c.orgId },
    },
    { stripeAccount: c.stripeAccountId },
  );
  return await ctx.runMutation(internal.cardOnFile._saveCustomer, {
    artistId: c.artistId,
    stripeCustomerId: customer.id,
    stripeAccountId: c.stripeAccountId,
  });
}

/**
 * Create a SetupIntent to save a client's card on the studio's connected
 * account, creating/reusing the Stripe customer first. Returns the client
 * secret (the front end confirms it with the publishable key). The card is
 * recorded only when Stripe's webhook says the SetupIntent succeeded, and only
 * for a SetupIntent carrying this metadata.
 */
export const createSetupIntent = action({
  args: { artistId: v.id("artists") },
  handler: async (
    ctx,
    { artistId },
  ): Promise<{
    clientSecret: string | null;
    customerId: string;
    // Elements has to be mounted against the SAME connected account the
    // SetupIntent was created on, or confirmation fails with a mismatched
    // client secret. Returned here so the client cannot get it wrong.
    stripeAccountId: string;
  }> => {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new ConvexError("Payments aren't configured yet.");
    }
    const c = await ctx.runQuery(internal.cardOnFile._artistCtx, { artistId });
    if (!c) throw new ConvexError("Client not found.");
    if (!c.stripeAccountId || !c.chargesEnabled) {
      throw new ConvexError("Connect your Stripe account first.");
    }
    const customerId = await ensureCustomer(ctx, { ...c, artistId, stripeAccountId: c.stripeAccountId });
    const si = await stripeClient().setupIntents.create(
      {
        customer: customerId,
        usage: "off_session",
        payment_method_types: ["card"],
        // The webhook saves the card only for a SetupIntent Pulse made for
        // this client in this studio.
        metadata: { kind: "card_on_file", artistId, orgId: c.orgId },
      },
      { stripeAccount: c.stripeAccountId },
    );
    return { clientSecret: si.client_secret, customerId, stripeAccountId: c.stripeAccountId };
  },
});

/** Whether a client has a card on file, for staff who handle money. Null for
 *  anyone else (or another studio's client). */
export const cardStatus = query({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => {
    const orgId = await currentOrg(ctx);
    try {
      await requireCapability(ctx, "invoices.read", { orgId });
    } catch {
      return null;
    }
    const artist = await ctx.db.get(artistId);
    if (!artist || artist.orgId !== orgId) return null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return {
      hasCard: Boolean(artist.defaultPaymentMethodId),
      brand: artist.cardBrand ?? null,
      last4: artist.cardLast4 ?? null,
      savedAt: artist.cardSavedAt ?? null,
      savedVia: artist.cardSavedVia ?? null,
      autoChargeOn: org?.noShowAutoCharge === true,
    };
  },
});

/** Remove the client's card on file. It is never charged again, and Stripe is
 *  asked to detach it from the customer. Safe to call twice. */
export const removeCard = mutation({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "invoices.send", { orgId });
    const artist = await ctx.db.get(artistId);
    if (!artist || artist.orgId !== orgId) throw new ConvexError("Client not found.");
    const pm = artist.defaultPaymentMethodId;
    await ctx.db.patch(artistId, {
      defaultPaymentMethodId: undefined,
      cardBrand: undefined,
      cardLast4: undefined,
      cardSavedAt: undefined,
      cardSavedVia: undefined,
      cardRemovedAt: Date.now(),
    });
    if (!pm) return { removed: false };
    await ctx.db.insert("activity", {
      orgId,
      kind: "client.card_removed",
      summary: `Card on file removed for ${artist.name}`,
      entityType: "artist",
      entityId: artistId,
      accent: "info",
    });
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (process.env.STRIPE_SECRET_KEY && org?.stripeAccountId) {
      await ctx.scheduler.runAfter(0, internal.cardOnFile.detachCard, {
        paymentMethodId: pm,
        stripeAccountId: org.stripeAccountId,
      });
    }
    return { removed: true };
  },
});

/** Best effort: detach a removed card in Stripe. Pulse already stopped using
 *  it, so a failure here only leaves it listed on the Stripe customer. */
export const detachCard = internalAction({
  args: { paymentMethodId: v.string(), stripeAccountId: v.string() },
  handler: async (_ctx, { paymentMethodId, stripeAccountId }) => {
    if (!process.env.STRIPE_SECRET_KEY) return;
    try {
      await stripeClient().paymentMethods.detach(paymentMethodId, {}, { stripeAccount: stripeAccountId });
    } catch (err) {
      console.error("cardOnFile.detachCard failed:", err instanceof Error ? err.message : String(err));
    }
  },
});

/** Best effort: read the saved card's brand and last 4 for display. */
export const fetchCardDetails = internalAction({
  args: { artistId: v.id("artists"), paymentMethodId: v.string(), stripeAccountId: v.string() },
  handler: async (ctx, { artistId, paymentMethodId, stripeAccountId }) => {
    if (!process.env.STRIPE_SECRET_KEY) return;
    try {
      const pm = await stripeClient().paymentMethods.retrieve(paymentMethodId, {}, { stripeAccount: stripeAccountId });
      const card = (pm as { card?: { brand?: string; last4?: string } }).card;
      if (!card?.last4) return;
      await ctx.runMutation(internal.cardOnFile._setCardDetails, {
        artistId,
        paymentMethodId,
        brand: card.brand ?? "card",
        last4: card.last4,
      });
    } catch (err) {
      console.error("cardOnFile.fetchCardDetails failed:", err instanceof Error ? err.message : String(err));
    }
  },
});

export const _setCardDetails = internalMutation({
  args: { artistId: v.id("artists"), paymentMethodId: v.string(), brand: v.string(), last4: v.string() },
  handler: async (ctx, { artistId, paymentMethodId, brand, last4 }) => {
    const artist = await ctx.db.get(artistId);
    // Only for the card still on file (it may have been removed or replaced).
    if (!artist || artist.defaultPaymentMethodId !== paymentMethodId) return;
    await ctx.db.patch(artistId, { cardBrand: brand, cardLast4: last4 });
  },
});

/** Internal - settle a fee invoice after a successful off-session charge.
 *  Idempotent (lib/cardOnFileWebhook.ts markFeeInvoicePaid). */
export const _markFeePaid = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    invoiceId: v.id("invoices"),
    amountCents: v.number(),
    reference: v.string(),
  },
  handler: async (ctx, { invoiceId, reference }) => {
    const inv = await ctx.db.get(invoiceId);
    if (!inv) return;
    await markFeeInvoicePaid(ctx, inv, reference);
  },
});

/** How long after a claim Pulse checks a charge that never reported back. */
export const FEE_CHARGE_CHECK_DELAY_MS = 15 * 60_000;

type ChargePlan = {
  invoiceId: Id<"invoices">;
  amountCents: number;
  title: string;
  orgId: string;
  sessionId: Id<"sessions">;
  stripeAccountId: string;
  stripeCustomerId: string;
  paymentMethodId: string;
};

/** Internal - claim a scheduled fee charge. Runs only from "pending", re-checks
 *  every rule against the data as it is now, and moves the invoice to
 *  "charging" so a second run (or a retry) finds nothing to do. */
export const _claimFeeCharge = internalMutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }): Promise<ChargePlan | null> => {
    const inv = await ctx.db.get(invoiceId);
    if (!inv || inv.autoCharge?.status !== "pending") return null;
    // Never before the undo window has passed; the scheduled run comes later.
    if (Date.now() < inv.autoCharge.at + NO_SHOW_CHARGE_DELAY_MS) return null;
    const skip = async (message: string) => {
      await ctx.db.patch(invoiceId, { autoCharge: { status: "skipped", at: Date.now(), message } });
      await feeFallback(ctx, inv, "skipped", message);
      return null;
    };
    if (inv.status === "paid" || inv.status === "void") {
      await ctx.db.patch(invoiceId, { autoCharge: { status: "skipped", at: Date.now(), message: `invoice ${inv.status}` } });
      return null;
    }
    const session = inv.sessionId ? await ctx.db.get(inv.sessionId) : null;
    if (!session || session.orgId !== inv.orgId) return await skip("booking not found");
    if (session.status !== "no_show") {
      // Staff undid the no-show (or it was never one): the fee no longer
      // applies, so nobody is asked to send it and the client is not told.
      await ctx.db.patch(invoiceId, {
        autoCharge: { status: "skipped", at: Date.now(), message: "booking is no longer a no-show" },
      });
      return null;
    }
    const [org, artist] = await Promise.all([
      ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", inv.orgId)).first(),
      ctx.db.get(inv.artistId),
    ]);
    if (!artist || artist.orgId !== inv.orgId || artist._id !== session.artistId) return await skip("client not found");
    const decision = autoChargeDecision({
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      switchOn: org?.noShowAutoCharge === true,
      stripeAccountId: org?.stripeAccountId,
      chargesEnabled: Boolean(org?.stripeChargesEnabled),
      stripeCustomerId: artist.stripeCustomerId,
      stripeCustomerAccountId: artist.stripeCustomerAccountId,
      defaultPaymentMethodId: artist.defaultPaymentMethodId,
      consent: session.cardConsent,
      status: session.status,
      feeCents: session.cancellationFeeCents ?? inv.amountCents,
      chargeCents: inv.amountCents,
      // What the client has paid toward the session as it stands now: a
      // payment made since the fee was assessed is never charged again.
      paidCents: paidTowardSession(session),
      startTime: session.startTime,
      // When the fee was assessed, not when this ran.
      now: inv.autoCharge.at,
    });
    if (!decision.charge) return await skip(decision.reason);
    const claimedAt = Date.now();
    await ctx.db.patch(invoiceId, { autoCharge: { status: "charging", at: claimedAt } });
    // If the action dies after this point (timeout, restart), nothing else
    // would ever leave "charging". A later check asks Stripe what happened
    // and settles or falls back; it does nothing once an outcome is recorded.
    await ctx.scheduler.runAfter(FEE_CHARGE_CHECK_DELAY_MS, internal.cardOnFile.reconcileFeeCharge, {
      invoiceId,
      stripeAccountId: org!.stripeAccountId!,
      stripeCustomerId: artist.stripeCustomerId!,
      claimedAt,
    });
    return {
      invoiceId,
      amountCents: inv.amountCents,
      title: session.title,
      orgId: inv.orgId,
      sessionId: session._id,
      stripeAccountId: org!.stripeAccountId!,
      stripeCustomerId: artist.stripeCustomerId!,
      paymentMethodId: artist.defaultPaymentMethodId!,
    };
  },
});

/** The fee was not charged: the invoice stays a draft, staff are told to send
 *  it, and the client is told an invoice will follow. */
async function feeFallback(
  ctx: MutationCtx,
  inv: Doc<"invoices">,
  outcome: "failed" | "needs_client" | "skipped",
  message: string,
) {
  const session = inv.sessionId ? await ctx.db.get(inv.sessionId) : null;
  const artist = await ctx.db.get(inv.artistId);
  const why =
    outcome === "needs_client"
      ? "the bank asked for the client to confirm it themselves"
      : outcome === "failed"
        ? `the card was not charged (${message})`
        : `it was not charged automatically (${message})`;
  const body = `The ${money(inv.amountCents)} fee for ${artist?.name ?? "a client"}${session ? ` on "${session.title}"` : ""} was not charged to their saved card: ${why}. Invoice ${inv.number} is still a draft. Open it and send it to collect the fee.`;
  await ctx.db.insert("insights", {
    orgId: inv.orgId,
    kind: "risk",
    severity: "warning",
    title: `Send invoice ${inv.number}: the no-show fee was not charged`,
    body,
    entityType: "invoice",
    entityId: inv._id,
    status: "new",
  });
  await ctx.db.insert("activity", {
    orgId: inv.orgId,
    kind: "invoice.auto_charge_failed",
    summary: `No-show fee not charged to card (${message}); invoice ${inv.number} needs sending`,
    entityType: "invoice",
    entityId: inv._id,
    accent: "warning",
  });
  await notifyTeam(ctx, {
    orgId: inv.orgId,
    subject: `No-show fee not charged - send invoice ${inv.number}`,
    body,
    kind: "invoice.auto_charge_failed",
    sessionId: session?._id,
  });
  if (artist?.email && session && (session.status === "no_show" || session.status === "cancelled")) {
    await clientFeeEmail(ctx, session, artist, inv, "invoice_to_follow");
  }
}

async function clientFeeEmail(
  ctx: MutationCtx,
  session: Doc<"sessions">,
  artist: Doc<"artists">,
  inv: Doc<"invoices">,
  outcome: "invoice_to_follow" | "charged",
) {
  if (!artist.email || (session.status !== "no_show" && session.status !== "cancelled")) return;
  const status = session.status;
  const label = status === "no_show" ? "no-show fee" : "late cancellation fee";
  const fee = session.cancellationFeeCents ?? inv.amountCents;
  await notify(ctx, {
    orgId: session.orgId,
    channel: "email",
    recipient: artist.email,
    subject: `${label[0].toUpperCase()}${label.slice(1)} - ${session.title}`,
    body: feeEmailBody({
      clientName: artist.name,
      label,
      status,
      title: session.title,
      feeCents: fee,
      depositForfeitCents: session.depositForfeited ? session.depositCents : 0,
      paidAppliedCents: Math.min(paidTowardSession(session), fee),
      balanceCents: inv.amountCents,
      outcome,
      cardLast4: artist.cardLast4,
    }),
    kind: `session.${status === "no_show" ? "no_show_fee" : "cancellation_fee"}`,
    sessionId: session._id,
  });
}

/** Internal - record what happened to a claimed charge. Acts once: only on an
 *  invoice whose charge is "charging". */
export const _feeChargeOutcome = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    outcome: v.union(v.literal("succeeded"), v.literal("failed"), v.literal("needs_client")),
    reference: v.optional(v.string()),
    message: v.optional(v.string()),
  },
  handler: async (ctx, { invoiceId, outcome, reference, message }) => {
    const inv = await ctx.db.get(invoiceId);
    if (!inv || inv.autoCharge?.status !== "charging") return;
    if (outcome === "succeeded" && reference) {
      const ours = inv.status === "paid" && inv.autoCharge.reference === reference;
      if (!ours && (inv.status === "paid" || inv.status === "void")) {
        // Money came in for an invoice someone already settled or cancelled
        // while the charge ran. Never keep it silently.
        await ctx.db.patch(invoiceId, { autoCharge: { status: "succeeded", at: Date.now(), reference } });
        await ctx.db.insert("insights", {
          orgId: inv.orgId,
          kind: "risk",
          severity: "warning",
          title: `Check charge ${reference}: invoice ${inv.number} was already ${inv.status}`,
          body: `The ${money(inv.amountCents)} no-show fee was charged to the client's saved card, but invoice ${inv.number} had already been marked ${inv.status}. Refund the charge in Stripe if the client should not pay twice.`,
          entityType: "invoice",
          entityId: inv._id,
          status: "new",
        });
        return;
      }
      if (!ours) await markFeeInvoicePaid(ctx, inv, reference);
      await ctx.db.patch(invoiceId, { autoCharge: { status: "succeeded", at: Date.now(), reference } });
      const session = inv.sessionId ? await ctx.db.get(inv.sessionId) : null;
      const artist = await ctx.db.get(inv.artistId);
      if (session && artist) await clientFeeEmail(ctx, session, artist, inv, "charged");
      return;
    }
    const status = outcome === "succeeded" ? "failed" : outcome;
    const text = message ?? (outcome === "needs_client" ? "needs the client to confirm" : "charge failed");
    await ctx.db.patch(invoiceId, { autoCharge: { status, at: Date.now(), reference, message: text } });
    await feeFallback(ctx, inv, status, text);
  },
});

/**
 * Off-session charge for a No-Show Shield fee, scheduled by
 * sessions.assessNoShowShield only when autoChargeDecision allowed it. Charges
 * at most once per invoice: it runs only after claiming the "pending" state,
 * and Stripe gets an idempotency key per invoice. Any failure leaves the fee
 * invoice as a draft and tells staff to send it.
 */
export const chargeFee = internalAction({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const plan = await ctx.runMutation(internal.cardOnFile._claimFeeCharge, { invoiceId });
    if (!plan) return;
    try {
      const pi = await stripeClient().paymentIntents.create(
        {
          amount: plan.amountCents,
          currency: "usd",
          customer: plan.stripeCustomerId,
          payment_method: plan.paymentMethodId,
          off_session: true,
          confirm: true,
          description: `${plan.title} - cancellation fee`,
          metadata: { kind: "no_show_fee", invoiceId: plan.invoiceId, sessionId: plan.sessionId, orgId: plan.orgId },
        },
        { stripeAccount: plan.stripeAccountId, idempotencyKey: `pulse-no-show-fee-${plan.invoiceId}` },
      );
      if (pi.status === "succeeded") {
        await ctx.runMutation(internal.cardOnFile._feeChargeOutcome, { invoiceId, outcome: "succeeded", reference: pi.id });
      } else if (pi.status === "requires_action" || pi.status === "requires_payment_method") {
        await ctx.runMutation(internal.cardOnFile._feeChargeOutcome, {
          invoiceId,
          outcome: pi.status === "requires_action" ? "needs_client" : "failed",
          reference: pi.id,
          message: pi.status === "requires_action" ? "the bank wants the client to confirm" : "card declined",
        });
      } else {
        // processing or anything else: not money in yet. Staff check Stripe;
        // the payment_intent.succeeded webhook settles it if it clears.
        await ctx.runMutation(internal.cardOnFile._feeChargeOutcome, {
          invoiceId,
          outcome: "failed",
          reference: pi.id,
          message: `Stripe reported ${pi.status}; check the charge in Stripe before sending the invoice`,
        });
      }
    } catch (err) {
      const e = err as { code?: string; type?: string; message?: string };
      const needsClient = e.code === "authentication_required";
      const message = needsClient
        ? "the bank wants the client to confirm"
        : e.type === "StripeCardError"
          ? `card declined${e.message ? `: ${e.message}` : ""}`
          : "Stripe did not confirm the charge; check Stripe before sending the invoice";
      console.error("cardOnFile.chargeFee failed:", e.code ?? e.type ?? "error");
      await ctx.runMutation(internal.cardOnFile._feeChargeOutcome, {
        invoiceId,
        outcome: needsClient ? "needs_client" : "failed",
        message,
      });
    }
  },
});

/** Internal - the claim time of a fee charge still "charging", or null. */
export const _chargingSince = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }): Promise<number | null> => {
    const inv = await ctx.db.get(invoiceId);
    return inv?.autoCharge?.status === "charging" ? inv.autoCharge.at : null;
  },
});

/**
 * A fee charge whose action never recorded an outcome (killed after the
 * claim). Ask Stripe for the PaymentIntent Pulse made for this invoice (on the
 * client's customer, on the studio's account, since the claim): settle it if
 * it succeeded, otherwise record the failure so the invoice is surfaced to
 * staff (feeFallback). Never creates a charge. A no-op once an outcome exists.
 */
export const reconcileFeeCharge = internalAction({
  args: {
    invoiceId: v.id("invoices"),
    stripeAccountId: v.string(),
    stripeCustomerId: v.string(),
    claimedAt: v.number(),
  },
  handler: async (ctx, { invoiceId, stripeAccountId, stripeCustomerId, claimedAt }) => {
    const since = await ctx.runQuery(internal.cardOnFile._chargingSince, { invoiceId });
    if (since === null) return;
    let found: { id: string; status: string } | null = null;
    try {
      if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe not configured");
      const list = await stripeClient().paymentIntents.list(
        { customer: stripeCustomerId, created: { gte: Math.floor(Math.min(since, claimedAt) / 1000) - 300 }, limit: 100 },
        { stripeAccount: stripeAccountId },
      );
      const pi = (list.data as { id: string; status: string; metadata?: Record<string, string> }[]).find(
        (p) => p.metadata?.kind === "no_show_fee" && p.metadata?.invoiceId === invoiceId,
      );
      found = pi ? { id: pi.id, status: pi.status } : null;
    } catch (err) {
      console.error("cardOnFile.reconcileFeeCharge: Stripe lookup failed:", err instanceof Error ? err.message : String(err));
      await ctx.runMutation(internal.cardOnFile._feeChargeOutcome, {
        invoiceId,
        outcome: "failed",
        message: "Pulse could not confirm the charge with Stripe; check Stripe before sending the invoice",
      });
      return;
    }
    if (!found) {
      await ctx.runMutation(internal.cardOnFile._feeChargeOutcome, {
        invoiceId,
        outcome: "failed",
        message: "the charge did not complete",
      });
    } else if (found.status === "succeeded") {
      await ctx.runMutation(internal.cardOnFile._feeChargeOutcome, { invoiceId, outcome: "succeeded", reference: found.id });
    } else {
      await ctx.runMutation(internal.cardOnFile._feeChargeOutcome, {
        invoiceId,
        outcome: found.status === "requires_action" ? "needs_client" : "failed",
        reference: found.id,
        message:
          found.status === "requires_action"
            ? "the bank wants the client to confirm"
            : `Stripe reported ${found.status}; check the charge in Stripe before sending the invoice`,
      });
    }
  },
});
