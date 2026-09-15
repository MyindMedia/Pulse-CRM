## Purpose

The studio P&L: collected revenue, expenses and profit for a period, now with the bank's view of cash and how much of the spending is documented.

## ADDED Requirements

### Requirement: The P&L shows the bank's view of the period
For a chosen period the P&L SHALL show, from connected bank accounts: money in, money out, and net cash flow, excluding transfers, card payments, loan payments, removed transactions and anything marked excluded; spending by category; current cash on hand (depository balances) and amount owed on cards (credit balances) as of the last sync. When no bank is connected it SHALL say so and offer to connect.

#### Scenario: Transfer between accounts
- **WHEN** $2,000 moves from checking to savings in the period
- **THEN** it counts toward neither money in nor money out

#### Scenario: Calendar dates at a month boundary
- **WHEN** a viewer outside UTC selects a month
- **THEN** bank and dated-receipt records use the selected calendar days, while collected revenue keeps the local timestamp boundaries
- **AND** the Banking reconciliation link opens those same bank dates and the attention filter

### Requirement: Expenses from receipts and bank lines count exactly once
Expenses created from receipts or bank transactions SHALL count in expenses and profit like manual expenses, and SHALL never be counted again from the bank view's categories when computing profit. Profit SHALL remain collected revenue minus expenses.

#### Scenario: Bank charge added to the books
- **WHEN** a $300 outflow is added to the books as rent
- **THEN** expenses rise by $300 and profit falls by $300 once

#### Scenario: Deposit followed by the remaining balance
- **WHEN** the studio collects a $100 deposit in August and a $200 remaining-balance invoice in September
- **THEN** August revenue is $100, September revenue is $200, and the combined period shows $300
- **AND** sharing a session does not cause either distinct receipt of money to disappear

### Requirement: The P&L shows how reconciled the books are
The P&L SHALL show, for the period: bank outflows not yet matched to an expense or excluded, receipts not yet matched, receipts needing review, and expenses without a receipt.

#### Scenario: Unmatched outflows
- **WHEN** three bank outflows in the period are neither matched nor excluded
- **THEN** the P&L shows 3 outflows to reconcile, linking to Banking filtered to them

#### Scenario: Receipt matched to a bank charge but not yet booked
- **WHEN** a ready receipt has a bank match and no expense
- **THEN** it is counted as needing an expense, separately from receipts that have no match at all
