# Implementation tasks (phase A)

- [x] Spec: proposal, design, tasks.
- [x] Schema: `ledgerAccounts`, `journalEntries`, `openingBalances`, `reportedStatements`, `bankStatementBalances` in convex/ledgerTables.ts, spread into convex/schema.ts; listed in `ORG_TABLES` and kept by `orgReset`; not mirrored.
- [x] Engine: convex/lib/ledgerMath.ts (cents, periods, balanced-entry validator, content hash, trial balance, balances) and convex/lib/statements.ts (income statement, balance sheet, cash flow, checks, variances, implied opening balances).
- [x] Import: convex/lib/booksImport.ts (grid parser, normalization with row-numbered warnings, default studio chart, reported statements with formula cross-check, idempotent hashes).
- [x] CLI: scripts/import-books.mjs (`--dry-run` prints counts, warnings and the reported vs recomputed table; `--apply` calls the internal import mutation with the deploy key).
- [x] API: convex/ledger.ts (`periods`, `statements`, `journal`, `accounts`, `addEntry`, `voidEntry`, `linkReceipt`, `bankReconciliation`, `postFromExpense`, internal `importBooks`).
- [x] Contract documented in docs/LEDGER-API.md.
- [x] Tests: engine unit tests with the July numbers, end-to-end import from a generated anonymized fixture, access tests, idempotent re-import.
- [x] `npx tsc --noEmit`, eslint on changed files, `npx vitest run`.
- [ ] Owner decisions: how to book the 630.00 cash variance, and the real June 30 opening balance sheet.
- [ ] Phase B: branded report UI on `ledger.statements`.
- [ ] Phase C: accounting agent on `ledger.journal`, `ledger.addEntry` (draft) and `ledger.bankReconciliation`.
