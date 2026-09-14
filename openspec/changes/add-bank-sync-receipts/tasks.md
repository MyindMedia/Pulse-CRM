## 1. Foundations

- [ ] 1.1 `lib/secretBox.ts` AES-256-GCM seal/open with `PLAID_TOKEN_KEY`; verify: `secretBox.test.ts` round-trips, rejects tampered ciphertext and a wrong key.
- [ ] 1.2 `lib/financeMatch.ts` scoring, candidate filtering, auto-link decision, vendor normalization; verify: `financeMatch.test.ts` covers exact amount, tip, posting delay, far dates, inflows ignored, ambiguous twins, last4 bonus, rejected pairs.
- [ ] 1.3 `lib/plaid.ts` fetch client (env host, errors surfaced as `PlaidError{code}`), PFC → exclusion and category suggestions, webhook JWT verification; verify: `plaid.test.ts` with a generated ES256 key signs a body and passes, and fails on tampered body, stale `iat`, wrong alg, wrong key.
- [ ] 1.4 Schema: five new tables + rejections + expense fields and indexes; verify: `npx convex codegen` + `tsc --noEmit` clean, `mirroredTables.test.ts` still green.
- [ ] 1.5 Capability `banking.manage` in access policies, sensitive set, entitlement map; verify: an owner has it, manager/accountant/engineer do not (test).

## 2. Bank sync (server)

- [ ] 2.1 `banking.createLinkToken` / `createUpdateLinkToken` actions gated by `banking.manage`; verify: test refuses a manager.
- [ ] 2.2 `banking.exchangePublicToken` → seal token, insert connection + accounts, schedule sync, audit `bank.connected`; verify: test with mocked Plaid stores ciphertext only.
- [ ] 2.3 `banking.syncConnection` internal action + `_applyPage` mutation (upsert, modified, removed, pending → posted relink, exclusion defaults) + balances + cursor + audit `bank.synced`; verify: test applies a page twice without duplicates and relinks a pending match.
- [ ] 2.4 `/plaid/webhook` route with verification and code handling; verify: test forged request changes nothing; verified SYNC_UPDATES_AVAILABLE schedules a sync.
- [ ] 2.5 `banking.disconnect` (item/remove, clear token, keep or delete history, audit) and `refresh`; verify: test token cleared and status revoked.
- [ ] 2.6 Cron `bank-sync` every 6 h fan-out; verify: test schedules only active connections.
- [ ] 2.7 Queries `banking.overview` (safe projection, balances, attention counts) and `banking.transactions` (filters, paginated); verify: test no token/cursor/item id in any response; engineer refused.
- [ ] 2.8 Mutations `categorize`, `exclude/include`, `addToBooks` (creates expense source bank + link + audit); verify: test expense created once, second call refused.

## 3. Receipts (server)

- [ ] 3.1 `completeVisionJSON` in `lib/openai.ts` (image data URL / PDF file, JSON schema, guard, no Gemini); verify: `openai.vision.test.ts` builds the request shape with a stubbed fetch.
- [ ] 3.2 `receipts.generateUploadUrl`, `attach` (type/size from storage metadata, meter storage, audit), `extract` internal action + `_saveExtraction` (validation, needs_review, audit with model); verify: tests for refused types, size, engineer refusal, needs_review on low confidence, injection text ignored.
- [ ] 3.3 `receipts.update` (corrections audited with before/after), `remove` (file deleted, links cleared, audit), `createExpense` (source receipt, file attached, chain to matched transaction); verify: tests.
- [ ] 3.4 Queries `receipts.list` (status filter, file URL, top suggestions) and `finance.history` (by receipt/expense/transaction); verify: tests.

## 4. Reconciliation (server)

- [ ] 4.1 `lib/financeLinks.ts` `linkChain` + `unlink` enforcing one counterpart per kind and propagation; verify: tests for chain propagation and refusal of a second link.
- [ ] 4.2 Auto-match after extraction and after sync; suggestions on read; `reconcile.confirm`, `reconcile.reject` (rejection memory), `reconcile.unmatch`; all audited with score and reasons; verify: tests incl. ambiguous twins not auto-linked and rejected pair not re-suggested.

## 5. P&L

- [ ] 5.1 Extend `expenses.plReport` with `bank` (in, out, net, by category, cash on hand, card owed, connected) and `reconciliation` counts; verify: `expenses.test.ts` additions (transfer excluded, removed ignored, added-to-books counted once).

## 6. Registration, deletion, compliance

- [ ] 6.1 Add tables to `ORG_TABLES`; workspace deletion removes Plaid items and receipt files; verify: `subaccountDeletion.test.ts` addition.
- [ ] 6.2 `docs/compliance/banking-and-receipts.md` data-flow map + vendor checklist; `SECURITY-COMPLIANCE.md` Plaid row; privacy policy names Plaid and receipt reading; verify: page renders, no em dashes.

## 7. Web

- [ ] 7.1 Add `react-plaid-link`; `/banking` page (connect, status, reconnect, refresh, disconnect dialog, balances, transactions table with filters and row actions); nav entry; verify: `tsc` + eslint clean, page loads in the browser against sandbox.
- [ ] 7.2 `/expenses` receipts panel (upload, statuses, edit, suggestions, create expense), receipt column + attach on expense rows, history drawer; verify: upload a sample receipt end to end.
- [ ] 7.3 P&L bank tiles + reconciliation counts on `/expenses`; verify: renders with and without a bank.

## 8. Verify and ship

- [ ] 8.1 `npm run check` green (tsc, eslint, vitest).
- [ ] 8.2 Set Convex prod env (`PLAID_ENV=sandbox`, client id, sandbox secret, generated `PLAID_TOKEN_KEY`); deploy Convex, push main.
- [ ] 8.3 End to end on the demo studio: create a sandbox item via `/sandbox/public_token/create`, exchange through the real action, confirm accounts, balances and transactions import; upload a sample receipt and confirm extraction and a match; confirm audit entries.
- [ ] 8.4 Security review of the new surface (webhook, token handling, upload validation, access checks); record results.
