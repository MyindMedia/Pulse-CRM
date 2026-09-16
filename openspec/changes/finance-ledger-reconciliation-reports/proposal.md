# Finance ledger, settlement reconciliation, and accountant reports

## Why

Pulse currently keeps recognized revenue separate from bank cash movement, so a Stripe payout does not directly duplicate revenue. The system still cannot explain how gross Stripe sales became a net bank deposit, and it omits processor fees, refunds, disputes, package sales, membership sales, and direct bank income from the full financial picture. Incoming bank transactions are read-only, some customer deposits can be hidden as generic transfers, and Reports has no accountant-ready financial export.

## Outcome

Pulse will use cash-basis reporting by default and maintain three distinct views of money:

1. **Revenue ledger:** customer payments recognized once when collected.
2. **Processor clearing:** Stripe charges, fees, refunds, disputes, adjustments, and payouts.
3. **Bank cash:** Plaid deposits and withdrawals, reconciled to their accounting source.

The product will add studio-specific expense and income categories, Money In review actions, Stripe payout reconciliation, and financial reports with CSV plus print/PDF output.

## Requirements

- A Stripe customer payment counts as revenue once at collection time.
- A Stripe payout to the bank is a transfer from Stripe clearing to bank cash and never new revenue.
- Stripe fees, refunds, disputes, and adjustments affect profit once through immutable provider ledger entries.
- Automatic payouts reconcile to the exact Stripe balance transactions included in the payout.
- Plaid bank deposits can match a Stripe payout, match an existing Pulse payment or invoice, become direct income, or be classified as non-revenue.
- Ambiguous or unmatched incoming transactions remain visible in Needs attention.
- Package and membership collections appear in revenue reports.
- Tax/accounting exports include source, date, gross, fees, refunds, net, category, tax mapping, reconciliation status, and supporting-document state.
- Existing historical rows remain valid through optional schema additions and legacy fallbacks.
- Web and native iOS use the same category values and accounting meanings.

## Scope

### Included

- Studio expense categories and income categories.
- Bank Money In classification and audit history.
- Stripe clearing ledger and payout summaries.
- Automatic unambiguous payout-to-bank matching.
- P&L, cash flow, settlement, and reconciliation summaries.
- Financial Reports tab with date range, CSV exports, and print/save-PDF support.
- Tests for idempotency, double-count prevention, refunds, fees, payouts, direct income, transfers, and tenant boundaries.

### Not included

- Filing tax returns or calculating tax liability.
- Full double-entry general ledger with configurable debit/credit accounts.
- Inventory cost accounting, depreciation schedules, or payroll tax filing.
- Automatic tax advice or deduction eligibility decisions.
- Manual Stripe payouts that Stripe cannot map to component balance transactions; these remain review items.
