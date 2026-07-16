import { query, action, internalQuery, MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { stripeClient } from "./lib/stripe";
import { appUrl } from "./lib/links";
import { notify, notifyTeam } from "./lib/notify";
import { money } from "./lib/money";

/* ============================================================
   Public invoice payment. No auth - a client opens the pay link
   from their email/SMS. Charges the studio's own connected Stripe
   (settled by the checkout.session.completed webhook). Convex ids
   are unguessable, so the invoice id in the URL is the key.
   ============================================================ */

function effectiveStatus(status: string, dueDate: number): string {
  if (status === "paid" || status === "void" || status === "draft") return status;
  return dueDate < Date.now() ? "overdue" : status;
}

/** Sanitized invoice + studio branding for the public pay page. */
export const get = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const inv = await ctx.db.get(invoiceId);
    if (!inv) return null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", inv.orgId)).first();
    const artist = await ctx.db.get(inv.artistId);
    return {
      number: inv.number,
      amountCents: inv.amountCents,
      dueDate: inv.dueDate,
      status: effectiveStatus(inv.status, inv.dueDate),
      lineItems: inv.lineItems,
      clientName: artist?.name ?? "",
      studioName: org?.name ?? "Studio",
      accentColor: org?.accentColor ?? "#fdb913",
      logoUrl: org?.logoId ? await ctx.storage.getUrl(org.logoId) : null,
      // Whether online card payment is available (studio connected Stripe).
      payable: Boolean(process.env.STRIPE_SECRET_KEY && org?.stripeAccountId && org?.stripeChargesEnabled),
    };
  },
});

export const _chargeContext = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const inv = await ctx.db.get(invoiceId);
    if (!inv) return null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", inv.orgId)).first();
    return {
      number: inv.number,
      amountCents: inv.amountCents,
      status: inv.status,
      studioName: org?.name ?? "Studio",
      stripeAccountId: org?.stripeAccountId ?? null,
      chargesEnabled: Boolean(org?.stripeChargesEnabled),
      configured: Boolean(process.env.STRIPE_SECRET_KEY),
    };
  },
});

/** Start a hosted Checkout to pay the invoice on the studio's connected Stripe.
 *  Returns { url: null } when online payment isn't available. */
export const payViaStripe = action({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }): Promise<{ url: string | null }> => {
    const c = await ctx.runQuery(internal.invoicePay._chargeContext, { invoiceId });
    if (!c) throw new ConvexError("Invoice not found.");
    if (c.status === "paid") return { url: null };
    if (!c.configured || !c.stripeAccountId || !c.chargesEnabled) return { url: null };
    if (c.amountCents <= 0) return { url: null };

    const back = `${appUrl()}/pay/invoice/${invoiceId}`;
    const checkout = await stripeClient().checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: `${c.studioName} - Invoice ${c.number}` },
              unit_amount: c.amountCents,
            },
            quantity: 1,
          },
        ],
        success_url: `${back}?paid=1`,
        cancel_url: back,
        metadata: { invoiceId },
      },
      { stripeAccount: c.stripeAccountId },
    );
    return { url: checkout.url ?? null };
  },
});

/** Mark an invoice paid (called directly from the Stripe webhook mutation).
 *  Idempotent: a no-op if already paid. */
export async function settleInvoice(ctx: MutationCtx, invoiceId: Id<"invoices">) {
  const inv = await ctx.db.get(invoiceId);
  if (!inv || inv.status === "paid") return;
  await ctx.db.patch(invoiceId, { status: "paid", paidAt: Date.now(), paymentMethod: "card" });
  const artist = await ctx.db.get(inv.artistId);
  await ctx.db.insert("activity", {
    orgId: inv.orgId,
    kind: "invoice.paid",
    summary: `${inv.number} paid online by ${artist?.name ?? "client"}`,
    entityType: "invoice",
    entityId: invoiceId,
    accent: "positive",
  });
  // Receipt to the client + heads-up to the team.
  if (artist?.email) {
    await notify(ctx, {
      orgId: inv.orgId,
      channel: "email",
      recipient: artist.email,
      subject: `Payment received - invoice ${inv.number}`,
      body: `We received your online payment of ${money(inv.amountCents)} for invoice ${inv.number}. Thank you - this invoice is settled in full.`,
      kind: "invoice.paid",
    });
  }
  await notifyTeam(ctx, {
    orgId: inv.orgId,
    subject: `Invoice paid online - ${inv.number} (${money(inv.amountCents)})`,
    body: `${artist?.name ?? "A client"} paid invoice ${inv.number} online via Stripe: ${money(inv.amountCents)}.`,
    kind: "invoice.paid",
  });
}
