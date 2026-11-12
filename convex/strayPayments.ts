import { internalAction, internalQuery, MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { stripeClient } from "./lib/stripe";
import { notify, notifyTeam } from "./lib/notify";
import { money } from "./lib/money";

/* ============================================================
   Stray payments: money Stripe took on a studio's connected account that
   Pulse could not apply (truth-paid-after-release,
   truth-void-invoice-payable).

   - A booking released before the payment landed, or a cancelled (void) or
     unsent (draft) invoice: the client owes nothing, so Pulse refunds the
     payment in full on the studio's own connected account and tells the
     client and the team. If the refund call fails, the team is told to
     refund by hand and the row says so. Never dropped silently.
   - Anything else that could not be applied (for example a booking already
     paid in full): the team is alerted to review it; nothing is refunded
     automatically.

   Safe to run twice: the webhook is deduped per Stripe event, this table is
   deduped per PaymentIntent, the refund action only acts on a row still
   "refund_pending", and Stripe gets an idempotency key built from the event.
   ============================================================ */

export type StrayReason = Doc<"strayPayments">["reason"];

const REFUNDED_REASONS: ReadonlySet<StrayReason> = new Set(["released_booking", "void_invoice", "draft_invoice"]);

/** Idempotency key for the Stripe refund: one refund per Stripe event. */
export function refundIdempotencyKey(eventId: string): string {
  return `pulse-stray-refund-${eventId}`;
}

/** Record a payment Pulse could not apply and, for a released booking or a
 *  void/draft invoice, schedule its refund. Called from the webhook mutation
 *  after the connected account has been checked against the studio. Returns
 *  the row id, or null when this PaymentIntent was already recorded. */
export async function recordStrayPayment(
  ctx: MutationCtx,
  args: {
    orgId: string;
    reason: StrayReason;
    sessionId?: Id<"sessions">;
    invoiceId?: Id<"invoices">;
    eventId: string;
    paymentIntent?: string;
    checkoutSessionId?: string;
    stripeAccountId: string;
    amountCents: number;
    note?: string;
  },
): Promise<Id<"strayPayments"> | null> {
  if (args.paymentIntent) {
    const seen = await ctx.db
      .query("strayPayments")
      .withIndex("by_payment_intent", (q) => q.eq("paymentIntent", args.paymentIntent))
      .first();
    if (seen) return null;
  }
  const seenEvent = await ctx.db
    .query("strayPayments")
    .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
    .first();
  if (seenEvent) return null;

  const refund = REFUNDED_REASONS.has(args.reason);
  const canRefund = refund && Boolean(args.paymentIntent);
  const now = Date.now();
  const id = await ctx.db.insert("strayPayments", {
    orgId: args.orgId,
    reason: args.reason,
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
    ...(args.invoiceId ? { invoiceId: args.invoiceId } : {}),
    eventId: args.eventId,
    ...(args.paymentIntent ? { paymentIntent: args.paymentIntent } : {}),
    ...(args.checkoutSessionId ? { checkoutSessionId: args.checkoutSessionId } : {}),
    stripeAccountId: args.stripeAccountId,
    amountCents: args.amountCents,
    ...(args.note ? { note: args.note } : {}),
    status: canRefund ? "refund_pending" : refund ? "refund_failed" : "needs_review",
    ...(refund && !canRefund ? { error: "Stripe sent no payment id to refund.", resolvedAt: now } : {}),
    createdAt: now,
  });

  const what = await describe(ctx, args);
  await ctx.db.insert("activity", {
    orgId: args.orgId,
    kind: canRefund ? "payment.refund_started" : "payment.needs_review",
    summary: canRefund
      ? `${money(args.amountCents)} paid on ${what.label} after it ${what.closed} - refunding automatically`
      : `${money(args.amountCents)} payment on ${what.label} could not be applied - needs review`,
    entityType: args.invoiceId ? "invoice" : "session",
    entityId: (args.invoiceId ?? args.sessionId ?? id) as string,
    accent: "critical",
  });

  if (canRefund) {
    await ctx.scheduler.runAfter(0, internal.strayPayments.refund, { strayId: id });
  } else if (refund) {
    await alertRefundFailed(ctx, await ctx.db.get(id), "Stripe sent no payment id to refund.");
  } else {
    await notifyTeam(ctx, {
      orgId: args.orgId,
      subject: `Payment needs review - ${what.label} (${money(args.amountCents)})`,
      body: `A ${money(args.amountCents)} card payment on ${what.label} could not be applied in Pulse${args.note ? `: ${args.note}` : "."} Nothing was refunded. Check it in your Stripe dashboard${args.paymentIntent ? ` (payment ${args.paymentIntent})` : ""} and refund it there if the client paid twice.`,
      kind: "payment.needs_review",
      ...(args.sessionId ? { sessionId: args.sessionId } : {}),
    });
  }
  return id;
}

async function describe(
  ctx: MutationCtx,
  row: { sessionId?: Id<"sessions">; invoiceId?: Id<"invoices">; reason: StrayReason },
): Promise<{ label: string; closed: string; artistId: Id<"artists"> | null; slug: string | null }> {
  if (row.invoiceId) {
    const inv = await ctx.db.get(row.invoiceId);
    return {
      label: `invoice ${inv?.number ?? ""}`.trim(),
      closed: row.reason === "draft_invoice" ? "was still a draft" : "was cancelled",
      artistId: inv?.artistId ?? null,
      slug: null,
    };
  }
  const s = row.sessionId ? await ctx.db.get(row.sessionId) : null;
  const org = s ? await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", s.orgId)).first() : null;
  return { label: `"${s?.title ?? "a booking"}"`, closed: "was released", artistId: s?.artistId ?? null, slug: org?.slug ?? null };
}

async function clientEmail(ctx: MutationCtx, artistId: Id<"artists"> | null): Promise<string | null> {
  if (!artistId) return null;
  return (await ctx.db.get(artistId))?.email ?? null;
}

async function alertRefundFailed(ctx: MutationCtx, row: Doc<"strayPayments"> | null, error: string) {
  if (!row) return;
  const what = await describe(ctx, row);
  await notifyTeam(ctx, {
    orgId: row.orgId,
    subject: `Refund failed - refund by hand: ${what.label} (${money(row.amountCents)})`,
    body: `A client paid ${money(row.amountCents)} on ${what.label} after it ${what.closed}, so they owe nothing. Pulse tried to refund it and could not (${error}). Refund it by hand in your Stripe dashboard${row.paymentIntent ? ` (payment ${row.paymentIntent})` : ""}.`,
    kind: "payment.refund_failed",
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
  });
  const email = await clientEmail(ctx, what.artistId);
  if (email) {
    await notify(ctx, {
      orgId: row.orgId,
      channel: "email",
      recipient: email,
      subject: `About your ${money(row.amountCents)} payment`,
      body: `Your ${money(row.amountCents)} payment for ${what.label} went through after it ${what.closed}, so you do not owe it. The studio has been asked to refund you in full and will be in touch.`,
      kind: "payment.refund_failed",
      ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    });
  }
}

export const _get = internalQuery({
  args: { strayId: v.id("strayPayments") },
  handler: async (ctx, { strayId }) => await ctx.db.get(strayId),
});

/** Refund a stray payment in full on the studio's connected account. Only a
 *  row still "refund_pending" is refunded; Stripe dedupes on the event key. */
export const refund = internalAction({
  args: { strayId: v.id("strayPayments") },
  handler: async (ctx, { strayId }) => {
    const row = await ctx.runQuery(internal.strayPayments._get, { strayId });
    if (!row || row.status !== "refund_pending" || !row.paymentIntent) return;
    try {
      const r = await stripeClient().refunds.create(
        {
          payment_intent: row.paymentIntent,
          reason: "requested_by_customer",
          metadata: { pulseStrayPaymentId: strayId, pulseReason: row.reason },
        },
        { stripeAccount: row.stripeAccountId, idempotencyKey: refundIdempotencyKey(row.eventId) },
      );
      if (r.status === "failed" || r.status === "canceled") {
        await ctx.runMutation(internal.strayPayments._finishRefund, {
          strayId, ok: false, refundId: r.id, error: `Stripe refund ${r.status}`,
        });
        return;
      }
      await ctx.runMutation(internal.strayPayments._finishRefund, { strayId, ok: true, refundId: r.id });
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 300);
      await ctx.runMutation(internal.strayPayments._finishRefund, { strayId, ok: false, error: message });
    }
  },
});

export const _finishRefund = internalMutation({
  args: {
    strayId: v.id("strayPayments"),
    ok: v.boolean(),
    refundId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { strayId, ok, refundId, error }) => {
    const row = await ctx.db.get(strayId);
    if (!row || row.status !== "refund_pending") return;
    const now = Date.now();
    if (!ok) {
      await ctx.db.patch(strayId, { status: "refund_failed", error: error ?? "Refund failed.", ...(refundId ? { refundId } : {}), resolvedAt: now });
      await alertRefundFailed(ctx, row, error ?? "Refund failed.");
      return;
    }
    await ctx.db.patch(strayId, { status: "refunded", ...(refundId ? { refundId } : {}), resolvedAt: now });
    const what = await describe(ctx, row);
    await ctx.db.insert("activity", {
      orgId: row.orgId,
      kind: "payment.refunded",
      summary: `${money(row.amountCents)} refunded - paid on ${what.label} after it ${what.closed}`,
      entityType: row.invoiceId ? "invoice" : "session",
      entityId: (row.invoiceId ?? row.sessionId ?? strayId) as string,
      accent: "gold",
    });
    await notifyTeam(ctx, {
      orgId: row.orgId,
      subject: `Late payment refunded - ${what.label} (${money(row.amountCents)})`,
      body: `A client paid ${money(row.amountCents)} on ${what.label} after it ${what.closed}. Pulse refunded it in full on your Stripe account${refundId ? ` (refund ${refundId})` : ""}. Nothing else to do.`,
      kind: "payment.late_refunded",
      ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    });
    const email = await clientEmail(ctx, what.artistId);
    if (email) {
      const body = row.invoiceId
        ? row.reason === "draft_invoice"
          ? `Your ${money(row.amountCents)} payment for ${what.label} went through before the studio had sent the invoice, so we refunded it in full. The studio will send the invoice when it is ready. Refunds usually reach your card in 5 to 10 business days.`
          : `${what.label[0].toUpperCase()}${what.label.slice(1)} was cancelled before your payment went through, so we refunded the ${money(row.amountCents)} in full. You do not owe anything on it. Refunds usually reach your card in 5 to 10 business days.`
        : `Your booking ${what.label} had been released before your payment went through, so we refunded the ${money(row.amountCents)} in full. Refunds usually reach your card in 5 to 10 business days.${what.slug ? ` If you would still like a session, start a new booking from the studio page.` : ""}`;
      await notify(ctx, {
        orgId: row.orgId,
        channel: "email",
        recipient: email,
        subject: `Refunded - ${money(row.amountCents)}`,
        body,
        kind: "payment.late_refunded",
        ...(row.sessionId ? { sessionId: row.sessionId } : {}),
      });
    }
  },
});
