## Context

See proposal.md for why. Current state that shapes the approach:

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
`/plaid/webhook` reads the raw body, decodes the `Plaid-Verification` JWT header (must be `alg: ES256`), fetches the JWK for its `kid`, verifies the ECDSA P-256 signature over `header.payload`, rejects `iat` older than 300 s, and compares SHA-256(body) to `request_body_sha256` in constant time. Only then does it parse the body and schedule work. Handled codes: `TRANSACTIONS/SYNC_UPDATES_AVAILABLE` → sync; `ITEM/ERROR` (ITEM_LOGIN_REQUIRED) → `login_required`; `ITEM/PENDING_EXPIRATION` or `PENDING_DISCONNECT` → `expiring`; `ITEM/USER_PERMISSION_REVOKED` → `revoked`; `ITEM/NEW_ACCOUNTS_AVAILABLE` → flag. Unknown codes: 200, no-op.

### D4. Data model
- `bankConnections`: orgId, plaidItemId, institutionId?, institutionName, status (`active|syncing|login_required|expiring|revoked|error`), tokenCiphertext?, tokenIv?, cursor?, lastSyncedAt?, lastSyncError?, newAccountsAvailable?, connectedBy (name), createdAt. Indexes `by_org`, `by_item`.
- `bankAccounts`: orgId, connectionId, plaidAccountId, name, officialName?, mask?, type, subtype?, currentCents?, availableCents?, limitCents?, currency, balanceAsOf, hidden?. Indexes `by_org`, `by_connection`, `by_plaid_account`.
- `bankTransactions`: orgId, connectionId, accountId, plaidTransactionId, pendingTransactionId?, date (UTC midnight ms), authorizedDate?, amountCents (positive), direction (`in|out`), name, merchantName?, pfcPrimary?, pfcDetailed?, pending, removed?, excluded?, excludeReason? (`transfer|card_payment|loan|personal|other`), category? (expense category), expenseId?, receiptId?, updatedAt. Indexes `by_org_date`, `by_plaid_txn`, `by_account_date`, `by_expense`.
- `receipts`: orgId, storageId, fileName, fileType, sizeBytes, uploadedBy, uploadedAt, status (`reading|ready|needs_review|failed`), vendor?, date?, totalCents?, taxCents?, currency?, cardLast4?, confidence?, model?, extractedAt?, error?, expenseId?, bankTransactionId?. Indexes `by_org`, `by_org_status`, `by_expense`, `by_transaction`.
- `financeAudit` (append-only): orgId, at, action, actorType (`user|system|ai`), actorName?, receiptId?, expenseId?, bankTransactionId?, connectionId?, score?, reasons?, model?, before?, after?, detail?. Indexes `by_org_at`, `by_receipt`, `by_expense`, `by_transaction`.
- `financeMatchRejections`: orgId, key (`r:<id>|t:<id>` style pair key), at. Index `by_org_key`. Prevents re-suggesting a rejected pair.
- `expenses` gains optional `source` (`manual|receipt|bank`), `receiptDocId`, `bankTransactionId`.
Amounts are integer cents; Plaid's positive amount is money out.

### D5. Sync algorithm
Internal action `banking.syncConnection(connectionId)`: set `syncing`, decrypt, loop `transactions/sync` (count 500) accumulating pages; on `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` restart from the saved cursor; apply in chunks of ≤ 200 per internal mutation (upsert by `plaidTransactionId`; when an added posted transaction carries `pending_transaction_id`, move matches/links from the pending row and delete it); persist the cursor only after all pages apply; then `accounts/get` to refresh balances; then run auto-matching for new outflows; write one `bank.synced` audit entry with counts. `ITEM_LOGIN_REQUIRED` → `login_required` and stop. Cron `bank-sync` every 6 hours schedules active connections staggered.

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
Links are stored on the rows (`receipts.expenseId/bankTransactionId`, `bankTransactions.expenseId/receiptId`, `expenses.receiptDocId/bankTransactionId/receiptId`) and kept consistent by one internal helper `linkChain` that propagates receipt↔transaction↔expense and refuses a link that would give either side a second counterpart. Suggestions are computed on read (bounded candidate windows via date indexes), not stored.

### D9. Capabilities and tiers
New `banking.manage` on studio `owner`, agency `owner` and `admin`; added to `SENSITIVE_CAPABILITIES`; entitlement `reports` (same tier as the books). Reads use `insights.read`, writes `invoices.send`. Actions verify capability through an internal query before any Plaid call.

### D10. Web
`/banking` (Finance nav, `insights.read`): connect button (Plaid Link via the `react-plaid-link` hook, loaded client-side), connection cards with status and reconnect/refresh/disconnect (owner only), balances tiles, transactions table with filters (needs attention, matched, excluded, all), per-row actions (add to books with category, match suggestions, exclude). `/expenses`: receipts panel (multi-file drop/upload, status, extracted fields editable, suggestions with confirm/reject, create expense), receipt column on the expense table with view and attach, history drawer (audit). P&L tiles for bank in/out, cash on hand, card owed, and reconciliation counts.

### D11. Deletion and erasure
New tables join `ORG_TABLES` (financeAudit and rejections included, before `changeLog`). Workspace deletion first schedules `item/remove` for each connection and deletes receipt files. Bank rows are financial records: client erasure (`dataRights`) keeps them, consistent with existing financial-record retention.

## Risks / Trade-offs

- [Plaid production access for Pulse is not yet confirmed] → ship with `PLAID_ENV=sandbox`; switching is an env change once the Plaid dashboard lists Pulse's use case.
- [Losing `PLAID_TOKEN_KEY` makes tokens unusable] → owners reconnect; history is kept. Record the key in 1Password.
- [OCR misreads] → confidence gate, `needs_review`, editable fields, no automatic expense creation from receipts.
- [Auto-match errors] → strict threshold + margin, labelled automatic, one-click undo, rejection memory.
- [Large first import (two years)] → chunked mutations and paginated reads; P&L bank view reads by date index.
- [Convex function limits during sync] → ≤ 200 rows per mutation; cursor saved only after full apply.
- [Webhook key fetch latency] → one extra Plaid call per webhook; acceptable at webhook volume.

## Migration Plan

Additive schema only. Deploy Convex (schema + functions + env), then web. Rollback: remove the nav entry and cron; data stays inert.

## Open Questions

- Plaid production: is the existing Plaid team approved to use Transactions for Pulse (a second application), or does the Plaid dashboard need a Pulse app profile first? Until answered, production uses sandbox.
- Should accountants also hold `banking.manage`? Default: no.
