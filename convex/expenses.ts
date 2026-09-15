import { query } from "./_generated/server";
import { mutation } from "./functions";
import { v } from "convex/values";
import { currentActor, currentOrgWithCapability } from "./lib/tenant";
import { financeLog } from "./lib/financeLinks";
import { plSummary, monthlyRunRateCents } from "./lib/pnl";

/* ============================================================
   Expenses - the money-OUT half of the books. Manual entry of
   rent, utilities, subscriptions, gear, repairs, contractor /
   engineer payouts, etc., plus a P&L roll-up (collected revenue
   minus expenses) so a studio finally sees true profit.

   Capability gates mirror the rest of finance: writes need
   invoices.send (owner/manager/accountant), reads need
   insights.read (the finance/analytics tier).
   ============================================================ */

const categoryV = v.union(
  v.literal("rent"),
  v.literal("utilities"),
  v.literal("software"),
  v.literal("gear"),
  v.literal("repairs"),
  v.literal("payroll"),
  v.literal("contractor"),
  v.literal("marketing"),
  v.literal("supplies"),
  v.literal("insurance"),
  v.literal("travel"),
  v.literal("fees"),
  v.literal("adjustment"),
  v.literal("other"),
);
const recurringV = v.union(v.literal("monthly"), v.literal("annual"));

export const create = mutation({
  args: {
    category: categoryV,
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
    category: v.optional(categoryV),
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
 *  receipt URL. */
export const list = query({
  args: {
    start: v.optional(v.number()),
    end: v.optional(v.number()),
    category: v.optional(categoryV),
  },
  handler: async (ctx, { start, end, category }) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    let rows = await ctx.db
      .query("expenses")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    if (start !== undefined) rows = rows.filter((r) => r.date >= start);
    if (end !== undefined) rows = rows.filter((r) => r.date < end);
    if (category) rows = rows.filter((r) => r.category === category);
    rows.sort((a, b) => b.date - a.date);
    return await Promise.all(
      rows.map(async (r) => ({
        ...r,
        memberName: r.memberId ? (await ctx.db.get(r.memberId))?.name ?? null : null,
        receiptUrl: r.receiptId ? await ctx.storage.getUrl(r.receiptId) : null,
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
  },
  returns: v.object({
    revenueCents: v.number(), expensesCents: v.number(), netCents: v.number(), marginPct: v.number(),
    byCategory: v.array(v.object({ category: v.string(), amountCents: v.number() })),
    revenueFromPaymentsCents: v.number(), revenueFromInvoicesCents: v.number(),
    paymentsByMethod: v.array(v.object({ method: v.string(), amountCents: v.number() })),
    expenseCount: v.number(), monthlyRecurringCents: v.number(),
    bank: v.object({
      connected: v.boolean(), needsAttention: v.number(), inCents: v.number(), outCents: v.number(), netCents: v.number(),
      outByCategory: v.array(v.object({ category: v.string(), amountCents: v.number() })),
      cashOnHandCents: v.number(), cardOwedCents: v.number(), balanceAsOf: v.union(v.number(), v.null()),
    }),
    reconciliation: v.object({
      unmatchedOutflows: v.number(), receiptsUnmatched: v.number(), receiptsToBook: v.number(),
      receiptsNeedingReview: v.number(), expensesWithoutReceipt: v.number(),
    }),
  }),
  handler: async (ctx, { start, end, bankStart, bankEnd }) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    // Callers may supply UTC calendar bounds for date-only bank/receipt rows.
    // Legacy callers retain the original range; collected-at timestamps keep
    // their local-time boundaries so late-night payments stay in the right month.
    const calendarStart = bankStart ?? start;
    const calendarEnd = bankEnd ?? end;
    if (![start, end, calendarStart, calendarEnd].every(Number.isFinite) || start >= end || calendarStart >= calendarEnd) {
      throw new Error("Choose a valid report period.");
    }

    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const paidInvoices = invoices.filter(
      (i) => i.status === "paid" && i.paidAt && i.paidAt >= start && i.paidAt < end,
    );
    const invoiceRevenue = paidInvoices.reduce((s, i) => s + i.amountCents, 0);

    const payments = await ctx.db
      .query("payments")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const paidPayments = payments
      .filter((p) => p.status === "paid")
      .filter((p) => {
        const at = p.paidAt ?? p._creationTime;
        return at >= start && at < end;
      });
    const paymentRevenue = paidPayments.reduce((s, p) => s + p.amountCents, 0);

    const revenueCents = invoiceRevenue + paymentRevenue;

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
    const paymentsByMethod = [...methodTotals.entries()]
      .map(([method, amountCents]) => ({ method, amountCents }))
      .sort((a, b) => b.amountCents - a.amountCents);

    const expenses = await ctx.db
      .query("expenses")
      .withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", start).lt("date", end))
      .collect();

    const summary = plSummary(
      revenueCents,
      expenses.map((e) => ({ category: e.category, amountCents: e.amountCents })),
    );

    const monthlyRecurringCents = expenses.reduce(
      (s, e) => s + monthlyRunRateCents(e.amountCents, e.recurring),
      0,
    );

    // The bank's view of the same period (openspec add-bank-sync-receipts,
    // finance/pnl-report). Cash in and out exclude transfers, card and loan
    // payments, removed and pending lines. It never feeds profit: expenses
    // added from the bank are already in `expenses`, so profit stays
    // collected revenue minus expenses and nothing counts twice.
    const bankRows = await ctx.db
      .query("bankTransactions")
      .withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", calendarStart).lt("date", calendarEnd))
      .collect();
    const counted = bankRows.filter((t) => !t.removed && !t.excluded && !t.pending);
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
    const connections = await ctx.db.query("bankConnections").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const live = new Set(connections.filter((c) => c.status !== "revoked").map((c) => c._id));
    const accounts = await ctx.db.query("bankAccounts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    let cashOnHandCents = 0;
    let cardOwedCents = 0;
    let balanceAsOf: number | null = null;
    for (const a of accounts) {
      if (a.hidden || !live.has(a.connectionId)) continue;
      if (a.type === "depository") cashOnHandCents += a.currentCents ?? 0;
      if (a.type === "credit") cardOwedCents += a.currentCents ?? 0;
      balanceAsOf = balanceAsOf === null ? a.balanceAsOf : Math.min(balanceAsOf, a.balanceAsOf);
    }

    const receipts = await ctx.db.query("receipts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const inPeriod = receipts.filter((r) => {
      if (r.date !== undefined) return r.date >= calendarStart && r.date < calendarEnd;
      return r.uploadedAt >= start && r.uploadedAt < end;
    });

    return {
      ...summary,
      revenueFromPaymentsCents: paymentRevenue,
      revenueFromInvoicesCents: invoiceRevenue,
      paymentsByMethod,
      expenseCount: expenses.length,
      monthlyRecurringCents,
      bank: {
        connected: live.size > 0,
        needsAttention: connections.filter((c) => c.status === "login_required" || c.status === "error" || c.status === "expiring").length,
        inCents: bankInCents,
        outCents: bankOutCents,
        netCents: bankInCents - bankOutCents,
        outByCategory: [...bankOutByCategory.entries()]
          .map(([category, amountCents]) => ({ category, amountCents }))
          .sort((a, b) => b.amountCents - a.amountCents),
        cashOnHandCents,
        cardOwedCents,
        balanceAsOf,
      },
      reconciliation: {
        unmatchedOutflows: counted.filter((t) => t.direction === "out" && !t.expenseId).length,
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
