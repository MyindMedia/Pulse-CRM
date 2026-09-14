## Purpose

The studio P&L: collected revenue, expenses and profit for a period, now with the bank's view of cash and how much of the spending is documented.

## ADDED Requirements

### Requirement: The P&L shows the bank's view of the period
For a chosen period the P&L SHALL show, from connected bank accounts: money in, money out, and net cash flow, excluding transfers, card payments, loan payments, removed transactions and anything marked excluded; spending by category; current cash on hand (depository balances) and amount owed on cards (credit balances) as of the last sync. When no bank is connected it SHALL say so and offer to connect.

#### Scenario: Transfer between accounts
- **WHEN** $2,000 moves from checking to savings in the period
- **THEN** it counts toward neither money in nor money out

### Requirement: Expenses from receipts and bank lines count exactly once
Expenses created from receipts or bank transactions SHALL count in expenses and profit like manual expenses, and SHALL never be counted again from the bank view's categories when computing profit. Profit SHALL remain collected revenue minus expenses.

#### Scenario: Bank charge added to the books
- **WHEN** a $300 outflow is added to the books as rent
- **THEN** expenses rise by $300 and profit falls by $300 once

### Requirement: The P&L shows how reconciled the books are
The P&L SHALL show, for the period: bank outflows not yet matched to an expense or excluded, receipts not yet matched, receipts needing review, and expenses without a receipt.

#### Scenario: Unmatched outflows
- **WHEN** three bank outflows in the period are neither matched nor excluded
- **THEN** the P&L shows 3 outflows to reconcile, linking to Banking filtered to them
