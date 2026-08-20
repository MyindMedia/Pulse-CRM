import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { stripeClient } from "./lib/stripe";
import { currentOrg } from "./lib/tenant";
import { requireCapability } from "./lib/access";

/* ============================================================
   Card on file - the No-Show Shield's auto-charge path.

   A studio saves a client's card (a Stripe SetupIntent on the
   studio's OWN connected account) so a late-cancel / no-show fee
   can be collected off-session instead of chasing an invoice. The
   fee invoice always exists first (sessions.assessNoShowShield);
   `chargeFee` settles it when a card is on file, and quietly leaves
   the invoice standing when the charge can't run or fails.

   Best-effort by design: everything is gated on Stripe being
   configured, the studio's connected account being charge-ready,
   and a saved customer + payment method. When any of that is
   missing the shield still ships fully functional via invoices.

   FOLLOW-UP: the client-side card-capture UI (Stripe Elements
   confirming the SetupIntent, then calling `_savePaymentMethod`)
   is not built yet - `createSetupIntent` returns the client secret
   the front end will need when that ships.
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
      stripeAccountId: org?.stripeAccountId ?? null,
      chargesEnabled: Boolean(org?.stripeChargesEnabled),
    };
  },
});

export const _saveCustomer = internalMutation({
  args: { artistId: v.id("artists"), stripeCustomerId: v.string() },
  handler: async (ctx, { artistId, stripeCustomerId }) => {
    await ctx.db.patch(artistId, { stripeCustomerId });
  },
});

/** Persist the confirmed payment method so future fees can be auto-charged.
 *  Called by the (future) card-capture UI once the SetupIntent succeeds. */
export const _savePaymentMethod = internalMutation({
  args: {
    artistId: v.id("artists"),
    stripeCustomerId: v.string(),
    paymentMethodId: v.string(),
  },
  handler: async (ctx, { artistId, stripeCustomerId, paymentMethodId }) => {
    await ctx.db.patch(artistId, {
      stripeCustomerId,
      defaultPaymentMethodId: paymentMethodId,
    });
  },
});

/**
 * Create a SetupIntent to save a client's card on the studio's connected
 * account, creating/reusing the Stripe customer first. Returns the client
 * secret (the front end confirms it with the publishable key). Gated finance
 * action; no-op friendly errors when Stripe isn't wired up.
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
    const stripe = stripeClient();
    let customerId = c.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create(
        {
          name: c.name,
          email: c.email ?? undefined,
          metadata: { artistId, orgId: c.orgId },
        },
        { stripeAccount: c.stripeAccountId },
      );
      customerId = customer.id;
      await ctx.runMutation(internal.cardOnFile._saveCustomer, {
        artistId,
        stripeCustomerId: customerId,
      });
    }
    const si = await stripe.setupIntents.create(
      { customer: customerId, usage: "off_session", payment_method_types: ["card"] },
      { stripeAccount: c.stripeAccountId },
    );
    return { clientSecret: si.client_secret, customerId, stripeAccountId: c.stripeAccountId };
  },
});

/** Internal - everything the off-session charge needs, resolved from the org. */
export const _chargeCtx = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return null;
    const [org, artist] = await Promise.all([
      ctx.db
        .query("orgs")
        .withIndex("by_org", (q) => q.eq("orgId", session.orgId))
        .first(),
      ctx.db.get(session.artistId),
    ]);
    return {
      title: session.title,
      stripeAccountId: org?.stripeAccountId ?? null,
      chargesEnabled: Boolean(org?.stripeChargesEnabled),
      stripeCustomerId: artist?.stripeCustomerId ?? null,
      paymentMethodId: artist?.defaultPaymentMethodId ?? null,
    };
  },
});

/** Internal - settle the fee invoice after a successful off-session charge. */
export const _markFeePaid = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    invoiceId: v.id("invoices"),
    amountCents: v.number(),
    reference: v.string(),
  },
  handler: async (ctx, { invoiceId, reference }) => {
    const inv = await ctx.db.get(invoiceId);
    if (!inv || inv.status === "paid" || inv.status === "void") return;
    await ctx.db.patch(invoiceId, { status: "paid", paidAt: Date.now(), paymentMethod: "card" });
    await ctx.db.insert("activity", {
      orgId: inv.orgId,
      kind: "invoice.paid",
      summary: `No-Show Shield fee auto-charged to card on file (${reference})`,
      entityType: "invoice",
      entityId: invoiceId,
      accent: "positive",
    });
  },
});

/**
 * Off-session charge for a No-Show Shield fee. Best-effort: silently no-ops when
 * Stripe / the connected account / the saved card aren't all present, and
 * swallows charge failures (the fee invoice stays outstanding for manual
 * follow-up). On success it settles the fee invoice.
 */
export const chargeFee = internalAction({
  args: {
    sessionId: v.id("sessions"),
    invoiceId: v.id("invoices"),
    amountCents: v.number(),
  },
  handler: async (ctx, { sessionId, invoiceId, amountCents }) => {
    if (!process.env.STRIPE_SECRET_KEY || amountCents <= 0) return;
    const c = await ctx.runQuery(internal.cardOnFile._chargeCtx, { sessionId });
    if (
      !c ||
      !c.stripeAccountId ||
      !c.chargesEnabled ||
      !c.stripeCustomerId ||
      !c.paymentMethodId
    ) {
      return;
    }
    try {
      const pi = await stripeClient().paymentIntents.create(
        {
          amount: amountCents,
          currency: "usd",
          customer: c.stripeCustomerId,
          payment_method: c.paymentMethodId,
          off_session: true,
          confirm: true,
          description: `${c.title} - cancellation fee`,
        },
        { stripeAccount: c.stripeAccountId },
      );
      if (pi.status === "succeeded") {
        await ctx.runMutation(internal.cardOnFile._markFeePaid, {
          sessionId,
          invoiceId,
          amountCents,
          reference: pi.id,
        });
      }
    } catch (err) {
      // Card declined / requires authentication / any Stripe error: leave the
      // fee invoice standing so staff can follow up. Never throw - this runs
      // detached from the cancel/no-show mutation.
      console.error(
        "cardOnFile.chargeFee failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  },
});
