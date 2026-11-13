import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { recordRecoveryOnPaid } from "./recoveryOnPaid";
import { notifyTeam } from "./notify";
import { money } from "./money";

/* ============================================================
   Stripe webhook branches for a client's card on file. The ONLY writers of
   artists.defaultPaymentMethodId: nothing a browser sends can set a card.

   - setup_intent.succeeded  -> staff "Add a card" (cardOnFile.createSetupIntent)
   - payment_intent.succeeded, metadata.kind "booking_card"
                             -> the card a client paid a deposit with and
                                agreed could be saved (booking.payViaStripe)
   - payment_intent.succeeded, metadata.kind "no_show_fee"
                             -> a fee charged to that card (cardOnFile.chargeFee);
                                settles the invoice even if the action that
                                charged it never heard back from Stripe.

   Every branch checks the connected account belongs to the studio, the
   Stripe customer is that client's, and returns an outcome suffix that the
   caller records in stripeEvents (one row per event id, so a replay is a
   no-op).
   ============================================================ */

export type CardEventResult = { handled: false } | { handled: true; suffix: string };

type Obj = Record<string, unknown>;

async function accountOwnsOrg(ctx: MutationCtx, account: string | undefined, orgId: string): Promise<boolean> {
  if (!account) return false;
  const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  return Boolean(org?.stripeAccountId) && org?.stripeAccountId === account;
}

function idOf(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

function createdMs(obj: Obj): number {
  return typeof obj.created === "number" ? obj.created * 1000 : Date.now();
}

/** A card saved after staff removed one is fine; a save Stripe created before
 *  the removal (a late or delayed event) must not put the old card back. */
function removedAfter(artist: Doc<"artists">, obj: Obj): boolean {
  return artist.cardRemovedAt !== undefined && createdMs(obj) <= artist.cardRemovedAt;
}

async function recordSaved(
  ctx: MutationCtx,
  artist: Doc<"artists">,
  paymentMethodId: string,
  via: "checkout" | "staff",
  stripeAccountId: string,
) {
  await ctx.db.patch(artist._id, {
    defaultPaymentMethodId: paymentMethodId,
    // The event came from this studio's own account for this client's
    // customer, so the customer (and the card) is on this account.
    stripeCustomerAccountId: stripeAccountId,
    cardSavedAt: Date.now(),
    cardSavedVia: via,
    // Filled in by fetchCardDetails; never show the old card's digits.
    cardBrand: undefined,
    cardLast4: undefined,
  });
  await ctx.db.insert("activity", {
    orgId: artist.orgId,
    kind: "client.card_saved",
    summary:
      via === "checkout"
        ? `${artist.name} saved a card at checkout and agreed to the cancellation policy`
        : `Card saved for ${artist.name}`,
    entityType: "artist",
    entityId: artist._id,
    accent: "positive",
  });
  if (process.env.STRIPE_SECRET_KEY) {
    await ctx.scheduler.runAfter(0, internal.cardOnFile.fetchCardDetails, {
      artistId: artist._id,
      paymentMethodId,
      stripeAccountId,
    });
  }
}

/** setup_intent.succeeded on a studio's connected account (staff "Add a card"). */
export async function handleSetupIntentSucceeded(
  ctx: MutationCtx,
  account: string | undefined,
  si: Obj,
): Promise<CardEventResult> {
  // Platform events (no account) belong to Pulse's own billing, never a client.
  if (!account) return { handled: false };
  const meta = (si.metadata as Record<string, string> | undefined) ?? {};
  if (meta.kind !== "card_on_file" || !meta.artistId || !meta.orgId) {
    return { handled: true, suffix: ".ignored" };
  }
  const artistId = ctx.db.normalizeId("artists", meta.artistId);
  const artist = artistId ? await ctx.db.get(artistId) : null;
  if (!artist || artist.orgId !== meta.orgId || !(await accountOwnsOrg(ctx, account, artist.orgId))) {
    return { handled: true, suffix: ".account_mismatch" };
  }
  const customer = idOf(si.customer);
  if (!customer || !artist.stripeCustomerId || customer !== artist.stripeCustomerId) {
    return { handled: true, suffix: ".customer_mismatch" };
  }
  const pm = idOf(si.payment_method);
  if (si.status !== "succeeded" || si.usage !== "off_session" || !pm) {
    return { handled: true, suffix: ".not_succeeded" };
  }
  if (removedAfter(artist, si)) return { handled: true, suffix: ".card_removed" };
  await recordSaved(ctx, artist, pm, "staff", account);
  return { handled: true, suffix: "" };
}

/** payment_intent.succeeded on a studio's connected account: a deposit that
 *  saved the card, or a no-show fee charged to it. */
export async function handlePaymentIntentSucceeded(
  ctx: MutationCtx,
  account: string | undefined,
  pi: Obj,
): Promise<CardEventResult> {
  if (!account) return { handled: false };
  const meta = (pi.metadata as Record<string, string> | undefined) ?? {};
  if (meta.kind === "booking_card") return { handled: true, suffix: await saveBookingCard(ctx, account, pi, meta) };
  if (meta.kind === "no_show_fee") return { handled: true, suffix: await settleFee(ctx, account, pi, meta) };
  return { handled: false };
}

async function saveBookingCard(ctx: MutationCtx, account: string, pi: Obj, meta: Record<string, string>): Promise<string> {
  const sessionId = meta.sessionId ? ctx.db.normalizeId("sessions", meta.sessionId) : null;
  const session = sessionId ? await ctx.db.get(sessionId) : null;
  if (!session || (meta.orgId && meta.orgId !== session.orgId) || !(await accountOwnsOrg(ctx, account, session.orgId))) {
    return ".account_mismatch";
  }
  const artist = await ctx.db.get(session.artistId);
  if (!artist || artist.orgId !== session.orgId) return ".account_mismatch";
  if (meta.artistId && meta.artistId !== artist._id) return ".customer_mismatch";
  const customer = idOf(pi.customer);
  if (!customer || !artist.stripeCustomerId || customer !== artist.stripeCustomerId) {
    return ".customer_mismatch";
  }
  const pm = idOf(pi.payment_method);
  if (pi.status !== "succeeded" || pi.setup_future_usage !== "off_session" || !pm) {
    return ".not_succeeded";
  }
  // No agreement recorded means the card is not kept for fees.
  const consent = session.cardConsent;
  if (!consent) return ".no_consent";
  if (removedAfter(artist, pi)) return ".card_removed";
  await ctx.db.patch(session._id, { cardConsent: { ...consent, paymentMethodId: pm, savedAt: Date.now() } });
  await recordSaved(ctx, artist, pm, "checkout", account);
  return "";
}

async function settleFee(ctx: MutationCtx, account: string, pi: Obj, meta: Record<string, string>): Promise<string> {
  const invoiceId = meta.invoiceId ? ctx.db.normalizeId("invoices", meta.invoiceId) : null;
  const inv = invoiceId ? await ctx.db.get(invoiceId) : null;
  if (!inv || !(await accountOwnsOrg(ctx, account, inv.orgId))) return ".account_mismatch";
  const reference = idOf(pi.id);
  if (pi.status !== "succeeded" || !reference) return ".not_succeeded";
  const charged = typeof pi.amount === "number" ? pi.amount : null;
  if (charged !== inv.amountCents) {
    // Money came in, but not the amount on the invoice: never settle it
    // silently, and never drop it silently either.
    await flagFeeChargeToCheck(
      ctx,
      inv,
      reference,
      `${charged === null ? "An unknown amount" : money(charged)} was charged to the client's saved card for invoice ${inv.number}, which is for ${money(inv.amountCents)}. The invoice was not marked paid. Check the charge in Stripe and refund or settle it by hand.`,
    );
    return ".amount_mismatch";
  }
  if ((inv.status === "paid" || inv.status === "void") && inv.autoCharge?.reference !== reference) {
    // The invoice was settled or cancelled another way (for example the
    // client paid the invoice link after the card charge reported failure).
    await flagFeeChargeToCheck(
      ctx,
      inv,
      reference,
      `The ${money(inv.amountCents)} no-show fee was charged to the client's saved card, but invoice ${inv.number} had already been marked ${inv.status}. Refund the charge in Stripe if the client should not pay twice.`,
    );
    return ".already_settled";
  }
  await markFeeInvoicePaid(ctx, inv, reference);
  return "";
}

/** A fee charge that needs a person: an insight and a team email. Shared by
 *  the webhook and the charge action's outcome. */
export async function flagFeeChargeToCheck(
  ctx: MutationCtx,
  inv: Doc<"invoices">,
  reference: string,
  body: string,
): Promise<void> {
  const title = `Check charge ${reference}: invoice ${inv.number}`;
  await ctx.db.insert("insights", {
    orgId: inv.orgId,
    kind: "risk",
    severity: "warning",
    title,
    body,
    entityType: "invoice",
    entityId: inv._id,
    status: "new",
  });
  await notifyTeam(ctx, {
    orgId: inv.orgId,
    subject: title,
    body,
    kind: "invoice.fee_charge_check",
    sessionId: inv.sessionId,
  });
}

/** Mark a fee invoice paid by a card charge. Idempotent: a second call for the
 *  same invoice does nothing. Returns whether this call moved it to paid. */
export async function markFeeInvoicePaid(
  ctx: MutationCtx,
  inv: Doc<"invoices">,
  reference: string,
): Promise<boolean> {
  if (inv.status === "paid" || inv.status === "void") return false;
  await ctx.db.patch(inv._id, {
    status: "paid",
    paidAt: Date.now(),
    paymentMethod: "card",
    // Keep the charge state the action owns; record which charge paid it.
    autoCharge: {
      status: inv.autoCharge?.status === "charging" ? "charging" : "succeeded",
      at: inv.autoCharge?.at ?? Date.now(),
      reference,
    },
  });
  // The fee counts as won back now that the money is in.
  await recordRecoveryOnPaid(ctx, inv, "card");
  await ctx.db.insert("activity", {
    orgId: inv.orgId,
    kind: "invoice.paid",
    summary: `No-Show Shield fee charged to the client's saved card (${reference})`,
    entityType: "invoice",
    entityId: inv._id as Id<"invoices">,
    accent: "positive",
  });
  return true;
}
