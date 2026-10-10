# Ledger API (phase A contract)

The double-entry ledger behind the owner's financial report. Phase B (the branded report UI) and phase C (the accounting agent) build on this contract. Spec: `openspec/changes/ledger-books-statements/`.

## Rules every caller can rely on

- **Money is integer cents.** Every `*Cents` field, every line, every total. Format at the edge.
- **Dates are UTC midnight milliseconds** (day resolution). `entryDate` is snapped with `toDay` on write.
- **A period is a calendar month** `"YYYY-MM"`, covering `[start, end)` in UTC.
- **Entries always balance.** `assertBalancedLines` (convex/lib/ledgerMath.ts) runs on every write: at least two lines, whole non-negative cents, each line a debit or a credit, debits equal credits.
- **Drafts and voids never touch a balance.** Only `status: "posted"` counts.
- **Nothing is plugged.** The balance sheet's A = L + E check uses account balances. Retained earnings is a derived line. When the books do not balance, the check fails and says by how much.
- **Reported is kept apart from recomputed.** What the owner's workbook said is stored as-is (`reportedStatements`); the ledger's numbers are recomputed on every read; `variances` is the difference.

## Access

| Caller | Read (`insights.read`) | Write |
|---|---|---|
| Studio owner | yes | yes |
| Studio manager | yes, unless the owner set "managers can see money" off | yes, same condition |
| Accountant | yes | no |
| Engineer, assistant, producer, intern, artist relations | no | no |
| Agency owner or admin acting as the studio (within scope) | yes | yes |
| Agency staff, billing, guests | no | no |

Late entries (changing a month that has ended) are narrower: the studio owner, or an agency owner or admin acting as the studio. See "Late entries".

The org always comes from the signed-in viewer, never from arguments. A denial is an `AccessError` (`CAPABILITY_DENIED`, `SCOPE_DENIED`, `NO_WORKSPACE`, `BILLING_LOCKED`) with a readable message.

## Queries

### `ledger.periods({})`
Months that have books, newest first: `{ period: "2026-07", hasReported, hasBank, hasEntries }[]`.

### `ledger.statements({ period })`
The report's single source. Returns:

```ts
{
  period: { key, start, end },
  entityName: string | null,            // from the workbook
  opening: { asOf, source, note } | null,
  reported: {                            // null when no workbook was imported
    entityName, periodStart, periodEnd, importBatchId, importedAt,
    balanceSheet: ReportedLine[], incomeStatement: ReportedLine[], cashFlow: ReportedLine[],
    warnings: ImportWarning[],           // every normalization and anomaly, with sheet and row
  } | null,
  recomputed: {
    incomeStatement: { revenue, expenses, totalRevenueCents, totalExpensesCents, netIncomeCents, lines },
    balanceSheet: {
      currentAssets, noncurrentAssets, currentLiabilities, longTermLiabilities, equity,
      totalAssetsCents, totalLiabilitiesCents, totalEquityCents, totalLiabilitiesAndEquityCents,
      retainedEarnings: { openingCents, priorUnclosedIncomeCents, currentPeriodNetIncomeCents, totalCents },
      balanced, differenceCents, lines,
    },
    cashFlow: {
      operating, investing, financing, unclassified,
      netOperatingCents, netInvestingCents, netFinancingCents, netUnclassifiedCents, netChangeCents,
      beginningCashCents, endingCashCents, ledgerCashChangeCents, lines,
    },
  },
  variances: { incomeStatement: Variance[], balanceSheet: Variance[], cashFlow: Variance[] } | null,
  checks: Check[],
  journalTotals: { entryCount, debitCents, creditCents },
  lateEntries: LateEntryImpact | null,     // see "Late entries" below; null when none touch the month
}
```

- `StatementLine`: `{ key, label, cents, kind: "line" | "total", section, accountIds?, derived? }`. `lines` is the flat reading order with totals in place.
- `ReportedLine`: `{ key, label, cents, kind, section, formula?, cell? }`. `formula` is present when the owner's cell was computed (`"=SUM(E14:E25)"`).
- `Variance`: `{ statement, key, label, kind, reportedCents, recomputedCents, varianceCents, reportedMissing?, recomputedMissing? }`, `varianceCents = recomputed - reported`, nonzero only. A subtotal the owner never reported is not a variance.
- `Check`: `{ code, status: "pass" | "warn" | "fail", message, amountCents?, detail? }`.

Line keys are shared by reported and recomputed lines, so the UI can lay them side by side:

- Income statement: `revenue.recording_session`, `revenue.podcast_studio`, `revenue.other_audio_services`, `revenue.consultation`, `revenue.other_income`, `expense.rent`, `expense.credit_card_interest_fees`, `expense.advertising_promotion`, `expense.insurance`, `expense.internet`, `expense.merchant_processing`, `expense.software_subscriptions`, `expense.bank_service_charges`; totals `total_revenue`, `total_expenses`, `net_income`.
- Balance sheet: `asset.*`, `liability.*`, `equity.owner_contributions`, `equity.owner_draws`, `equity.retained_earnings`; totals `total_current_assets`, `total_noncurrent_assets`, `total_assets`, `total_liabilities`, `total_equity`, `total_liabilities_and_equity`.
- Cash flow: `operating.customer_receipts`, `operating.rent`, `operating.processing_fees`, `operating.professional_services`, `operating.insurance`, `operating.internet`, `operating.advertising`, `operating.software`, `operating.interest_and_card_fees`, `operating.bank_fees`, `operating.prepaid_services`, `investing.equipment`, `investing.security_deposit`, `financing.owner_contributions`, `financing.partner_deposits`, `financing.owner_held_funds`, `financing.owner_reimbursement`, `financing.owner_draws`, `financing.credit_card_payments`, `financing.installment_payments`; totals `net_operating`, `net_investing`, `net_financing`, `net_change`, `beginning_cash`, `ending_cash`. A key starting `unclassified.` means an account with no cash flow line (the `unclassified_accounts` check fails).

Check codes:

| Code | Fails or warns when |
|---|---|
| `balanced_entries` | a posted entry does not balance (fail) |
| `opening_balanced` | opening balances do not balance (fail) or are missing (warn) |
| `balance_sheet_balances` | assets differ from liabilities plus equity (fail) |
| `cash_flow_ties` | cash flow net change differs from the ledger's cash change (fail) |
| `cash_vs_bank` | cash per ledger differs from a bank statement balance (fail; `detail` is a `BankReconciliationRow`), or no bank balance exists (warn) |
| `unclassified_accounts` | an account used this period has no statement or cash flow line (fail) |
| `receipts_missing` | posted entries marked `receiptStatus: "no"` (warn) |
| `clearing_not_cleared` | deposits in transit or funds held by the owner still hold money at period end (warn) |
| `negative_cash` | cash per ledger is negative at the end of a day (warn) |
| `entries_outside_period` | an entry is dated outside the month its books filed it under (warn) |
| `duplicate_entries` | entries share date, amount and memo (warn) |
| `reported_statement_warnings` | the importer flagged the owner's statements: beginning cash label date, retained earnings plug, typed-in values, heading dates (warn) |
| `reported_vs_recomputed` | reported lines differ from the ledger (warn; `detail` lists the line variances) |
| `late_entries` | late entries changed the month after the workbook was imported (warn; pass when a reversal cancelled them; `message` is the headline, `amountCents` the net income change) |

### `ledger.journal({ period?, filter?, paginationOpts })`
Entries newest first, Convex pagination. `filter`: `{ accountId?, paymentKind?, receiptStatus?, status?, text?, lateOnly? }` (`lateOnly` keeps late entries and their reversals) (`text` matches the memo, line memos and the raw payment type, case-insensitive). Each item is a `journalEntries` document: `{ _id, entryDate, memo, paymentType?: { kind, raw?, card? }, receiptStatus, status, source, importBatchId?, sourceRef?, contentHash?, bookPeriod?, receiptDocIds?, expenseId?, lines: { accountId, debitCents, creditCents, memo? }[], totalCents, createdBy, createdAt, voidedAt?, voidedBy?, voidReason?, lateEntry?, enteredAt?, effectiveDate?, enteredBy?, reason?, lateKind?, counterparty?, reversalOf?, reversedBy?, reversedAt? }`.

### `ledger.accounts({ includeInactive? })`
The chart in statement order: `{ _id, key, name, type, subtype, statementLine, sortOrder, normalBalance, isCash, isClearing, cashFlowLine, cashFlowLineInflow, active }[]`. `key` is stable; `name` is the studio's own wording.

### `ledger.bankReconciliation({ period })`
`{ period, rows: BankReconciliationRow[] }`, one row per bank statement balance:
`{ accountLabel, ledgerAccountIds, bankBeginningCents, bankEndingCents, bankNetChangeCents, bankArithmeticDiffCents, ledgerBeginningCents, ledgerEndingCents, ledgerNetChangeCents, beginningVarianceCents, endingVarianceCents, netChangeVarianceCents, unclearedClearing: { accountId, name, cents }[], unclearedClearingTotalCents, unexplainedCents }`. Variances are ledger minus bank. `unexplainedCents` is the ending variance not covered by uncleared clearing balances.

## Mutations (owner or manager)

| Function | Args | Returns | Notes |
|---|---|---|---|
| `ledger.addEntry` | `{ entryDate, memo, lines: { accountId, debitCents, creditCents, memo? }[], status: "draft" \| "posted", paymentType?, receiptStatus?, source?: "manual" \| "agent" }` | entry id | Lines validated against this studio's active accounts. |
| `ledger.postEntry` | `{ id }` | null | Draft to posted, revalidated. |
| `ledger.voidEntry` | `{ id, reason }` | null | Keeps the entry, out of every balance. Refuses a late entry: reverse it instead. |
| `ledger.linkReceipt` | `{ entryId, receiptId }` | `{ receiptDocIds }` | Receipt must be this studio's `receipts` row; sets `receiptStatus: "yes"`. |
| `ledger.seedChart` | `{}` | `{ created }` | Creates missing default studio accounts by key; never renames. |
| `ledger.postFromExpense` | `{ expenseId, debitAccountId?, creditAccountId?, status? }` | `{ entryId, created }` | Explicit and idempotent (`sourceRef: "expense:<id>"`). Debit defaults by category (rent, software, subscriptions, marketing, insurance, fees); other categories need `debitAccountId`. Credit defaults to the card payable when the expense's bank line is a credit account, else Bank / Cash. |
| `ledger.importBooks` | `{ plan, bank?, seedOpening?: "implied" \| "none" }` | import summary | `plan` is `planToImportArgs(parseBooksWorkbook(...))`. |

Internal: `ledger.importBooksInternal({ orgId, plan, bank?, seedOpening? })`, called by `scripts/import-books.mjs --apply` with the deploy key.

### Import behaviour

- Accounts: created by key when missing; existing accounts are left alone.
- Entries: skipped when an entry with the same `contentHash` exists for the studio (re-import is a no-op; a voided entry is not resurrected).
- Reported statements: replaced for the period. When the figures are identical to what is stored (a re-run), the original `importedAt` is kept, so late entries entered since still count as changes since reported.
- Bank balances: replaced per `accountLabel` and period. Labels with a run of five or more digits are refused.
- Opening balances with `seedOpening: "implied"`: created at the period start from the reported closing balance sheet minus the period's activity, cash anchored to the bank's beginning balance, clearing accounts never negative, opening retained earnings as the balancing figure (`source: "implied_from_reported_close"`, with the reasoning in `note`). An earlier or manual opening is kept, never overwritten.
- Summary: `{ importBatchId, period, accountsCreated, entriesCreated, entriesSkipped, bankUpserted, opening: "created" | "replaced" | "kept" | "skipped", warnings }`.

## Late entries

A missed invoice or receipt added to a month that has ended. Spec: `openspec/changes/late-entries/`. Pure rules in `convex/lib/lateEntries.ts`, the variance split in `lateEntryImpact` (`convex/lib/statements.ts`).

- **Who:** the studio owner, or an agency owner or admin acting as the studio. Managers keep ordinary writes but cannot change a past month. Reads follow `insights.read`.
- **What it writes:** a balanced entry dated inside the month, through `createEntry` (draft) then `postDraft`, the helpers behind `addEntry` and `postEntry`. Flagged `lateEntry: true` with `enteredAt` (real time), `effectiveDate` (= `entryDate`), `enteredBy`, `reason` (default "Missed invoice/receipt"), `lateKind`, `counterparty`. Never touches `reportedStatements`.
- **Lines:** money out (expense, refund to a customer: category is revenue) debits the category and credits the source; money in (income, refund from a vendor: category is expense) the reverse. Source by `paidFrom`: `bank` and `cash` Bank / Cash, `card` Credit Card Payable, `owner` Owner's Equity / Capital out or Business Funds Held by Owner in, `unpaid` Accounts Payable or Accounts Receivable. Income never lands on a card.
- **Rules:** the month has ended; the day is inside it and not in the future; no opening-balance snapshot is dated after the day (a change before a snapshot would not carry forward; before the first one it is before the books start); whole cents above zero, at most $100 million; category of the right type, active, in this chart; `confirmPastMonth: true`; a possible duplicate (posted, same amount, same week on the same category, or within three days sharing a name word) needs `allowDuplicate: true`, else `ConvexError { code: "POSSIBLE_DUPLICATE" }`.
- **Reversal:** a linked reversing entry on the same date, lines swapped (`reversalOf` on it, `reversedBy` and `reversedAt` on the original). Both stay posted.
- **Audit:** `financeAudit` (`ledger.late_entry.posted` / `ledger.late_entry.reversed`, actor, receipt, before and after `{ revenueCents, expensesCents, netIncomeCents, endingCashCents, retainedEarningsCents }`, entry id and reason in `detail`) and `auditEvents` (same action, `resource` = entry id).
- **Roll-forward:** later months read every entry from the opening snapshot forward, so their opening cash and retained earnings move by exactly the amount. Re-importing a month with late entries keeps its opening balances (`opening: "kept"`).
- **Rescan:** after a change to a month with reported statements the ledger schedules `accountingAgent.scanOrg` for it, which writes the "Late entries: <month>" note.

| Function | Args | Returns |
|---|---|---|
| `ledger.addLateEntry` | `{ period, input: { kind: "expense" \| "income" \| "refund", entryDate, counterparty, amountCents, accountId, paidFrom: "bank" \| "cash" \| "card" \| "owner" \| "unpaid", memo?, reason? }, receiptId?, confirmPastMonth, allowDuplicate?, proposalId? }` | `{ entryId, before, after }` (headline figures) |
| `ledger.reverseLateEntry` | `{ id, reason, confirmPastMonth }` | `{ entryId, before, after }` |
| `ledger.lateEntryPreview` (query) | `{ period, input }` | `{ ok: true, memo, reason, totalCents, lines: { accountName, debitCents, creditCents }[], before, after, hasReported, duplicates }` or `{ ok: false, error }` |
| `ledger.lateReversalPreview` (query) | `{ id }` | `{ ok: true, period, memo, totalCents, before, after }` or `{ ok: false, error }` |
| `ledger.lateEntryAccess` (query) | `{}` | `{ canAdd, currentMonth, today }` |
| `ledger.lateEntrySuggestions` (query) | `{ period }` | open `acct_late_entry` proposals for the month |

`receiptId` is a `receipts` row made by `receipts.attach` from an R2 upload (`media.prepareUpload` presigned PUT, `media.confirmUpload`); Convex stores the key and metadata only. `proposalId` completes an Accounting agent suggestion (marked executed).

`statements.lateEntries` (`LateEntryImpact`):

```ts
{
  since: number | null,                 // reported.importedAt; late entries entered after it count
  count, headline,
  before: HeadlineFigures, after: HeadlineFigures,   // the month without and with them
  entries: { id, entryDate, enteredAt, enteredBy, reason, memo, totalCents, kind?, counterparty?, reversalOf?, reversedBy?,
             inPeriod, netIncomeEffectCents, cashEffectCents }[],
  lines: { statement, key, label, kind, reportedCents | null, recomputedCents, lateEntryCents,
           varianceCents | null, otherCents | null }[],   // varianceCents = lateEntryCents + otherCents, exactly
}
```

## CLI

```bash
node scripts/import-books.mjs "<books.xlsx>" --org <orgId> --period 2026-07 --bank-json <bank.json> --dry-run
CONVEX_URL=... CONVEX_DEPLOY_KEY=... node scripts/import-books.mjs "<books.xlsx>" --org <orgId> --period 2026-07 --bank-json <bank.json> --apply
```

`--dry-run` prints counts, warnings by code and row, the reported vs recomputed table for all three statements, the checks and the bank reconciliation. `--apply` refuses to run when any warning is an error. Never commit a real workbook or bank JSON.

## For the accounting agent (phase C)

- Read with `statements`, `journal` and `bankReconciliation`; propose with `addEntry` using `status: "draft"` and `source: "agent"`; a person posts with `postEntry`.
- Built: `convex/accountingAgent.ts` and `convex/agents/accounting.ts`, spec `openspec/changes/accounting-agent/`. It writes through `createEntry` (drafts, `source: "agent"`, `sourceRef: "agent:<key>"`) and a person's approval posts through `postDraft`; `attachReceipt` backs `linkReceipt`. No other module reads these tables.
- Late entries: for a month that has ended the agent proposes `acct_late_entry` (payload `late_entry`, capability `ledger.suggest_late_entry`) for an unmatched bank line or receipt. Approval posts through `recordLateEntry`, owner only. Never automatic.
- Never fix a variance by editing reported statements. Post a correcting entry (draft) that explains the difference, and let the checks go green.
