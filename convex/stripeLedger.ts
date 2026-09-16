import type Stripe from "stripe";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery, query, type MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { stripeClient } from "./lib/stripe";
import { financeLog } from "./lib/financeLinks";
import { currentOrgWithCapability } from "./lib/tenant";
import type { Doc, Id } from "./_generated/dataModel";

/* ============================================================
   Stripe clearing ledger.

   Stripe direct charges live on each studio's connected account. Automatic
   payouts settle batches of those balance movements into the studio's bank.
   This module imports the exact BalanceTransactions attached to a payout so a
   later bank match can treat the deposit as a transfer from Stripe clearing,
   never as a second copy of revenue.
   ============================================================ */

const payoutStatusV = v.union(
  v.literal("pending"),
  v.literal("in_transit"),
  v.literal("paid"),
  v.literal("failed"),
  v.literal("canceled"),
);

const ledgerEntryV = v.object({
  balanceTransactionId: v.string(),
  sourceId: v.optional(v.string()),
  type: v.string(),
  reportingCategory: v.optional(v.string()),
  grossCents: v.number(),
  feeCents: v.number(),
  netCents: v.number(),
  currency: v.string(),
  occurredAt: v.number(),
  availableAt: v.optional(v.number()),
  description: v.optional(v.string()),
});

type LedgerEntry = {
  balanceTransactionId: string;
  sourceId?: string;
  type: string;
  reportingCategory?: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  currency: string;
  occurredAt: number;
  availableAt?: number;
  description?: string;
};

type PayoutStatus = "pending" | "in_transit" | "paid" | "failed" | "canceled";

const MAX_BALANCE_TRANSACTIONS = 1_000;
const PAGE_SIZE = 100;
const MAX_ATTEMPTS = 3;

function sourceId(source: Stripe.BalanceTransaction["source"]): string | undefined {
  if (typeof source === "string") return source;
  return source?.id;
}

function normalizeEntry(row: Stripe.BalanceTransaction): LedgerEntry {
  return {
    balanceTransactionId: row.id,
    ...(sourceId(row.source) ? { sourceId: sourceId(row.source) } : {}),
    type: row.type,
    ...(row.reporting_category ? { reportingCategory: row.reporting_category } : {}),
    grossCents: row.amount,
    feeCents: row.fee,
    netCents: row.net,
    currency: row.currency.toUpperCase(),
    occurredAt: row.created * 1_000,
    availableAt: row.available_on * 1_000,
    ...(row.description ? { description: row.description.slice(0, 500) } : {}),
  };
}

function payoutStatus(status: string): PayoutStatus {
  if (status === "in_transit" || status === "paid" || status === "failed" || status === "canceled") {
    return status;
  }
  return "pending";
}

function isRefund(row: LedgerEntry): boolean {
  const label = `${row.type} ${row.reportingCategory ?? ""}`.toLowerCase();
  return label.includes("refund") || label.includes("reversal");
}

function isDispute(row: LedgerEntry): boolean {
  const label = `${row.type} ${row.reportingCategory ?? ""}`.toLowerCase();
  return label.includes("dispute") || label.includes("chargeback");
}

function isGrossPayment(row: LedgerEntry): boolean {
  const label = `${row.type} ${row.reportingCategory ?? ""}`.toLowerCase();
  return row.grossCents > 0 && (label.includes("charge") || label.includes("payment"));
}

function summarize(entries: LedgerEntry[]) {
  let grossCents = 0;
  let feeCents = 0;
  let refundCents = 0;
  let disputeCents = 0;
  let netCents = 0;
  for (const row of entries) {
    feeCents += row.feeCents;
    netCents += row.netCents;
    if (isDispute(row)) disputeCents += Math.abs(Math.min(0, row.grossCents));
    else if (isRefund(row)) refundCents += Math.abs(Math.min(0, row.grossCents));
    else if (isGrossPayment(row)) grossCents += row.grossCents;
  }
  // Preserve every other Stripe movement (reserves, fee credits, FX, manual
  // adjustments) so the clearing equation always lands on the payout net.
  const adjustmentCents = netCents - grossCents + refundCents + disputeCents + feeCents;
  return { grossCents, feeCents, refundCents, disputeCents, adjustmentCents, netCents };
}

async function matchPayoutToBank(
  ctx: MutationCtx,
  payoutId: Id<"stripePayouts">,
  payout: Pick<Doc<"stripePayouts">, "orgId" | "stripePayoutId" | "amountCents" | "currency" | "arrivalDate" | "bankTransactionId">,
): Promise<boolean> {
  if (payout.bankTransactionId || payout.arrivalDate === undefined) return Boolean(payout.bankTransactionId);
  const threeDays = 3 * 86_400_000;
  const candidates = (await ctx.db
    .query("bankTransactions")
    .withIndex("by_org_date", (q) => q.eq("orgId", payout.orgId).gte("date", payout.arrivalDate! - threeDays).lt("date", payout.arrivalDate! + threeDays + 1))
    .collect())
    .filter((row) => !row.removed && !row.pending && row.direction === "in"
      && row.amountCents === payout.amountCents && row.currency.toUpperCase() === payout.currency.toUpperCase()
      && !row.stripePayoutId && (!row.moneyInKind || row.moneyInKind === "stripe_payout"));
  const stripeNamed = candidates.filter((row) => /\bstripe\b|\bstrp\b/i.test(`${row.merchantName ?? ""} ${row.name}`));
  const match = stripeNamed.length === 1 ? stripeNamed[0] : null;
  if (!match) {
    if (candidates.length > 0) {
      await ctx.db.patch(payoutId, {
        reconciliationStatus: "needs_review",
        lastError: stripeNamed.length > 1
          ? "More than one Stripe-labeled bank deposit could match this payout."
          : "A same-amount deposit exists, but its bank description does not verify that it came from Stripe.",
      });
    }
    return false;
  }
  const now = Date.now();
  await ctx.db.patch(payoutId, { bankTransactionId: match._id, reconciliationStatus: "matched", lastError: undefined });
  await ctx.db.patch(match._id, {
    stripePayoutId: payoutId,
    moneyInKind: "stripe_payout",
    incomeCategory: undefined,
    excluded: true,
    excludeReason: "other",
    reconciledAt: now,
    updatedAt: now,
  });
  await financeLog(ctx, payout.orgId, {
    action: "stripe.payout_matched",
    actorType: "system",
    bankTransactionId: match._id,
    after: { stripePayoutId: payout.stripePayoutId, amountCents: payout.amountCents },
    detail: "Stripe payout matched to a Stripe-labeled bank deposit by amount and arrival date",
  });
  return true;
}

export const _orgByStripeAccount = internalQuery({
  args: { stripeAccountId: v.string() },
  returns: v.union(v.null(), v.object({ orgId: v.string() })),
  handler: async (ctx, { stripeAccountId }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_stripe_account", (q) => q.eq("stripeAccountId", stripeAccountId))
      .first();
    return org ? { orgId: org.orgId } : null;
  },
});

export const _upsertPayout = internalMutation({
  args: {
    orgId: v.string(),
    stripeAccountId: v.string(),
    stripePayoutId: v.string(),
    amountCents: v.number(),
    currency: v.string(),
    status: payoutStatusV,
    method: v.optional(v.string()),
    arrivalDate: v.optional(v.number()),
    reconciliationStatus: v.union(
      v.literal("pending"),
      v.literal("ready"),
      v.literal("needs_review"),
      v.literal("failed"),
    ),
    lastError: v.optional(v.string()),
    entries: v.array(ledgerEntryV),
  },
  returns: v.object({ inserted: v.number(), existing: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const summary = summarize(args.entries);
    const payout = await ctx.db
      .query("stripePayouts")
      .withIndex("by_account_payout", (q) =>
        q.eq("stripeAccountId", args.stripeAccountId).eq("stripePayoutId", args.stripePayoutId),
      )
      .first();

    const payoutFields = {
      orgId: args.orgId,
      stripeAccountId: args.stripeAccountId,
      stripePayoutId: args.stripePayoutId,
      amountCents: args.amountCents,
      currency: args.currency,
      status: args.status,
      method: args.method,
      arrivalDate: args.arrivalDate,
      grossCents: summary.grossCents,
      feeCents: summary.feeCents,
      refundCents: summary.refundCents,
      disputeCents: summary.disputeCents,
      adjustmentCents: summary.adjustmentCents,
      netCents: summary.netCents,
      reconciliationStatus:
        payout?.bankTransactionId && args.reconciliationStatus !== "failed"
          ? "matched" as const
          : args.reconciliationStatus,
      transactionCount: args.entries.length,
      lastError: args.lastError,
      syncedAt: now,
    };
    const payoutId = payout
      ? (await ctx.db.patch(payout._id, payoutFields), payout._id)
      : await ctx.db.insert("stripePayouts", { ...payoutFields, createdAt: now });

    let inserted = 0;
    let existing = 0;
    for (const entry of args.entries) {
      const prior = await ctx.db
        .query("stripeLedgerEntries")
        .withIndex("by_account_balance_transaction", (q) =>
          q.eq("stripeAccountId", args.stripeAccountId).eq("balanceTransactionId", entry.balanceTransactionId),
        )
        .first();
      if (prior) {
        existing += 1;
        continue;
      }
      await ctx.db.insert("stripeLedgerEntries", {
        orgId: args.orgId,
        stripeAccountId: args.stripeAccountId,
        payoutProviderId: args.stripePayoutId,
        ...entry,
        importedAt: now,
      });
      inserted += 1;
    }

    // Automatic payouts have an exact amount and expected arrival day. Match
    // only one unclaimed candidate so ambiguous deposits remain visible for a
    // person instead of silently attaching to the wrong bank line.
    if (!payout?.bankTransactionId && args.reconciliationStatus === "ready") {
      await matchPayoutToBank(ctx, payoutId, {
        orgId: args.orgId,
        stripePayoutId: args.stripePayoutId,
        amountCents: args.amountCents,
        currency: args.currency,
        arrivalDate: args.arrivalDate,
      });
    }
    return { inserted, existing };
  },
});

/** Re-run exact payout matching after a bank sync, including payouts that
 * arrived before Plaid published the corresponding deposit. */
export const matchReadyPayouts = internalMutation({
  args: { orgId: v.string() },
  returns: v.object({ matched: v.number() }),
  handler: async (ctx, { orgId }) => {
    const payouts = await ctx.db.query("stripePayouts")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("reconciliationStatus", "ready"))
      .take(100);
    let matched = 0;
    for (const payout of payouts) {
      if (await matchPayoutToBank(ctx, payout._id, payout)) matched += 1;
    }
    return { matched };
  },
});

export const _markSyncFailed = internalMutation({
  args: {
    orgId: v.string(),
    stripeAccountId: v.string(),
    stripePayoutId: v.string(),
    message: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const prior = await ctx.db
      .query("stripePayouts")
      .withIndex("by_account_payout", (q) =>
        q.eq("stripeAccountId", args.stripeAccountId).eq("stripePayoutId", args.stripePayoutId),
      )
      .first();
    if (prior) {
      await ctx.db.patch(prior._id, {
        ...(prior.bankTransactionId ? {} : { reconciliationStatus: "failed" as const }),
        lastError: args.message.slice(0, 500),
        syncedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("stripePayouts", {
        orgId: args.orgId,
        stripeAccountId: args.stripeAccountId,
        stripePayoutId: args.stripePayoutId,
        amountCents: 0,
        currency: "USD",
        status: "pending",
        reconciliationStatus: "failed",
        lastError: args.message.slice(0, 500),
        createdAt: Date.now(),
        syncedAt: Date.now(),
      });
    }
    return null;
  },
});

/** Accountant-facing Stripe clearing detail for one reporting period. */
export const report = query({
  args: { start: v.number(), end: v.number() },
  returns: v.object({
    entries: v.array(v.object({
      balanceTransactionId: v.string(), payoutProviderId: v.union(v.string(), v.null()),
      type: v.string(), reportingCategory: v.union(v.string(), v.null()),
      grossCents: v.number(), feeCents: v.number(), netCents: v.number(), currency: v.string(),
      occurredAt: v.number(), description: v.union(v.string(), v.null()),
    })),
    payouts: v.array(v.object({
      stripePayoutId: v.string(), amountCents: v.number(), currency: v.string(), status: payoutStatusV,
      arrivalDate: v.union(v.number(), v.null()), reconciliationStatus: v.string(),
      bankTransactionId: v.union(v.id("bankTransactions"), v.null()), lastError: v.union(v.string(), v.null()),
    })),
    truncated: v.boolean(),
  }),
  handler: async (ctx, { start, end }) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    if (![start, end].every(Number.isFinite) || start >= end) throw new Error("Choose a valid report period.");
    const entryRows = await ctx.db.query("stripeLedgerEntries")
      .withIndex("by_org_occurred", (q) => q.eq("orgId", orgId).gte("occurredAt", start).lt("occurredAt", end))
      .take(5001);
    const payoutRows = await ctx.db.query("stripePayouts")
      .withIndex("by_org_arrival", (q) => q.eq("orgId", orgId).gte("arrivalDate", start).lt("arrivalDate", end))
      .take(5001);
    const truncated = entryRows.length > 5000 || payoutRows.length > 5000;
    return {
      entries: entryRows.slice(0, 5000).map((row) => ({
        balanceTransactionId: row.balanceTransactionId,
        payoutProviderId: row.payoutProviderId ?? null,
        type: row.type,
        reportingCategory: row.reportingCategory ?? null,
        grossCents: row.grossCents,
        feeCents: row.feeCents,
        netCents: row.netCents,
        currency: row.currency,
        occurredAt: row.occurredAt,
        description: row.description ?? null,
      })),
      payouts: payoutRows.slice(0, 5000).map((row) => ({
        stripePayoutId: row.stripePayoutId,
        amountCents: row.amountCents,
        currency: row.currency,
        status: row.status,
        arrivalDate: row.arrivalDate ?? null,
        reconciliationStatus: row.reconciliationStatus,
        bankTransactionId: row.bankTransactionId ?? null,
        lastError: row.lastError ?? null,
      })),
      truncated,
    };
  },
});

async function payoutEntries(
  stripe: ReturnType<typeof stripeClient>,
  stripeAccountId: string,
  stripePayoutId: string,
): Promise<{ entries: LedgerEntry[]; truncated: boolean }> {
  const entries: LedgerEntry[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.balanceTransactions.list(
      {
        payout: stripePayoutId,
        limit: PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      { stripeAccount: stripeAccountId },
    );
    for (const row of page.data) {
      if (entries.length >= MAX_BALANCE_TRANSACTIONS) return { entries, truncated: true };
      entries.push(normalizeEntry(row));
    }
    if (!page.has_more || page.data.length === 0) return { entries, truncated: false };
    startingAfter = page.data[page.data.length - 1].id;
  }
}

/** Import one connected-account payout and the balance activity it settles. */
export const syncPayout = internalAction({
  args: {
    stripeAccountId: v.string(),
    stripePayoutId: v.string(),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { stripeAccountId, stripePayoutId, attempt = 0 }) => {
    const org = await ctx.runQuery(internal.stripeLedger._orgByStripeAccount, { stripeAccountId });
    if (!org) return null;
    try {
      const stripe = stripeClient();
      const payout = await stripe.payouts.retrieve(stripePayoutId, {}, { stripeAccount: stripeAccountId });
      const readyForComposition = payout.automatic && payout.reconciliation_status === "completed";
      const composition = readyForComposition
        ? await payoutEntries(stripe, stripeAccountId, stripePayoutId)
        : { entries: [] as LedgerEntry[], truncated: false };
      const status = payoutStatus(payout.status);
      const failed = status === "failed" || status === "canceled";
      const compositionNetCents = composition.entries.reduce((sum, row) => sum + row.netCents, 0);
      const amountMismatch = readyForComposition && compositionNetCents !== payout.amount;
      const reconciliationStatus = failed
        ? "failed" as const
        : !payout.automatic
          ? "needs_review" as const
          : composition.truncated || amountMismatch
            ? "needs_review" as const
            : readyForComposition
              ? "ready" as const
              : "pending" as const;
      await ctx.runMutation(internal.stripeLedger._upsertPayout, {
        orgId: org.orgId,
        stripeAccountId,
        stripePayoutId,
        amountCents: payout.amount,
        currency: payout.currency.toUpperCase(),
        status,
        method: payout.method,
        arrivalDate: payout.arrival_date * 1_000,
        reconciliationStatus,
        ...(composition.truncated
          ? { lastError: `Payout contains more than ${MAX_BALANCE_TRANSACTIONS} balance transactions; review in Stripe.` }
          : amountMismatch
            ? { lastError: `Stripe payout amount ${payout.amount} does not equal imported clearing net ${compositionNetCents}.` }
          : payout.failure_message
            ? { lastError: payout.failure_message }
            : {}),
        entries: composition.entries,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stripe payout reconciliation failed.";
      await ctx.runMutation(internal.stripeLedger._markSyncFailed, {
        orgId: org.orgId,
        stripeAccountId,
        stripePayoutId,
        message,
      });
      if (attempt + 1 < MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(60_000 * 2 ** attempt, internal.stripeLedger.syncPayout, {
          stripeAccountId,
          stripePayoutId,
          attempt: attempt + 1,
        });
      }
    }
    return null;
  },
});
