## Why

The books for a month get checked and reported, then a receipt or an invoice turns up that nobody entered. Today the owner has two bad options: leave the month wrong, or quietly change it so the numbers no longer match what was reported. Neither leaves a trail, and an edit to an old month does not obviously carry into the months after it.

The owner asked for a way to add a missed invoice or receipt to an old month so the books for that month update correctly, with a clear audit trail.

## What Changes

- **Late entries.** An owner can add a missed expense, income or refund to a month that has ended, from Reports > Books ("Add missed item"). It becomes an ordinary balanced journal entry dated inside that month, flagged `lateEntry` with when it was really entered (`enteredAt`), its `effectiveDate`, who entered it (`enteredBy`) and why (`reason`, default "Missed invoice/receipt"). A receipt or invoice can be attached; the bytes go to Cloudflare R2 through the existing presigned upload and `receipts.attach`, never Convex storage.
- **Reported stays reported.** The workbook figures the owner checked are never changed. The recomputed statements include the late entry, and the variance panel splits every moved line into "late entries" and "what was there before", with a one-sentence headline ("Recomputed net income differs from reported by $38.00: $19.00 from 1 late entry added Oct 9, $19.00 was there when the books were checked").
- **Later months roll forward.** A late July entry moves August's opening cash and retained earnings by exactly its amount, cash basis or accrual exactly as the ledger already books it (bank and cash move cash, a card is a payable, unpaid is a payable or receivable).
- **Safety.** No deletes: a mistaken late entry is cancelled by a linked reversing entry on the same date, both visible. There is no close or lock flag in the ledger, so none is invented; instead every late entry and reversal goes through a "You are changing a past month" confirm with net income and cash before and after. A possible duplicate (same amount, same week, same category or name) must be confirmed as a different charge. Every change writes `financeAudit` (before and after figures) and `auditEvents`.
- **Accounting agent.** For a month that has ended, the agent suggests a late entry for an unmatched bank line or a receipt no entry carries, as a pre-filled `acct_late_entry` proposal. Approving it runs the same path as the Books form. It never posts one by itself, at any autonomy level. When late entries change a reported month the agent notes it ("July 2026 net income moved from -$1,127.80 to -$1,146.80 after 1 late entry").
- **Journal, CSV, print.** Late entries carry a "late" marker in the journal and a Late column in the CSV, and the printed book ends with an appendix "Changes since reported".

## Capabilities

### New Capabilities
- `books/late-entries`: adding, reviewing and reversing late entries, how they show in the statements and variances, roll-forward, audit, and the agent's suggestions.

### Modified Capabilities
- `agents/accounting`: a ninth proposal kind, `acct_late_entry`, behind the new capability `ledger.suggest_late_entry`; a late-entries note.

## Impact

- Schema: optional late-entry fields on `journalEntries` (`lateEntry`, `enteredAt`, `effectiveDate`, `enteredBy`, `reason`, `lateKind`, `counterparty`, `reversalOf`, `reversedBy`, `reversedAt`); `opsActions.type` gains `acct_late_entry` and the payload union gains `late_entry`. All optional: existing rows are valid unchanged.
- Ledger API: `addLateEntry`, `reverseLateEntry`, `lateEntryPreview`, `lateReversalPreview`, `lateEntryAccess`, `lateEntrySuggestions`; `statements` returns `lateEntries`; the `journal` filter takes `lateOnly`; `voidEntry` refuses a late entry. Contract in `docs/LEDGER-API.md`.
- Access: changing a past month is the studio owner's (or an agency owner or admin acting as the studio). A manager keeps ordinary writes but cannot add or reverse a late entry, or approve the agent's late-entry suggestion.
- Import: re-importing a month that has late entries keeps the existing opening balances instead of re-deriving them, so the change is not absorbed into the opening.

## Non-goals

- A month-close or period-lock workflow.
- Editing or deleting posted entries.
- Changing the reported (workbook) statements.
- Multi-line or split late entries (one category, one source).
