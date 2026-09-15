## Why

Studios see revenue in Pulse but not where the money actually goes. Expenses are typed in by hand, nothing ties them to the bank, and receipts sit in a shoebox, so the P&L is only as good as someone's memory. Connecting the studio's bank through Plaid and reading receipts automatically turns the books from a guess into a reconciled record.

## What Changes

- Owners connect the studio's business bank and card accounts through Plaid Link. Pulse stores the Plaid access token encrypted, pulls balances and transactions (up to two years back), and keeps them current from Plaid webhooks plus a scheduled sync.
- A Banking page shows cash on hand, card balances, every imported transaction, and what still needs attention. Owners, managers and accountants categorize transactions, mark transfers, and add outflows to the books as expenses.
- Owners, managers and accountants upload receipts (photo or PDF) on their own or against an expense. Pulse reads the vendor, date and total with AI, then proposes the matching expense and bank transaction.
- Matching is deterministic code on amount, date and vendor. High-confidence, unambiguous matches link automatically; everything else is a suggestion a person confirms. Any match can be undone.
- Every step (upload, extraction, suggestion, match, unmatch, expense created from a receipt or transaction, bank sync, connect and disconnect) is written to an append-only finance audit trail with who or what did it, when, and why.
- The P&L gains a bank view (money in, money out, transfers excluded), account balances, and reconciliation counts (unmatched outflows, receipts waiting, expenses with no receipt).
- New capability `banking.manage` (owner, agency owner/admin) to connect, refresh and disconnect banks. Reading follows `insights.read`; writing follows `invoices.send`, so the owner's "managers can see money" switch still applies.
- Privacy policy and compliance docs name Plaid as a sub-processor.

## Capabilities

### New Capabilities
- `finance/bank-sync`: connecting bank accounts through Plaid, importing balances and transactions, keeping them current, categorizing, and disconnecting.
- `finance/receipt-capture`: uploading receipts, extracting vendor, date and total, and turning a receipt into an expense.
- `finance/reconciliation`: matching receipts, expenses and bank transactions, suggestions versus automatic links, undo, and the finance audit trail.
- `finance/pnl-report`: the studio P&L (no spec existed before). It adds bank cash flow, balances and reconciliation counts; expenses created from receipts or bank lines count like any other expense and are never double counted.

### Modified Capabilities
- None with an existing spec. Behaviour of the existing P&L query is extended, captured in `finance/pnl-report`.

## Impact

- Convex: new tables `bankConnections`, `bankAccounts`, `bankTransactions`, `receipts`, `financeAudit`; new optional fields on `expenses` (`source`, `receiptDocId`, `bankTransactionId`); new modules `banking.ts`, `receipts.ts`, `lib/plaid.ts`, `lib/secretBox.ts`, `lib/financeMatch.ts`; receipt provider adapter in `lib/receiptAI.ts` and retained OpenAI vision helper in `lib/openai.ts`; `/plaid/webhook` HTTP route; a 6-hourly sync cron; deletion and access-policy registration.
- Web: new `/banking` page, receipts section and receipt column on `/expenses`, bank figures on the P&L, nav entry.
- Environment (Convex prod): `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_TOKEN_KEY`.
- New sub-processor: Plaid. AI: uploaded receipt images/PDFs through the configured paid Gemini API or explicitly selected OpenAI API; bank data never goes to an AI.
- iPhone: not in this change (follow-up after 1.1 is approved).
