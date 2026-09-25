import { query } from "./_generated/server";
import { mutation } from "./functions";
import { v } from "convex/values";
import { currentActor, currentOrgWithCapability } from "./lib/tenant";
import { financeLog } from "./lib/financeLinks";
import { plSummary, monthlyRunRateCents } from "./lib/pnl";
import { expenseCategoryV } from "./lib/financeValidators";
import { EXPENSE_TAX_GROUP } from "./lib/financeCategories";

/* ============================================================
   Expenses - the money-OUT half of the books. Manual entry of
   rent, utilities, subscriptions, gear, repairs, contractor /
   engineer payouts, etc., plus a P&L roll-up (collected revenue
   minus expenses) so a studio finally sees true profit.

   Capability gates mirror the rest of finance: writes need
   invoices.send (owner/manager/accountant), reads need
   insights.read (the finance/analytics tier).
   ============================================================ */

const recurringV = v.union(v.literal("monthly"), v.literal("annual"));

export const create = mutation({
  args: {
    category: expenseCategoryV,
    amountCents: v.number(),
    date: v.number(),
    vendor: v.optional(v.string()),
    description: v.optional(v.string()),
    recurring: v.optional(recurringV),
    memberId: v.optional(v.id("members")),
    receiptId: v.optional(v.id("_storage")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "invoices.send");
    if (args.amountCents <= 0) throw new Error("Amount must be greater than zero.");
    if (args.memberId) {
      const m = await ctx.db.get(args.memberId);
      if (!m || m.orgId !== orgId) throw new Error("That team member isn't in this studio.");
    }
    const id = await ctx.db.insert("expenses", { orgId, ...args });
    await ctx.db.insert("activity", {
      orgId,
      kind: "expense.logged",
      summary: `Logged a ${args.category} expense of $${(args.amountCents / 100).toFixed(2)}${args.vendor ? ` to ${args.vendor}` : ""}`,
      entityType: "expense",
      entityId: id,
      accent: "info",
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("expenses"),
    category: v.optional(expenseCategoryV),
    amountCents: v.optional(v.number()),
    date: v.optional(v.number()),
    vendor: v.optional(v.string()),
    description: v.optional(v.string()),
    recurring: v.optional(v.union(recurringV, v.null())),
    memberId: v.optional(v.union(v.id("members"), v.null())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrgWithCapability(ctx, "invoices.send");
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new Error("Expense not found.");
    if (patch.amountCents !== undefined && patch.amountCents <= 0) {
      throw new Error("Amount must be greater than zero.");
    }
    // Allow clearing recurring / memberId by passing null.
    const fields: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(patch)) {
      if (val === undefined) continue;
      fields[k] = val === null ? undefined : val;
    }
    await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: { id: v.id("expenses") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "invoices.send");
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new Error("Expense not found.");
    // A deleted expense lets go of its receipt and bank line; neither is
    // deleted, both go back to needing attention, and the history says why.
    const actor = { actorType: "user" as const, actorName: await currentActor(ctx) };
    if (row.receiptDocId) {
      const r = await ctx.db.get(row.receiptDocId);
      if (r && r.expenseId === id) await ctx.db.patch(row.receiptDocId, { expenseId: undefined });
    }
    if (row.bankTransactionId) {
      const t = await ctx.db.get(row.bankTransactionId);
      if (t && t.expenseId === id) await ctx.db.patch(row.bankTransactionId, { expenseId: undefined, updatedAt: Date.now() });
    }
    if (row.receiptDocId || row.bankTransactionId || row.source) {
      await financeLog(ctx, orgId, {
        action: "expense.deleted", ...actor, expenseId: id,
        receiptId: row.receiptDocId, bankTransactionId: row.bankTransactionId,
        before: { amountCents: row.amountCents, category: row.category, date: row.date, vendor: row.vendor ?? null, source: row.source ?? "manual" },
      });
    }
    await ctx.db.delete(id);
  },
});

/** Upload URL for a receipt image/PDF attached to an expense. */
export const generateReceiptUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await currentOrgWithCapability(ctx, "invoices.send");
    return await ctx.storage.generateUploadUrl();
  },
});

/** Expense rows in a date range (newest first), hydrated with member name +
 *  receipt URL and file type. */
export const list = query({
  args: {
    start: v.optional(v.number()),
    end: v.optional(v.number()),
    category: v.optional(expenseCategoryV),
  },
  handler: async (ctx, { start, end, category }) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const rows = category
      ? start !== undefined && end !== undefined
        ? await ctx.db.query("expenses").withIndex("by_org_category_date", (q) => q.eq("orgId", orgId).eq("category", category).gte("date", start).lt("date", end)).take(5001)
        : start !== undefined
          ? await ctx.db.query("expenses").withIndex("by_org_category_date", (q) => q.eq("orgId", orgId).eq("category", category).gte("date", start)).take(5001)
          : end !== undefined
            ? await ctx.db.query("expenses").withIndex("by_org_category_date", (q) => q.eq("orgId", orgId).eq("category", category).lt("date", end)).take(5001)
            : await ctx.db.query("expenses").withIndex("by_org_category_date", (q) => q.eq("orgId", orgId).eq("category", category)).take(5001)
      : start !== undefined && end !== undefined
        ? await ctx.db.query("expenses").withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", start).lt("date", end)).take(5001)
        : start !== undefined
          ? await ctx.db.query("expenses").withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", start)).take(5001)
          : end !== undefined
            ? await ctx.db.query("expenses").withIndex("by_org_date", (q) => q.eq("orgId", orgId).lt("date", end)).take(5001)
            : await ctx.db.query("expenses").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(5001);
    if (rows.length > 5000) throw new Error("More than 5,000 expenses match this view. Choose a shorter period.");
    rows.sort((a, b) => b.date - a.date);
    return await Promise.all(
      rows.map(async (r) => ({
        ...r,
        memberName: r.memberId ? (await ctx.db.get(r.memberId))?.name ?? null : null,
        receiptUrl: r.receiptId ? await ctx.storage.getUrl(r.receiptId) : null,
        // Image or PDF, so the list can draw a thumbnail of the right kind.
        receiptFileType: r.receiptId ? (await ctx.db.system.get(r.receiptId))?.contentType ?? null : null,
      })),
    );
  },
});

/**
 * Profit-and-loss roll-up for a window. Collected revenue = paid invoices plus
 * paid booking payments, each at its collection timestamp. Completion invoices
 * contain only the balance remaining AFTER booking payments, and settling an
 * invoice does not create a payment row. A shared session is not a duplicate
 * collection. Minus expenses; also returns the monthly recurring run-rate.
 */
export const plReport = query({
  args: {
    start: v.number(), end: v.number(),
    bankStart: v.optional(v.number()), bankEnd: v.optional(v.number()),
    orgId: v.optional(v.string()),
  },
  returns: v.object({
    revenueCents: v.number(), expensesCents: v.number(), netCents: v.number(), marginPct: v.number(),
    byCategory: v.array(v.object({ category: v.string(), amountCents: v.number() })),
    byTaxCategory: v.array(v.object({ taxCategory: v.string(), amountCents: v.number() })),
    byIncomeCategory: v.array(v.object({ category: v.string(), amountCents: v.number() })),
    revenueFromPaymentsCents: v.number(), revenueFromInvoicesCents: v.number(), revenueFromBankCents: v.number(),
    revenueFromPackagesCents: v.number(), revenueFromMembershipsCents: v.number(),
    paymentsByMethod: v.array(v.object({ method: v.string(), amountCents: v.number() })),
    expenseCount: v.number(), monthlyRecurringCents: v.number(),
    stripe: v.object({
      grossSalesCents: v.number(), feesCents: v.number(), refundsCents: v.number(), disputesCents: v.number(),
      adjustmentsCents: v.number(), clearingNetCents: v.number(), payoutsCents: v.number(), unmatchedPayouts: v.number(),
      foreignCurrencyEntries: v.number(), foreignCurrencyPayouts: v.number(),
    }),
    bank: v.object({
      connected: v.boolean(), needsAttention: v.number(), inCents: v.number(), outCents: v.number(), netCents: v.number(),
      cashInCents: v.number(), cashOutCents: v.number(), cashNetCents: v.number(),
      outByCategory: v.array(v.object({ category: v.string(), amountCents: v.number() })),
      cashOnHandCents: v.number(), cardOwedCents: v.number(), balanceAsOf: v.union(v.number(), v.null()),
      foreignCurrencyRows: v.number(), foreignCurrencyAccounts: v.number(),
    }),
    reconciliation: v.object({
      unmatchedOutflows: v.number(), unmatchedInflows: v.number(), receiptsUnmatched: v.number(), receiptsToBook: v.number(),
      receiptsNeedingReview: v.number(), expensesWithoutReceipt: v.number(),
    }),
  }),
  handler: async (ctx, { start, end, bankStart, bankEnd, orgId: requestedOrgId }) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read", requestedOrgId);
    // Callers may supply UTC calendar bounds for date-only bank/receipt rows.
    // Legacy callers retain the original range; collected-at timestamps keep
    // their local-time boundaries so late-night payments stay in the right month.
    const calendarStart = bankStart ?? start;
    const calendarEnd = bankEnd ?? end;
    if (![start, end, calendarStart, calendarEnd].every(Number.isFinite) || start >= end || calendarStart >= calendarEnd) {
      throw new Error("Choose a valid report period.");
    }

    const [currentInvoices, legacyInvoices] = await Promise.all([
      ctx.db.query("invoices").withIndex("by_org_paidAt", (q) => q.eq("orgId", orgId).gte("paidAt", start).lt("paidAt", end)).take(5001),
      ctx.db.query("invoices").withIndex("by_org_paidAt", (q) => q.eq("orgId", orgId).eq("paidAt", undefined)).take(1001),
    ]);
    if (currentInvoices.length > 5000 || legacyInvoices.length > 1000) throw new Error("This report period is too large. Choose a shorter period or migrate legacy invoice dates.");
    const paidInvoices = [...currentInvoices, ...legacyInvoices].filter(
      (i) => i.status === "paid" && (i.paidAt ?? i._creationTime) >= start && (i.paidAt ?? i._creationTime) < end,
    );
    const invoiceRevenue = paidInvoices.reduce((s, i) => s + i.amountCents, 0);

    const [currentPayments, legacyPayments] = await Promise.all([
      ctx.db.query("payments").withIndex("by_org_paidAt", (q) => q.eq("orgId", orgId).gte("paidAt", start).lt("paidAt", end)).take(5001),
      ctx.db.query("payments").withIndex("by_org_paidAt", (q) => q.eq("orgId", orgId).eq("paidAt", undefined)).take(1001),
    ]);
    if (currentPayments.length > 5000 || legacyPayments.length > 1000) throw new Error("This report period is too large. Choose a shorter period or migrate legacy payment dates.");
    const paidPayments = [...currentPayments, ...legacyPayments]
      .filter((p) => p.status === "paid")
      .filter((p) => {
        const at = p.paidAt ?? p._creationTime;
        return at >= start && at < end;
      });
    const paymentRevenue = paidPayments.reduce((s, p) => s + p.amountCents, 0);

    // Invoice methods are explicit. Stripe booking payments count as card;
    // manual/simulated booking rows do not record a method, so keep it unknown.
    // Invoices paid before the field existed also land in "unrecorded".
    const methodTotals = new Map<string, number>();
    for (const i of paidInvoices) {
      const key = i.paymentMethod ?? "unrecorded";
      methodTotals.set(key, (methodTotals.get(key) ?? 0) + i.amountCents);
    }
    for (const payment of paidPayments) {
      const key = payment.provider === "stripe" ? "card" : "unrecorded";
      methodTotals.set(key, (methodTotals.get(key) ?? 0) + payment.amountCents);
    }
    const expenses = await ctx.db
      .query("expenses")
      .withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", start).lt("date", end))
      .take(5001);
    if (expenses.length > 5000) throw new Error("This report period has more than 5,000 expenses. Choose a shorter period.");

    // The bank's view of the same period (openspec add-bank-sync-receipts,
    // finance/pnl-report). Cash in and out exclude transfers, card and loan
    // payments, removed and pending lines. Only deposits explicitly classified
    // as business income feed profit. Stripe payouts and already-recorded
    // payments stay cash movement so the original sale is counted once.
    const bankRows = await ctx.db
      .query("bankTransactions")
      .withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", calendarStart).lt("date", calendarEnd))
      .take(5001);
    if (bankRows.length > 5000) throw new Error("This period has more than 5,000 bank transactions. Choose a shorter report period.");
    const postedBankRows = bankRows.filter((t) => !t.removed && !t.pending);
    const usdBankRows = postedBankRows.filter((t) => t.currency.toUpperCase() === "USD");
    const directBankIncome = usdBankRows.filter((t) => t.direction === "in" && t.moneyInKind === "income");
    const bankIncomeCents = directBankIncome.reduce((sum, row) => sum + row.amountCents, 0);
    const supplementalRevenue = await ctx.db
      .query("revenueEntries")
      .withIndex("by_org_collected", (q) => q.eq("orgId", orgId).gte("collectedAt", start).lt("collectedAt", end))
      .take(5001);
    if (supplementalRevenue.length > 5000) throw new Error("This period has more than 5,000 package or membership collections. Choose a shorter report period.");
    const packageRevenueCents = supplementalRevenue
      .filter((entry) => entry.sourceType === "package")
      .reduce((sum, entry) => sum + entry.amountCents, 0);
    const membershipRevenueCents = supplementalRevenue
      .filter((entry) => entry.sourceType === "membership")
      .reduce((sum, entry) => sum + entry.amountCents, 0);
    const stripeEntries = await ctx.db
      .query("stripeLedgerEntries")
      .withIndex("by_org_occurred", (q) => q.eq("orgId", orgId).gte("occurredAt", start).lt("occurredAt", end))
      .take(5001);
    if (stripeEntries.length > 5000) throw new Error("This period has more than 5,000 Stripe entries. Choose a shorter report period.");
    const usdStripeEntries = stripeEntries.filter((entry) => entry.currency.toUpperCase() === "USD");
    const stripeGrossSalesCents = usdStripeEntries
      .filter((entry) => entry.grossCents > 0 && `${entry.type} ${entry.reportingCategory ?? ""}`.toLowerCase().match(/charge|payment/))
      .reduce((sum, entry) => sum + entry.grossCents, 0);
    const stripeFeesCents = Math.max(0, usdStripeEntries.reduce((sum, entry) => sum + entry.feeCents, 0));
    const stripeRefundsCents = usdStripeEntries
      .filter((entry) => {
        const label = `${entry.type} ${entry.reportingCategory ?? ""}`.toLowerCase();
        return /refund|reversal/.test(label) && !/dispute|chargeback/.test(label);
      })
      .reduce((sum, entry) => sum + Math.abs(Math.min(0, entry.grossCents)), 0);
    const stripeDisputesCents = usdStripeEntries
      .filter((entry) => `${entry.type} ${entry.reportingCategory ?? ""}`.toLowerCase().match(/dispute|chargeback/))
      .reduce((sum, entry) => sum + Math.abs(Math.min(0, entry.grossCents)), 0);
    const stripeClearingNetCents = usdStripeEntries.reduce((sum, entry) => sum + entry.netCents, 0);
    const stripeAdjustmentsCents = stripeClearingNetCents - stripeGrossSalesCents
      + stripeRefundsCents + stripeDisputesCents + stripeFeesCents;
    const stripePayouts = await ctx.db
      .query("stripePayouts")
      .withIndex("by_org_arrival", (q) => q.eq("orgId", orgId).gte("arrivalDate", calendarStart).lt("arrivalDate", calendarEnd))
      .take(5001);
    if (stripePayouts.length > 5000) throw new Error("This period has more than 5,000 Stripe payouts. Choose a shorter report period.");
    const stripePayoutsCents = stripePayouts
      .filter((payout) => payout.status === "paid" && payout.currency.toUpperCase() === "USD")
      .reduce((sum, payout) => sum + payout.amountCents, 0);
    const revenueCents = invoiceRevenue + paymentRevenue + bankIncomeCents
      + packageRevenueCents + membershipRevenueCents;
    if (bankIncomeCents > 0) methodTotals.set("bank_deposit", bankIncomeCents);
    const byIncomeCategory = new Map<string, number>();
    for (const row of directBankIncome) {
      const category = row.incomeCategory ?? "other_income";
      byIncomeCategory.set(category, (byIncomeCategory.get(category) ?? 0) + row.amountCents);
    }
    for (const entry of supplementalRevenue) {
      byIncomeCategory.set(entry.incomeCategory, (byIncomeCategory.get(entry.incomeCategory) ?? 0) + entry.amountCents);
    }
    const summary = plSummary(
      revenueCents,
      expenses.map((e) => ({ category: e.category, amountCents: e.amountCents })),
    );
    const taxTotals = new Map<string, number>();
    for (const expense of expenses) {
      const group = EXPENSE_TAX_GROUP.get(expense.category) ?? "Other expenses";
      taxTotals.set(group, (taxTotals.get(group) ?? 0) + expense.amountCents);
    }
    const monthlyRecurringCents = expenses.reduce(
      (s, e) => s + monthlyRunRateCents(e.amountCents, e.recurring),
      0,
    );

    const counted = usdBankRows.filter((t) => !t.excluded);
    const bankOutByCategory = new Map<string, number>();
    let bankInCents = 0;
    let bankOutCents = 0;
    for (const t of counted) {
      if (t.direction === "in") bankInCents += t.amountCents;
      else {
        bankOutCents += t.amountCents;
        const key = t.category ?? "uncategorized";
        bankOutByCategory.set(key, (bankOutByCategory.get(key) ?? 0) + t.amountCents);
      }
    }
    const cashInCents = usdBankRows.filter((t) => t.direction === "in").reduce((sum, t) => sum + t.amountCents, 0);
    const cashOutCents = usdBankRows.filter((t) => t.direction === "out").reduce((sum, t) => sum + t.amountCents, 0);
    const connections = await ctx.db.query("bankConnections").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const live = new Set(connections.filter((c) => c.status !== "revoked").map((c) => c._id));
    const accounts = await ctx.db.query("bankAccounts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    let cashOnHandCents = 0;
    let cardOwedCents = 0;
    let balanceAsOf: number | null = null;
    for (const a of accounts) {
      if (a.hidden || !live.has(a.connectionId) || a.currency.toUpperCase() !== "USD") continue;
      if (a.type === "depository") cashOnHandCents += a.currentCents ?? 0;
      if (a.type === "credit") cardOwedCents += a.currentCents ?? 0;
      balanceAsOf = balanceAsOf === null ? a.balanceAsOf : Math.min(balanceAsOf, a.balanceAsOf);
    }

    const [datedReceipts, uploadedReceipts] = await Promise.all([
      ctx.db.query("receipts").withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", calendarStart).lt("date", calendarEnd)).take(5001),
      ctx.db.query("receipts").withIndex("by_org_uploaded", (q) => q.eq("orgId", orgId).gte("uploadedAt", start).lt("uploadedAt", end)).take(5001),
    ]);
    if (datedReceipts.length > 5000 || uploadedReceipts.length > 5000) throw new Error("This period has more than 5,000 receipts. Choose a shorter report period.");
    const inPeriod = [
      ...datedReceipts,
      ...uploadedReceipts.filter((receipt) => receipt.date === undefined),
    ];

    return {
      ...summary,
      revenueFromPaymentsCents: paymentRevenue,
      revenueFromInvoicesCents: invoiceRevenue,
      revenueFromBankCents: bankIncomeCents,
      revenueFromPackagesCents: packageRevenueCents,
      revenueFromMembershipsCents: membershipRevenueCents,
      paymentsByMethod: [...methodTotals.entries()]
        .map(([method, amountCents]) => ({ method, amountCents }))
        .sort((a, b) => b.amountCents - a.amountCents),
      byIncomeCategory: [...byIncomeCategory.entries()]
        .map(([category, amountCents]) => ({ category, amountCents }))
        .sort((a, b) => b.amountCents - a.amountCents),
      byTaxCategory: [...taxTotals.entries()]
        .map(([taxCategory, amountCents]) => ({ taxCategory, amountCents }))
        .sort((a, b) => b.amountCents - a.amountCents),
      expenseCount: expenses.length,
      monthlyRecurringCents,
      stripe: {
        grossSalesCents: stripeGrossSalesCents,
        feesCents: stripeFeesCents,
        refundsCents: stripeRefundsCents,
        disputesCents: stripeDisputesCents,
        adjustmentsCents: stripeAdjustmentsCents,
        clearingNetCents: stripeClearingNetCents,
        payoutsCents: stripePayoutsCents,
        unmatchedPayouts: stripePayouts.filter((payout) => payout.reconciliationStatus !== "matched").length,
        foreignCurrencyEntries: stripeEntries.length - usdStripeEntries.length,
        foreignCurrencyPayouts: stripePayouts.filter((payout) => payout.currency.toUpperCase() !== "USD").length,
      },
      bank: {
        connected: live.size > 0,
        needsAttention: connections.filter((c) => c.status === "login_required" || c.status === "error" || c.status === "expiring").length,
        inCents: bankInCents,
        outCents: bankOutCents,
        netCents: bankInCents - bankOutCents,
        cashInCents,
        cashOutCents,
        cashNetCents: cashInCents - cashOutCents,
        outByCategory: [...bankOutByCategory.entries()]
          .map(([category, amountCents]) => ({ category, amountCents }))
          .sort((a, b) => b.amountCents - a.amountCents),
        cashOnHandCents,
        cardOwedCents,
        balanceAsOf,
        foreignCurrencyRows: postedBankRows.length - usdBankRows.length,
        foreignCurrencyAccounts: accounts.filter((a) => !a.hidden && live.has(a.connectionId) && a.currency.toUpperCase() !== "USD").length,
      },
      reconciliation: {
        unmatchedOutflows: counted.filter((t) => t.direction === "out" && !t.expenseId).length,
        unmatchedInflows: postedBankRows.filter((t) => t.direction === "in" && !t.moneyInKind).length,
        receiptsUnmatched: inPeriod.filter((r) => !r.expenseId && !r.bankTransactionId).length,
        receiptsToBook: inPeriod.filter((r) => r.status === "ready" && !r.expenseId).length,
        receiptsNeedingReview: inPeriod.filter((r) => r.status === "needs_review").length,
        expensesWithoutReceipt: expenses.filter(
          (e) => !e.receiptId && !e.receiptDocId && e.category !== "payroll" && e.category !== "adjustment",
        ).length,
      },
    };
  },
});
