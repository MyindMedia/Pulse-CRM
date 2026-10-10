# Implementation tasks

- [x] Spec: proposal, design, tasks, `specs/books/late-entries/spec.md`.
- [x] Engine: `LedgerEntry.late`, `lateEntryImpact`, `recomputeStatements`, `headlineFigures`, `late_entries` check (`convex/lib/statements.ts`).
- [x] Pure late-entry rules: lines per kind and paid-from, date rules, duplicates, preview, reversal lines (`convex/lib/lateEntries.ts`).
- [x] Schema: late fields on `journalEntries`; `acct_late_entry` and the `late_entry` payload on `opsActions`.
- [x] Ledger API: `addLateEntry`, `reverseLateEntry`, `lateEntryPreview`, `lateReversalPreview`, `lateEntryAccess`, `lateEntrySuggestions`; `statements.lateEntries`; `journal` `lateOnly`; `voidEntry` refuses late; import keeps opening when late entries exist.
- [x] Audit: `financeAudit` and `auditEvents` on every add and reversal.
- [x] Accounting agent: `lateEntryCandidates`, `lateEntryInsight`, bank feed and receipts in the signals, approval through `recordLateEntry`, never automatic; scope and inbox label.
- [x] Books UI: Add missed item sheet with confirm, reverse sheet, Checks group, statement and difference tags, summary card, journal marker, CSV column, print appendix; live (R2 receipt upload) and preview wiring.
- [x] Tests: pure math and rules (`convex/lib/lateEntries.test.ts`), end to end on the July fixture (`convex/ledgerLateEntries.test.ts`), agent generators, scope source tests, Books components.
- [x] Playwright on `/preview/books`: Chromium, WebKit, Firefox, desktop and 390px.
- [ ] Deploy: Convex first, then Netlify.
- [ ] Owner decision: managers excluded from late entries (owner, agency owner or admin only). Confirm.
