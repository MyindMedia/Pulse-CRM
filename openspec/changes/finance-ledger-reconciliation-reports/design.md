# Design: finance ledger, settlement reconciliation, and accountant reports

## Accounting model

Pulse uses cash-basis collection timestamps for operating reports.

```text
Customer charge or direct payment
        |
        +--> Revenue ledger --------------------------> P&L revenue
        |
        +--> Stripe clearing (for Stripe payments)
                  | gross charges
                  | - refunds and disputes
                  | - Stripe and Pulse fees
                  | +/- adjustments
                  v
             Stripe payout
                  |
                  +--> matched Plaid bank deposit ----> Bank cash only

Payouts never enter P&L revenue. Bank expenses enter P&L only through one
linked expense row. Direct bank income enters P&L only after explicit review.
```

## Expense categories

Keep the existing stable values and add studio-specific values:

- `subscriptions`
- `team_meals`
- `events_showcases`
- `equipment_rental`
- `client_hospitality`
- `cleaning_security`
- `professional_services`
- `education_training`
- `taxes_licenses`
- `music_licensing`
- `production_services`

Existing `software` remains for purchased software and one-time tools. `subscriptions` is recurring SaaS and memberships. `gear` remains owned equipment; `equipment_rental` is short-term hire. User-facing labels explain these distinctions.

## Income categories

- `recording_sessions`
- `mixing_mastering`
- `production`
- `rehearsals`
- `memberships`
- `packages_prepaid`
- `events`
- `licensing_royalties`
- `equipment_rental`
- `merchandise`
- `other_income`

## Money In treatment

Every posted incoming bank line has an optional treatment:

- `income`: direct cash-basis revenue, with an income category.
- `stripe_payout`: settlement transfer linked to a Stripe payout.
- `recorded_payment`: settlement of an existing Pulse invoice/payment/package/membership.
- `internal_transfer`: movement between the studio's own accounts.
- `owner_contribution`: equity contribution, not revenue.
- `loan_proceeds`: liability funding, not revenue.
- `refund_reimbursement`: reviewable contra-expense or reimbursement.
- `other_non_income`: non-revenue with an explanatory note.

Unclassified, posted Money In remains in Needs attention. Legacy Plaid `TRANSFER_IN` is suggested as a transfer but remains reviewable and can be changed.

## Stripe clearing ledger

### `stripeLedgerEntries`

Immutable normalized Stripe balance activity, unique by connected account plus balance transaction ID:

- org and connected Stripe account
- balance transaction ID and source object ID
- payout ID when present
- type and reporting category
- signed gross, fee, and net cents
- currency
- created and available timestamps
- optional Pulse payment, invoice, package, or membership reference
- raw description only, no credentials or card data

Corrections use reversal entries. Financial amounts are never overwritten.

### `stripePayouts`

One row per connected-account payout:

- payout ID, amount, currency, status, arrival date, method
- gross charges, refunds, disputes, Stripe/Pulse fees, other adjustments, net
- reconciliation status and last error
- linked Plaid bank transaction

On `payout.paid` or `payout.reconciliation_completed`, an internal action lists balance transactions filtered by payout ID under the connected account header, then atomically upserts immutable entries and payout totals. Failed and canceled payouts remain visible and never match bank deposits.

## Idempotency and validation

- Stripe event ID prevents duplicate event handling.
- Connected account plus balance transaction ID prevents duplicate financial posting.
- Connected account plus provider source object prevents multiple revenue settlements for the same charge.
- Webhooks validate the connected Stripe account belongs to the target studio, payment status is paid, amount and currency match the Pulse target, and metadata references an entity in the same studio.
- A payout and bank transaction each have at most one counterpart.
- Automatic matching requires exact amount and currency, payout descriptor evidence, and an arrival-date window. More than one candidate means review, not a guess.
- Pending-to-posted Plaid replacement carries the reconciliation link forward.

## Reporting

Reports gains a Financials tab containing:

- gross collected revenue by source and income category
- refunds and disputes
- processor and Pulse fees
- net revenue after refunds and fees
- operating expenses by studio category and common tax-report grouping
- net profit and margin
- bank cash in, cash out, and net movement
- Stripe payouts received, pending, failed, and unmatched
- unreconciled Money In, Money Out, receipts, and expenses without documentation
- current bank cash, card balances, and Stripe clearing balance

Exports:

1. P&L summary CSV
2. Income detail CSV
3. Expense detail CSV
4. Bank reconciliation CSV
5. Stripe settlement CSV
6. Tax-category summary CSV
7. Print view suitable for Save as PDF

Each export is studio-scoped, date-bounded, integer-cent based, and includes reconciliation/documentation fields. Tax labels are organizational mappings, not tax advice.

## Performance

- Add indexes for org/date and provider IDs.
- Paginate detail exports and use bounded date ranges.
- Keep summary queries in indexed ranges; do not scan all historical Stripe or bank rows.
- Stripe payout ingestion runs in internal actions and writes in bounded batches.

## Migration

- All new fields on populated tables are optional.
- Historical bank inflows start unclassified unless a safe transfer rule applies.
- Existing P&L behavior remains valid until new ledger rows arrive.
- A bounded Stripe backfill imports recent payouts and balance transactions without modifying original payment/invoice rows.
