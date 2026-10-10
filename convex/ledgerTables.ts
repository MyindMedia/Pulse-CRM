import { defineTable } from "convex/server";
import { v } from "convex/values";

/* Ledger tables: a double-entry general ledger per studio.
   openspec/changes/ledger-books-statements, contract in docs/LEDGER-API.md.

   Spread into the schema from schema.ts (`...ledgerTables`). Every row carries
   `orgId` and every index starts with it. Money is integer cents. Dates are
   UTC midnight (day resolution). None of these tables is mirrored to devices
   (lib/mirroredTables.ts); all are in ORG_TABLES (subaccountDeletion.ts) and
   kept by orgReset, because they are the studio's real books. */

export const accountTypeV = v.union(
  v.literal("asset"),
  v.literal("liability"),
  v.literal("equity"),
  v.literal("revenue"),
  v.literal("expense"),
);

export const accountSubtypeV = v.union(
  v.literal("current_asset"),
  v.literal("noncurrent_asset"),
  v.literal("current_liability"),
  v.literal("long_term_liability"),
  v.literal("owner_equity"),
  v.literal("owner_draw"),
  v.literal("retained_earnings"),
  v.literal("operating_revenue"),
  v.literal("other_income"),
  v.literal("operating_expense"),
  v.literal("other_expense"),
);

export const normalBalanceV = v.union(v.literal("debit"), v.literal("credit"));

export const paymentKindV = v.union(
  v.literal("bank_transfer"),
  v.literal("bank_charge"),
  v.literal("credit_card"),
  v.literal("owner_personal_funds"),
  v.literal("zelle"),
  v.literal("cashapp_or_cash"),
  v.literal("cash"),
  v.literal("apple_pay"),
  v.literal("non_cash_adjustment"),
  v.literal("other"),
);

/** Normalized kind plus what the books actually said. `card` is a label such
 *  as "Card C" or "Amex x1234" (never a full number). */
export const paymentTypeV = v.object({
  kind: paymentKindV,
  raw: v.optional(v.string()),
  card: v.optional(v.string()),
});

export const receiptStatusV = v.union(v.literal("yes"), v.literal("no"), v.literal("pending"));
export const entryStatusV = v.union(v.literal("posted"), v.literal("draft"), v.literal("void"));
export const entrySourceV = v.union(
  v.literal("import"),
  v.literal("manual"),
  v.literal("agent"),
  v.literal("bank"),
  v.literal("expense"),
);

export const lateKindV = v.union(v.literal("expense"), v.literal("income"), v.literal("refund"));
export const paidFromV = v.union(v.literal("bank"), v.literal("cash"), v.literal("card"), v.literal("owner"), v.literal("unpaid"));

export const entryLineV = v.object({
  accountId: v.id("ledgerAccounts"),
  debitCents: v.number(),
  creditCents: v.number(),
  memo: v.optional(v.string()),
});

export const reportedLineV = v.object({
  key: v.string(),
  label: v.string(),
  cents: v.number(),
  kind: v.union(v.literal("line"), v.literal("total")),
  section: v.string(),
  formula: v.optional(v.string()),
  cell: v.optional(v.string()),
});

export const importWarningV = v.object({
  code: v.string(),
  severity: v.union(v.literal("info"), v.literal("warn"), v.literal("error")),
  message: v.string(),
  sheet: v.optional(v.string()),
  row: v.optional(v.number()),
  cell: v.optional(v.string()),
  raw: v.optional(v.string()),
  normalized: v.optional(v.string()),
});

export const ledgerTables = {
  /** The chart of accounts. `key` is stable (imports and the agent match on
   *  it); `name` is the studio's own wording and can change. */
  ledgerAccounts: defineTable({
    orgId: v.string(),
    key: v.string(),
    name: v.string(),
    type: accountTypeV,
    subtype: accountSubtypeV,
    /** Statement line key, e.g. "expense.rent", "asset.cash". */
    statementLine: v.string(),
    sortOrder: v.number(),
    normalBalance: normalBalanceV,
    isCash: v.optional(v.boolean()),
    isClearing: v.optional(v.boolean()),
    cashFlowLine: v.optional(v.string()),
    cashFlowLineInflow: v.optional(v.string()),
    active: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_key", ["orgId", "key"]),

  /** One document per transaction. Lines must balance (lib/ledgerMath.ts
   *  assertBalancedLines); drafts and voids never touch a balance. */
  journalEntries: defineTable({
    orgId: v.string(),
    entryDate: v.number(),
    memo: v.string(),
    paymentType: v.optional(paymentTypeV),
    receiptStatus: receiptStatusV,
    status: entryStatusV,
    source: entrySourceV,
    importBatchId: v.optional(v.string()),
    /** Where it came from: "July Journal!A3:H4", "expense:<id>". */
    sourceRef: v.optional(v.string()),
    /** Content identity for idempotent imports (lib/ledgerMath entryContentHash). */
    contentHash: v.optional(v.string()),
    /** The month the books filed it under ("2026-07"), when imported. */
    bookPeriod: v.optional(v.string()),
    receiptDocIds: v.optional(v.array(v.id("receipts"))),
    expenseId: v.optional(v.id("expenses")),
    lines: v.array(entryLineV),
    /** Total debits (= total credits), denormalized for lists. */
    totalCents: v.number(),
    createdBy: v.string(),
    createdAt: v.number(),
    voidedAt: v.optional(v.number()),
    voidedBy: v.optional(v.string()),
    voidReason: v.optional(v.string()),
    /* Late entries (openspec/changes/late-entries): a missed invoice or
       receipt added to a month after it was reported, and the reversing
       entry that cancels one. Both stay posted and visible; nothing is
       deleted. `effectiveDate` equals `entryDate`; `enteredAt` is when a
       person really entered it. */
    lateEntry: v.optional(v.boolean()),
    enteredAt: v.optional(v.number()),
    effectiveDate: v.optional(v.number()),
    enteredBy: v.optional(v.string()),
    reason: v.optional(v.string()),
    lateKind: v.optional(lateKindV),
    counterparty: v.optional(v.string()),
    /** On a reversing entry: the late entry it cancels. */
    reversalOf: v.optional(v.id("journalEntries")),
    /** On a reversed late entry: the entry that cancels it. */
    reversedBy: v.optional(v.id("journalEntries")),
    reversedAt: v.optional(v.number()),
  })
    // by_org: subaccountDeletion.orgRows sweeps every ORG_TABLES table by it.
    .index("by_org", ["orgId"])
    .index("by_org_date", ["orgId", "entryDate"])
    .index("by_org_hash", ["orgId", "contentHash"])
    .index("by_org_source_ref", ["orgId", "sourceRef"])
    .index("by_org_batch", ["orgId", "importBatchId"])
    .index("by_org_book_period", ["orgId", "bookPeriod"])
    .index("by_org_expense", ["orgId", "expenseId"]),

  /** Balances at the start of `asOf`, each in its account's normal direction. */
  openingBalances: defineTable({
    orgId: v.string(),
    asOf: v.number(),
    lines: v.array(v.object({ accountId: v.id("ledgerAccounts"), cents: v.number() })),
    source: v.union(v.literal("implied_from_reported_close"), v.literal("manual"), v.literal("import")),
    note: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_asOf", ["orgId", "asOf"]),

  /** Exactly what the owner's books said, kept so the report can show the
   *  difference rather than overwrite it. One row per period and source. */
  reportedStatements: defineTable({
    orgId: v.string(),
    periodStart: v.number(),
    periodEnd: v.number(),
    entityName: v.string(),
    balanceSheet: v.array(reportedLineV),
    incomeStatement: v.array(reportedLineV),
    cashFlow: v.array(reportedLineV),
    /** Every normalization and anomaly the importer found, journal and statements. */
    warnings: v.array(importWarningV),
    source: v.literal("workbook"),
    importBatchId: v.string(),
    importedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_period", ["orgId", "periodStart"]),

  /** Bank statement summary for a period, for the cash reconciliation. */
  bankStatementBalances: defineTable({
    orgId: v.string(),
    /** Last four digits or a name. Never a full account number. */
    accountLabel: v.string(),
    ledgerAccountId: v.optional(v.id("ledgerAccounts")),
    periodStart: v.number(),
    periodEnd: v.number(),
    beginningCents: v.number(),
    endingCents: v.number(),
    depositsCents: v.number(),
    withdrawalsCents: v.number(),
    feesCents: v.number(),
    source: v.union(v.literal("statement_pdf"), v.literal("manual"), v.literal("plaid"), v.literal("import")),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_period", ["orgId", "periodStart"]),
};
