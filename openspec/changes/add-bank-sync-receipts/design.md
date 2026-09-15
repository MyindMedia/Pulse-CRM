## Context

See proposal.md for why. The baseline at the start of this feature shaped the approach:

- `expenses` (schema.ts ~1689) already has `receiptId: Id<"_storage">`, written only by `expenses.create`; `generateReceiptUploadUrl` exists with no caller. `expenses.plReport` is the only P&L (paid invoices + un-invoiced paid payments − expenses).
- Money visibility is server-side: `insights.read` = books, `invoices.send` = money writes, and the owner switch removes `MONEY_CAPABILITIES` from managers.
- There is no Plaid code, no encryption helper, no JWT verification helper, and no image input in `lib/openai.ts` (Responses API via the `openai` SDK).
- `changeAudit` skips writes with no signed-in user, so cron/webhook work leaves no trace today.
- Workspace deletion walks `ORG_TABLES`; it does not delete stored files.
- Crons follow `googleCalendarSync` (fan-out internal mutation → per-org internal action with a cursor).

## Goals / Non-Goals

**Goals:**
- Bank balances and transactions in Pulse within minutes of connecting, current thereafter.
- Receipts read automatically; matches proposed deterministically; a complete, permanent record.
- No new secret exposure: tokens encrypted, never client-visible, bank data never to AI.

**Non-Goals:**
- iPhone screens, camera capture and device mirroring of bank data (follow-up after App Review approves 1.1).
- Moving money, ACH, Plaid Auth/Identity/Balance products, account and routing numbers.
- Bank-feed-driven revenue recognition (revenue stays invoices + payments; bank deposits are shown as cash in).
- Receipt email forwarding, multi-currency conversion, tax filing, double-entry general ledger.

## Decisions

### D1. Plaid over raw HTTP, not the SDK
Call Plaid with `fetch` from Convex actions (`lib/plaid.ts`): `link/token/create`, `item/public_token/exchange`, `accounts/get`, `transactions/sync`, `item/get`, `item/remove`, `webhook_verification_key/get`. Environment host from `PLAID_ENV` (`sandbox` default, `production`). Alternative: `plaid` npm SDK under `"use node"`; rejected to keep actions in the default runtime and avoid a heavy axios-based dependency for seven endpoints.

### D2. Token encryption with AES-256-GCM (`lib/secretBox.ts`)
`PLAID_TOKEN_KEY` (base64, 32 bytes) in Convex env; `seal(plaintext) → {ciphertext, iv}` and `open()` using Web Crypto. Tokens are decrypted only inside internal actions immediately before a Plaid call. Alternative: rely on Convex at-rest encryption alone; rejected because dashboard/export access would expose working bank tokens.

### D3. Webhook verification with Web Crypto
`/plaid/webhook` reads the raw body, decodes the `Plaid-Verification` JWT header (must be `alg: ES256`), fetches the JWK for its `kid`, verifies the ECDSA P-256 signature over `header.payload`, rejects `iat` older than 300 s, and compares SHA-256(body) to `request_body_sha256` in constant time. Only then does it parse the body and schedule work. Handled codes: `TRANSACTIONS/SYNC_UPDATES_AVAILABLE` → sync; `ITEM/ERROR` (ITEM_LOGIN_REQUIRED) → `login_required`; `ITEM/PENDING_EXPIRATION` or `PENDING_DISCONNECT` → `expiring`; `ITEM/USER_PERMISSION_REVOKED` → `revoked`; `ITEM/NEW_ACCOUNTS_AVAILABLE` → flag. `ITEM/USER_ACCOUNT_REVOKED` forwards `account_id`, hides only the affected account, invalidates the current sync generation, retains the Item token and other accounts, flags account access for review, and schedules a sync. Unknown codes: 200, no-op.

### D4. Data model
- `bankConnections`: orgId, plaidItemId, institutionId?, institutionName, status (`active|syncing|login_required|expiring|revoked|error`), tokenCiphertext?, tokenIv?, cursor?, lastSyncedAt?, lastSyncError?, newAccountsAvailable?, syncGeneration?, syncStartedAt?, syncRequested?, connectedBy (name), createdAt. Indexes `by_org`, `by_item`. Sync fields are optional for compatibility with existing connections and are omitted from client projections.
- `bankAccounts`: orgId, connectionId, plaidAccountId, name, officialName?, mask?, type, subtype?, currentCents?, availableCents?, limitCents?, currency, balanceAsOf, hidden?. Indexes `by_org`, `by_connection`, `by_plaid_account`.
- `bankTransactions`: orgId, connectionId, accountId, plaidTransactionId, pendingTransactionId?, date (UTC midnight ms), authorizedDate?, amountCents (positive), direction (`in|out`), name, merchantName?, pfcPrimary?, pfcDetailed?, pending, removed?, excluded?, excludeReason? (`transfer|card_payment|loan|personal|other`), category? (expense category), expenseId?, receiptId?, updatedAt. Indexes `by_org_date`, `by_plaid_txn`, `by_account_date`, `by_expense`.
- `receipts`: orgId, storageId, fileName, fileType, sizeBytes, uploadedBy, uploadedAt, status (`reading|ready|needs_review|failed`), vendor?, date?, totalCents?, taxCents?, currency?, cardLast4?, confidence?, model?, extractedAt?, error?, expenseId?, bankTransactionId?. Indexes `by_org`, `by_org_status`, `by_expense`, `by_transaction`.
- `financeAudit` (append-only): orgId, at, action, actorType (`user|system|ai`), actorName?, receiptId?, expenseId?, bankTransactionId?, connectionId?, score?, reasons?, model?, before?, after?, detail?. Indexes `by_org_at`, `by_receipt`, `by_expense`, `by_transaction`.
- `financeMatchRejections`: orgId, key (`r:<id>|t:<id>` style pair key), at. Index `by_org_key`. Prevents re-suggesting a rejected pair.
- `expenses` gains optional `source` (`manual|receipt|bank`), `receiptDocId`, `bankTransactionId`.
Amounts are integer cents; Plaid's positive amount is money out.

### D5. Sync algorithm
Internal action `banking.syncConnection(connectionId)` atomically claims an 11-minute lease with a new generation. An overlapping request sets `syncRequested` instead of starting another worker; finishing schedules one follow-up pass. A later worker can reclaim an expired lease. Every account, transaction, cursor and status mutation verifies ownership, so a late response cannot overwrite a newer sync or restore a disconnected connection.

The owner decrypts the token, loops `transactions/sync` (count 500) accumulating pages, and restarts from the saved cursor on `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`. It applies changes in chunks of ≤ 200 per internal mutation (upsert by `plaidTransactionId`; when an added posted transaction carries `pending_transaction_id`, move existing matches/links from the pending row and delete it). The cursor advances only after all pages apply. `accounts/get` refreshes balances and the selected-account set; missing accounts are hidden and returned accounts can reappear. New outflows are matched and `bank.synced` records counts.

Initial history states `NOT_READY` and `INITIAL_UPDATE_COMPLETE` trigger at most ten retries one minute apart while history is still being prepared. Exhaustion records a clear error and releases the lease so a later refresh or cron can retry. `ITEM_LOGIN_REQUIRED` pauses sync. Ordinary successful sync preserves consent-expiry and account-review warnings; completed Link update mode clears them. Update Link enables account selection so users can review newly available accounts.

Cron `bank-sync` runs every six hours, reads 100 connections per page, schedules eligible connections and continues through the cursor. It skips current leases, revoked Items and connections requiring sign-in, and recovers stale workers.

### D6. Receipt extraction
`receipts.attach` (mutation) validates type/size via `ctx.db.system.get(storageId)` (not client-claimed size), meters storage, inserts `reading`, schedules `receipts.extract`. `extract` (internal action) loads bytes, sends one request to OpenAI (`DEFAULT_MODEL`) through a new `completeVisionJSON` in `lib/openai.ts` with `input_image` (data URL) or `input_file` (PDF), a strict JSON schema, the injection guard, and temperature-free deterministic prompt. Output is validated (date parseable and not in the future beyond 1 day, total ≥ 0 and < $1,000,000, card last4 exactly 4 digits else dropped, vendor trimmed to 80 chars and stripped of control chars). Confidence < 0.6 or missing total/date → `needs_review`. No Gemini fallback for receipts. Charges `ai_credits`.

### D7. Deterministic matching (`lib/financeMatch.ts`, pure, unit-tested)
Score out of 100:
- Amount: |Δ| ≤ 1¢ → 60; receipt total > bank amount by ≤ 20% and ≤ $50 (tip) → 35 (receipt↔bank only); else not a candidate.
- Date (bank date − receipt/expense date, days): 0 → 25; 1–3 → 20; 4–7 → 10; bank before receipt by more than 1 day or > 7 after → not a candidate. Expense↔bank: |Δ| ≤ 3 → 25/20, ≤ 7 → 10.
- Vendor: Dice coefficient of normalized tokens (lowercase, strip digits/#/store numbers/common noise like "pos", "debit", "purchase") ≥ 0.6 → 15; ≥ 0.3 → 8.
- Card last4 equals account mask → +10 (capped at 100).
Auto-link when score ≥ 85, next candidate ≤ score − 15, both sides unmatched, pair not rejected. Suggest when score ≥ 50. Alternatives considered: AI matching (rejected: sends bank data to a model, non-deterministic, not auditable); exact-amount only (rejected: misses tips and posting delays).

### D8. Where matches live
Links are stored on the rows (`receipts.expenseId/bankTransactionId`, `bankTransactions.expenseId/receiptId`, `expenses.receiptDocId/bankTransactionId/receiptId`) and kept consistent by shared link helpers that propagate receipt↔transaction↔expense and refuse a link that would give either side a second counterpart. Suggestions are computed on read (bounded candidate windows via date indexes), not stored.

The link helpers preflight the entire proposed chain, including indirect links left after an undo. Candidate ranking excludes incompatible chains before choosing an automatic match. Auto-match uses scheduled continuation through 100-row receipt and expense pages. Correcting receipt details detaches impossible matches with audit entries; it preserves expense amounts and the existing expense-to-bank link.

History uses the root item's immutable match events to recover former counterparts after unmatch or receipt deletion. Expansion is one hop from the requested item: it includes the receipt's upload/read evidence without recursively pulling unrelated later counterpart history. Tenant checks apply before audit references are followed.

### D9. Capabilities and tiers
New `banking.manage` on studio `owner`, agency `owner` and `admin`; added to `SENSITIVE_CAPABILITIES`; entitlement `reports` (same tier as the books). Reads use `insights.read`, writes `invoices.send`. Actions verify capability through an internal query before any Plaid call.

### D10. Web
Settings → Integrations contains a Plaid card with a direct “Connect with Plaid” button, connected-bank status, an explicit sandbox label, and a “Manage banking” link. It uses the same client-side CDN loader (`use-plaid-link.ts`) as Banking. Only users with `banking.manage` receive signup controls. The card waits for capability/Reports availability before querying financial data, and explains unavailable access or setup without breaking Settings.

`/banking` (Finance nav, `insights.read`): connect button, connection cards with status and reconnect/refresh/disconnect for banking managers, balance tiles, transaction filters (needs attention, matched, excluded, all), per-row actions (add a posted outflow to books with category, match suggestions, exclude). The web uses `transactionsPage` to load 50 rows at a time, scans at most 500 source rows per request for sparse filters, and follows the cursor until complete. All history and `start`/`end`/`filter` URL arguments let reporting links reach the same period and attention list. The previous bounded endpoint remains available for older clients.

`/expenses`: receipts panel (multi-file drop/upload, status, extracted fields editable, suggestions with confirm/reject, create expense), receipt column on the expense table with view and attach, history drawer (audit). P&L shows bank in/out/net, bank spending categories, cash on hand, card owed and the oldest included balance timestamp. Reconciliation counts distinguish receipts with no match from ready receipts still needing an expense; review counts remain visible without a connected bank.

### D11. Periods and collected revenue
Bank and extracted-receipt dates represent calendar days at UTC midnight. The web supplies optional `bankStart`/`bankEnd` bounds for those records; collected invoice/payment timestamps, stored expense timestamps and undated receipt upload times retain the local report's `start`/`end`. Legacy callers that omit calendar bounds keep their original range behavior. Bank/receipt-generated expenses are stored at noon UTC, manual expense dates at local noon, and payroll/credit-adjustment rows use actual timestamps; existing stored dates are preserved.

This year/All time uses the next local midnight as a stable upper timestamp boundary, with the corresponding next UTC calendar day for bank records. Query arguments stay stable across renders instead of moving with every `Date.now()` call.

Revenue adds paid booking ledger rows and paid invoices at their own collection timestamps. `createCompletionInvoice` already subtracts deposits from the amount due, and paying the resulting invoice does not create another booking payment row. A shared session ID therefore cannot identify a duplicate payment. Removing the previous session-wide suppression fixes the concrete $100 deposit + $200 balance invoice case, including across monthly boundaries. Explicit invoice payment methods are retained; Stripe booking rows are card, while manual rows without a recorded method remain unrecorded. Bank cash flow never feeds profit directly.

### D12. Deletion and erasure
Disconnect calls `item/remove` before clearing the token or deleting optional history. A temporary Plaid/network/decryption failure leaves credentials and history available for retry; `ITEM_NOT_FOUND` and `INVALID_ACCESS_TOKEN` are treated as already removed. A concurrent sync loses ownership before it can restore data.

New tables join `ORG_TABLES` (financeAudit and rejections included, before `changeLog`). Workspace deletion schedules `item/remove` with encrypted token boxes and deletes receipt files and bank rows. Cleanup retries only the failed token boxes after 1, 2, 4, 8 and 16 minutes; exhausted retries surface a failure with encrypted arguments available for operator recovery. Tests exercise deletion, stored-file cleanup, retries and other-studio isolation. Bank rows are financial records: client erasure (`dataRights`) keeps them, consistent with existing financial-record retention.

## Risks / Trade-offs

- [Plaid production access for Pulse is not yet confirmed] → ship with `PLAID_ENV=sandbox`; switching is an env change once the Plaid dashboard lists Pulse's use case.
- [Losing `PLAID_TOKEN_KEY` makes tokens unusable] → owners reconnect; history is kept. Record the key in 1Password.
- [OCR misreads] → confidence gate, `needs_review`, editable fields, no automatic expense creation from receipts.
- [Receipt AI unavailable or out of API credits] → preserve the uploaded receipt for manual correction and matching; do not claim successful extraction. Live verification on 2026-09-14 reached this fallback because OpenAI returned HTTP 429.
- [Auto-match errors] → strict threshold + margin, labelled automatic, one-click undo, rejection memory.
- [Large first import (two years)] → chunked sync mutations and cursor-based transaction pages. History deletion is not batched and large/all-time report queries can still reach Convex read limits; these remain scale follow-ups.
- [Convex function limits during sync] → ≤ 200 rows per mutation; cursor saved only after full apply.
- [Webhook key fetch latency] → one extra Plaid call per webhook; acceptable at webhook volume.

## Migration Plan

Additive schema only. Deploy Convex (schema + functions + env), then web. Rollback: remove the nav entry and cron; data stays inert.

On 2026-09-14, backend fixes were deployed to `pastel-corgi-340` with `PLAID_ENV=sandbox`. The existing demo feed has 14 accounts and 394 transactions; two real sync passes completed without duplicates and released their leases. A synthetic receipt passed upload, failure fallback, manual correction, automatic matching and audit verification. Successful live AI extraction is still unverified because the configured OpenAI account lacks API credits. Track frontend deployment and fixture cleanup in `tasks.md`.

## Open Questions

- Plaid production: is the existing Plaid team approved to use Transactions for Pulse (a second application), or does the Plaid dashboard need a Pulse app profile first? Until answered, production uses sandbox.
- Should accountants also hold `banking.manage`? Default: no.
