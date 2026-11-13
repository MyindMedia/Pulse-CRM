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

   - A refund Stripe accepts but has not settled ("pending") stays
     "refund_pending" with its refund id; the client is told only when Stripe
     says it succeeded (refund webhooks, or the 15-minute sweep that asks
     Stripe). A refund Pulse cannot confirm is reported to the team once.

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
  if (!row.sessionId) return { label: "a Stripe Checkout", closed: "was deleted", artistId: null, slug: null };
  const s = await ctx.db.get(row.sessionId);
  const org = s ? await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", s.orgId)).first() : null;
  return { label: `"${s?.title ?? "a booking"}"`, closed: "was released", artistId: s?.artistId ?? null, slug: org?.slug ?? null };
}

async function clientEmail(ctx: MutationCtx, artistId: Id<"artists"> | null): Promise<string | null> {
  if (!artistId) return null;
  return (await ctx.db.get(artistId))?.email ?? null;
}

async function alertRefundFailed(
  ctx: MutationCtx,
  row: Doc<"strayPayments"> | null,
  error: string,
  unconfirmed = false,
) {
  if (!row) return;
  const what = await describe(ctx, row);
  await notifyTeam(ctx, {
    orgId: row.orgId,
    subject: `Refund failed - refund by hand: ${what.label} (${money(row.amountCents)})`,
    body: `A client paid ${money(row.amountCents)} on ${what.label} after it ${what.closed}, so they owe nothing. Pulse tried to refund it and could not (${error}). ${unconfirmed ? `Stripe did not answer, so check the payment in your Stripe dashboard first: if a refund already shows there, nothing else is needed. Otherwise refund it by hand` : `Refund it by hand in your Stripe dashboard`}${row.paymentIntent ? ` (payment ${row.paymentIntent})` : ""}.`,
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

/** How long a refund may sit in "refund_pending" before the sweep looks at it. */
export const STUCK_AFTER_MS = 15 * 60 * 1000;
/** Attempts at refunds.create when Stripe does not answer (same idempotency
 *  key each time, so a refund Stripe already made is returned, not repeated). */
export const REFUND_ATTEMPTS = 3;
const RETRY_DELAY_MS = 250;

type RefundOutcome =
  | { kind: "succeeded"; refundId: string }
  | { kind: "failed"; refundId?: string; error: string; unconfirmed: boolean }
  | { kind: "pending"; refundId: string; status: string };

function outcomeOf(r: { id: string; status?: string | null }): RefundOutcome {
  if (r.status === "succeeded") return { kind: "succeeded", refundId: r.id };
  if (r.status === "failed" || r.status === "canceled") {
    return { kind: "failed", refundId: r.id, error: `Stripe refund ${r.status}`, unconfirmed: false };
  }
  // "pending" or "requires_action": the money has not gone back yet.
  return { kind: "pending", refundId: r.id, status: String(r.status ?? "pending") };
}

async function createRefund(row: Doc<"strayPayments">): Promise<RefundOutcome> {
  let lastError = "Refund failed.";
  for (let attempt = 1; attempt <= REFUND_ATTEMPTS; attempt++) {
    try {
      const r = await stripeClient().refunds.create(
        {
          payment_intent: row.paymentIntent!,
          reason: "requested_by_customer",
          metadata: { pulseStrayPaymentId: row._id, pulseReason: row.reason },
        },
        { stripeAccount: row.stripeAccountId, idempotencyKey: refundIdempotencyKey(row.eventId) },
      );
      return outcomeOf(r);
    } catch (err) {
      lastError = String((err as Error)?.message ?? err).slice(0, 300);
      if (attempt < REFUND_ATTEMPTS) await new Promise((res) => setTimeout(res, RETRY_DELAY_MS * attempt));
    }
  }
  return { kind: "failed", error: lastError, unconfirmed: true };
}

/** Refund a stray payment in full on the studio's connected account. Only a
 *  row still "refund_pending" with no refund started is refunded; Stripe
 *  dedupes on the event key. */
export const refund = internalAction({
  args: { strayId: v.id("strayPayments") },
  handler: async (ctx, { strayId }) => {
    const row = await ctx.runQuery(internal.strayPayments._get, { strayId });
    if (!row || row.status !== "refund_pending" || !row.paymentIntent || row.refundId) return;
    const out = await createRefund(row);
    // Stripe never answered: it may already have refunded, so do not call
    // the refund failed or tell the client anything. The row stays
    // "refund_pending"; sweepStuck retries it with the same idempotency key
    // and tells the team once if it still cannot confirm (H206-R2-02).
    if (out.kind === "failed" && out.unconfirmed) return;
    await ctx.runMutation(internal.strayPayments._applyOutcome, { strayId, outcome: out });
  },
});

const outcomeV = v.union(
  v.object({ kind: v.literal("succeeded"), refundId: v.string() }),
  v.object({ kind: v.literal("failed"), refundId: v.optional(v.string()), error: v.string(), unconfirmed: v.boolean() }),
  v.object({ kind: v.literal("pending"), refundId: v.string(), status: v.string() }),
);

export const _applyOutcome = internalMutation({
  args: { strayId: v.id("strayPayments"), outcome: outcomeV },
  handler: async (ctx, { strayId, outcome }) => {
    await applyOutcome(ctx, strayId, outcome);
  },
});

async function applyOutcome(ctx: MutationCtx, strayId: Id<"strayPayments">, outcome: RefundOutcome) {
  if (outcome.kind === "succeeded") {
    await finishRefund(ctx, { strayId, ok: true, refundId: outcome.refundId });
  } else if (outcome.kind === "failed") {
    await finishRefund(ctx, { strayId, ok: false, refundId: outcome.refundId, error: outcome.error, unconfirmed: outcome.unconfirmed });
  } else {
    await markRefundInProgress(ctx, strayId, outcome.refundId, outcome.status);
  }
}

/** Stripe accepted the refund but has not sent the money back yet. The row
 *  stays "refund_pending" with the refund id; the client is not told
 *  "refunded" until Stripe says it succeeded. The team is told once. */
async function markRefundInProgress(ctx: MutationCtx, strayId: Id<"strayPayments">, refundId: string, status: string) {
  const row = await ctx.db.get(strayId);
  if (!row || row.status !== "refund_pending") return;
  if (row.refundId && row.refundId !== refundId) return;
  const first = !row.teamToldPendingAt;
  await ctx.db.patch(strayId, { refundId, ...(first ? { teamToldPendingAt: Date.now() } : {}) });
  if (!first) return;
  const what = await describe(ctx, row);
  await notifyTeam(ctx, {
    orgId: row.orgId,
    subject: `Refund in progress - ${what.label} (${money(row.amountCents)})`,
    body: `A client paid ${money(row.amountCents)} on ${what.label} after it ${what.closed}. Pulse asked Stripe to refund it in full (refund ${refundId}) and Stripe reports it as ${status.replace("_", " ")}. Pulse will tell you when it completes or if it fails.`,
    kind: "payment.refund_in_progress",
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
  });
}

/** Called by the webhook for refund.updated / refund.failed /
 *  charge.refund.updated. Acts only when the refund names a strayPayments row
 *  on the same connected account, for the same payment, and (if a refund id is
 *  already stored) the same refund. Returns whether it matched a row. */
export async function applyRefundUpdate(
  ctx: MutationCtx,
  { account, refund: r }: { account?: string; refund: Record<string, unknown> },
): Promise<boolean> {
  const meta = (r.metadata as Record<string, string> | undefined) ?? {};
  const strayId = meta.pulseStrayPaymentId ? ctx.db.normalizeId("strayPayments", meta.pulseStrayPaymentId) : null;
  if (!strayId || !account || typeof r.id !== "string") return false;
  const row = await ctx.db.get(strayId);
  if (!row || row.stripeAccountId !== account) return false;
  if (typeof r.payment_intent === "string" && row.paymentIntent && r.payment_intent !== row.paymentIntent) return false;
  if (row.refundId && row.refundId !== r.id) return false;
  await applyOutcome(ctx, strayId, outcomeOf({ id: r.id, status: r.status as string | undefined }));
  return true;
}

export const _stuck = internalQuery({
  args: { before: v.number() },
  handler: async (ctx, { before }) =>
    await ctx.db
      .query("strayPayments")
      .withIndex("by_status_created", (q) => q.eq("status", "refund_pending").lt("createdAt", before))
      .take(50),
});

/** Cron: a refund still "refund_pending" after STUCK_AFTER_MS. With a refund
 *  id, ask Stripe where it stands and finish the row. Without one (the
 *  refund action died before Stripe answered), try again with the same
 *  idempotency key. A refund still not settled is reported to the team once,
 *  so a stuck refund is never silent. */
export const sweepStuck = internalAction({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.runQuery(internal.strayPayments._stuck, { before: Date.now() - STUCK_AFTER_MS });
    for (const row of rows) {
      let out: RefundOutcome;
      try {
        out = row.refundId
          ? outcomeOf(await stripeClient().refunds.retrieve(row.refundId, {}, { stripeAccount: row.stripeAccountId }))
          : row.paymentIntent
            ? await createRefund(row)
            : { kind: "failed", error: "Stripe sent no payment id to refund.", unconfirmed: false };
      } catch (err) {
        out = { kind: "failed", error: String((err as Error)?.message ?? err).slice(0, 300), unconfirmed: true };
      }
      if (out.kind === "failed" && out.unconfirmed) {
        // Stripe still did not answer: do not mark it failed, tell the team once.
        await ctx.runMutation(internal.strayPayments._reportStuck, { strayId: row._id, error: out.error });
        continue;
      }
      await ctx.runMutation(internal.strayPayments._applyOutcome, { strayId: row._id, outcome: out });
      if (out.kind === "pending") {
        await ctx.runMutation(internal.strayPayments._reportStuck, { strayId: row._id, error: `Stripe reports the refund as ${out.status}` });
      }
    }
  },
});

export const _reportStuck = internalMutation({
  args: { strayId: v.id("strayPayments"), error: v.string() },
  handler: async (ctx, { strayId, error }) => {
    const row = await ctx.db.get(strayId);
    if (!row || row.status !== "refund_pending" || row.staleAlertedAt) return;
    await ctx.db.patch(strayId, { staleAlertedAt: Date.now() });
    const what = await describe(ctx, row);
    await notifyTeam(ctx, {
      orgId: row.orgId,
      subject: `Refund not confirmed - check Stripe: ${what.label} (${money(row.amountCents)})`,
      body: `A client paid ${money(row.amountCents)} on ${what.label} after it ${what.closed}, and Pulse has not been able to confirm the refund (${error}). Check the payment in your Stripe dashboard${row.paymentIntent ? ` (payment ${row.paymentIntent})` : ""}: if no refund shows, refund it by hand.`,
      kind: "payment.refund_stuck",
      ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    });
  },
});

export const _finishRefund = internalMutation({
  args: {
    strayId: v.id("strayPayments"),
    ok: v.boolean(),
    refundId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await finishRefund(ctx, args);
  },
});

async function finishRefund(
  ctx: MutationCtx,
  { strayId, ok, refundId, error, unconfirmed }: {
    strayId: Id<"strayPayments">; ok: boolean; refundId?: string; error?: string; unconfirmed?: boolean;
  },
) {
  const row = await ctx.db.get(strayId);
  if (!row || row.status !== "refund_pending") return;
  const now = Date.now();
  if (!ok) {
    await ctx.db.patch(strayId, { status: "refund_failed", error: error ?? "Refund failed.", ...(refundId ? { refundId } : {}), resolvedAt: now });
    await alertRefundFailed(ctx, row, error ?? "Refund failed.", unconfirmed);
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
}
