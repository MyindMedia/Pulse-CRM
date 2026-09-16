# Implementation tasks

- [x] Add shared studio expense and income category definitions, labels, and tax-report mappings.
- [x] Widen Convex schema with optional bank Money In classification/link fields.
- [x] Add indexed immutable Stripe ledger and payout tables.
- [x] Validate Stripe connected-account settlement metadata before recognizing revenue.
- [x] Ingest payout/refund/dispute/balance activity idempotently.
- [x] Reconcile automatic Stripe payouts to Plaid deposits without recognizing revenue twice.
- [x] Add direct bank income and non-revenue classification mutations with finance audit entries.
- [x] Add incoming Needs attention counts, filters, badges, and Money In actions.
- [x] Include package and membership collections, refunds, and fees in financial summaries.
- [x] Add Financials reporting tab and date controls.
- [x] Add P&L, income, expense, bank, Stripe settlement, and tax-category CSV exports.
- [x] Add printable report output for Save as PDF.
- [x] Update iOS models, labels, Money In actions, and financial report presentation.
- [x] Add backend, web, and iOS regression tests for all accounting invariants.
- [x] Run GitNexus change analysis, Convex codegen/typecheck, focused finance tests, full checks, web QA, and iOS simulator tests.
