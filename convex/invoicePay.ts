import { fileUrl } from "./lib/media";
import { query, action, internalQuery, MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { stripeClient } from "./lib/stripe";
import { appUrl } from "./lib/links";
import { notify, notifyTeam } from "./lib/notify";
import { money } from "./lib/money";
import { recordRecoveryOnPaid } from "./lib/recoveryOnPaid";

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

/** Only an invoice the studio sent and nobody settled or cancelled can be
 *  paid by link. A draft has not been sent (a no-show fee draft is settled by
 *  cardOnFile.chargeFee on its own path); a void one was cancelled. */
export function payableByLink(status: string): boolean {
  return status === "sent" || status === "viewed" || status === "overdue";
}

/** Sanitized invoice + studio branding for the public pay page. A malformed
 *  or other-table id in the URL is "not found", not an error page. */
export const get = query({
  args: { invoiceId: v.string() },
  handler: async (ctx, args) => {
    const invoiceId = ctx.db.normalizeId("invoices", args.invoiceId);
    const inv = invoiceId ? await ctx.db.get(invoiceId) : null;
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
      logoUrl: org?.logoId ? await fileUrl(ctx, org.logoId) : null,
      // Whether online card payment is available (studio connected Stripe).
      payable: Boolean(process.env.STRIPE_SECRET_KEY && org?.stripeAccountId && org?.stripeChargesEnabled),
      // Whether this invoice can be paid at all (not a draft, void or paid).
      open: payableByLink(inv.status),
    };
  },
});

export const _normalize = internalQuery({
  args: { invoiceId: v.string() },
  handler: async (ctx, { invoiceId }) => ctx.db.normalizeId("invoices", invoiceId),
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
  args: { invoiceId: v.string() },
  handler: async (ctx, args): Promise<{ url: string | null }> => {
    const invoiceId = await ctx.runQuery(internal.invoicePay._normalize, { invoiceId: args.invoiceId });
    const c = invoiceId ? await ctx.runQuery(internal.invoicePay._chargeContext, { invoiceId }) : null;
    if (!c || !invoiceId) throw new ConvexError("Invoice not found.");
    if (!payableByLink(c.status)) return { url: null };
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
 *  Idempotent: a no-op if already paid. Never turns a cancelled (void) or
 *  unsent (draft) invoice into paid: the webhook refunds that money instead
 *  (strayPayments). Returns what it did. */
export async function settleInvoice(
  ctx: MutationCtx,
  invoiceId: Id<"invoices">,
): Promise<"settled" | "missing" | "paid" | "void" | "draft"> {
  const inv = await ctx.db.get(invoiceId);
  if (!inv) return "missing";
  if (inv.status === "paid" || inv.status === "void" || inv.status === "draft") return inv.status;
  await ctx.db.patch(invoiceId, { status: "paid", paidAt: Date.now(), paymentMethod: "card" });
  // Won-back money (a paid fee, or a bill paid after a reminder). Reporting only.
  await recordRecoveryOnPaid(ctx, inv, "card");
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
  return "settled";
}
