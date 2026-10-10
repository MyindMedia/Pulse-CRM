# Design: late entries

## The entry

A late entry is an ordinary `journalEntries` row. It is created the way every entry is: `createEntry` as a draft, then `postDraft` (the helpers behind `ledger.addEntry` and `ledger.postEntry`), so lines are validated against the studio's chart and balanced by the one rule (`assertBalancedLines`). Nothing inserts directly.

| Field | Meaning |
|---|---|
| `entryDate` = `effectiveDate` | the day inside the old month (UTC midnight) |
| `lateEntry: true` | marks it late |
| `enteredAt` | real time a person entered it |
| `enteredBy` | that person |
| `reason` | required, default "Missed invoice/receipt" |
| `lateKind`, `counterparty` | expense, income or refund; vendor or customer |
| `receiptDocIds`, `receiptStatus` | the attached receipt, if any |
| `reversalOf` / `reversedBy`, `reversedAt` | the link between a late entry and the entry that cancels it |

## Lines (pure, `convex/lib/lateEntries.ts`)

Money out (expense, refund to a customer): debit the category, credit the source. Money in (income, refund from a vendor): debit the source, credit the category. A refund follows its category's type: a revenue account means money back to a customer, an expense account means money back from a vendor.

| Paid from | Money out | Money in |
|---|---|---|
| bank | Bank / Cash | Bank / Cash |
| cash | Bank / Cash (the studio chart has one cash account; the payment type says Cash) | Bank / Cash |
| card | Credit Card Payable (accrual: a liability until paid) | Credit Card Payable (refund to the card) |
| owner | Owner's Equity / Capital (owner paid personally) | Business Funds Held by Owner |
| unpaid | Accounts Payable | Accounts Receivable |

This is how the studio's own workbook already books each case, so cash basis and accrual behave exactly as the existing ledger does: only bank and cash move cash; a card or an unpaid item moves a liability or receivable and income, not cash. Income cannot land on a card.

## Rules

- The month has ended (`period.end <= start of the current month`), the day is inside it and not in the future.
- No opening-balance snapshot is dated after the day. The engine starts every balance from the latest snapshot at or before a period, and skips entries dated before it, so a change before a snapshot would never reach later months. Before the first snapshot that means before the books start ("A change before then belongs in the opening balances").
- Amount is whole cents, above zero, at most $100 million. The category is an active account of the right type; the source account exists in the chart.
- The owner confirms "You are changing a past month" (`confirmPastMonth: true`), after seeing net income and cash before and after (`lateEntryPreview`).
- A possible duplicate (posted, same amount, within a week on the same category account, or within three days sharing a word of the name) blocks until the owner confirms it is a different charge (`allowDuplicate`).

## Reported vs recomputed

`reportedStatements` is never written by any late-entry path. `lateEntryImpact` (pure, `convex/lib/statements.ts`) rebuilds the period without the late entries entered after the workbook import (`reported.importedAt`) and compares line by line. For each moved line: `lateEntryCents` (what the late entries did) and, when there is a reported figure, `varianceCents = recomputed - reported` and `otherCents = varianceCents - lateEntryCents` (what was there before). The split adds up to the cent by construction. A `late_entries` check (warn; pass when a reversal cancelled everything) carries the headline.

A late entry entered before the workbook was imported is part of what was reported and is not counted as a change.

## Roll-forward

Statements for a later month read every entry from the opening snapshot forward, so a late July entry is in August's opening cash and retained earnings automatically. August's own income statement does not move. August's `lateEntries` lists the July entry with `inPeriod: false` and shows the moved opening lines.

Re-importing a month that already has late entries keeps the existing opening balances, and re-importing identical reported figures keeps their original `importedAt`, so late entries stay counted as changes since reported. Re-deriving them from the reported close would absorb the late entry into the opening and hide it.

## Reversal

`reverseLateEntry` posts a reversing entry on the same date with every debit and credit swapped, `reversalOf` pointing at the original, and patches the original's `reversedBy`. Both stay posted and visible. The month returns to exactly its prior figures (a cash flow line that moved out and back keeps a 0.00 row). `voidEntry` refuses a late entry so it cannot be cancelled without a trail.

## Audit

Every add and reversal writes `financeAudit` (`ledger.late_entry.posted` / `ledger.late_entry.reversed`, actor, receipt, net income, cash and retained earnings before and after, the entry id and reason) and an `auditEvents` row. An agent approval also writes the existing `agentAuditLogs` and activity rows.

## Who

Studio owner, or an agency owner or admin acting as the studio (`lateEntryWriter`). The ledger's ordinary write rule (owner or manager) is kept for ordinary entries; changing a reported month is narrower. Reads (preview, suggestions) follow `insights.read`.

## Accounting agent

`lateEntryCandidates` (pure) runs only for a month that has ended. It suggests:

- a bank feed line (not pending, removed or excluded) with no posted entry on a cash account (or the card payable, for a card feed) of the same amount and direction within three days;
- a ready receipt no entry carries and no posted entry matches by amount within a week.

The category comes from the bank line's expense category when it names one account, or from the most similar earlier entry by vendor name; otherwise it is left for the owner. Paid-from is the bank (or card) for a bank line, card when a receipt shows a card. Money coming onto a card feed (a card payment or a vendor credit) is never suggested: it is not income and the agent cannot tell which. At most ten per month. Each is an `acct_late_entry` proposal with a `late_entry` payload, scope-checked (`ledger.suggest_late_entry`). Approval in the inbox calls `recordLateEntry`, the same function as the Books form, and requires the owner; an incomplete suggestion says to finish it in Books, where "Use" pre-fills the form and adding it marks the proposal executed. `insertProposal` only ever auto-applies an exact receipt link, so a late entry is never posted by the agent, even at `auto_trusted` (tested).

After a late entry changes a month that has reported statements, the ledger schedules `accountingAgent.scanOrg` for that month; the scan writes the note "Late entries: July 2026".

## Screens

- Books header: "Add missed item" when the period has ended and the viewer may. A side sheet (full height on a phone): type, date (inside the month), vendor or customer, amount, category (filtered by type), paid from or received into, memo, reason, receipt. Review shows the confirm step.
- Checks: "Late entries: changes since reported" group with the headline, before and after, each entry (with Reverse), and every moved line split into late and before. The statement-differences table and statement rows tag the late part.
- Summary: the late-entries card comes first.
- Journal: "late" marker; the expanded row says when, who and why, with Reverse.
- CSV: a Late column. Print: appendix "Changes since reported" after the six sections.
- `/preview/books` (development only) runs the same pure engine in memory; a receipt there is marked, not uploaded.
