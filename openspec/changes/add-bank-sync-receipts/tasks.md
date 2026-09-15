## 1. Foundations

- [x] 1.1 `lib/secretBox.ts` AES-256-GCM seal/open with `PLAID_TOKEN_KEY`; verify: `secretBox.test.ts` round-trips, rejects tampered ciphertext and a wrong key.
- [x] 1.2 `lib/financeMatch.ts` scoring, candidate filtering, auto-link decision, vendor normalization; verify: `financeMatch.test.ts` covers exact amount, tip, posting delay, far dates, inflows ignored, ambiguous twins, last4 bonus, rejected pairs.
- [x] 1.3 `lib/plaid.ts` fetch client (env host, errors surfaced as `PlaidError{code}`), PFC → exclusion and category suggestions, webhook JWT verification; verify: `plaid.test.ts` with a generated ES256 key signs a body and passes, and fails on tampered body, stale `iat`, wrong alg, wrong key.
- [x] 1.4 Schema: five new tables + rejections + expense fields and indexes; verify: `npx convex codegen` + `tsc --noEmit` clean, `mirroredTables.test.ts` still green.
- [x] 1.5 Capability `banking.manage` in access policies, sensitive set, entitlement map; verify: an owner has it, manager/accountant/engineer do not (test).

## 2. Bank sync (server)

- [x] 2.1 `banking.createLinkToken` / `createUpdateLinkToken` actions gated by `banking.manage`; verify: test refuses a manager.
- [x] 2.2 `banking.exchangePublicToken` → seal token, insert connection + accounts, schedule sync, audit `bank.connected`; verify: test with mocked Plaid stores ciphertext only.
- [x] 2.3 `banking.syncConnection` internal action + guarded account/transaction mutations (upsert, modified, removed, pending → posted relink, exclusion defaults) + balances + cursor + audit `bank.synced`; verify: repeat sync is idempotent, pending matches migrate, concurrent requests coalesce, and stale workers cannot write after replacement or disconnect.
- [x] 2.4 `/plaid/webhook` route with verification and code handling; verify: route tests reject an unsigned request without changes and forward a signed account-level revocation; handler tests cover sync scheduling and item/account revocation.
- [x] 2.5 `banking.disconnect` (item/remove, clear token, keep or delete history, audit) and `refresh`; verify: temporary removal failures retain credentials/history for retry, already-removed items can be forgotten, and expiry/account-access warnings clear only after completed Link update.
- [x] 2.6 Cron `bank-sync` every 6 h, with 100-connection pages; verify: schedules eligible connections, recovers expired workers, and skips live leases, revoked items and connections needing sign-in.
- [x] 2.7 Queries `banking.overview` (safe projection, balances, attention counts) and `banking.transactions` (filters, bounded list); verify: test no token/cursor/item id in any response; engineer refused. User-facing pagination remains a follow-up.
- [x] 2.8 Mutations `categorize`, `exclude/include`, `addToBooks` (creates expense source bank + link + audit); verify: test expense created once, second call refused.

## 3. Receipts (server)

- [x] 3.1 `completeVisionJSON` in `lib/openai.ts` (image data URL / PDF file, JSON schema, guard, no Gemini); verify: `openai.vision.test.ts` builds the request shape with a stubbed fetch.
- [x] 3.2 `receipts.generateUploadUrl`, `attach` (type/size from storage metadata, meter storage, audit), `extract` internal action + `_saveExtraction` (validation, needs_review, audit with model); verify: tests for refused types, size, engineer refusal, needs_review on low confidence, injection text ignored.
- [x] 3.3 `receipts.update` (corrections audited with before/after), `remove` (file deleted, links cleared, audit), `createExpense` (source receipt, file attached, chain to matched transaction); verify: tests.
- [x] 3.4 Queries `receipts.list` (status filter, file URL, top suggestions) and `finance.history` (by receipt/expense/transaction); verify: tests.

## 4. Reconciliation (server)

- [x] 4.1 `lib/financeLinks.ts` `linkChain` + `unlink` enforcing one counterpart per kind and propagation; verify: tests for chain propagation and refusal of a second link.
- [x] 4.2 Auto-match after extraction and after sync; suggestions on read; `reconcile.confirm`, `reconcile.reject` (rejection memory), `reconcile.unmatch`; all audited with score and reasons; verify: tests incl. ambiguous twins not auto-linked and rejected pair not re-suggested.

## 5. P&L

- [x] 5.1 Extend `expenses.plReport` with `bank` (in, out, net, by category, cash on hand, card owed, connected) and `reconciliation` counts; verify: `expenses.test.ts` additions (transfer excluded, removed ignored, added-to-books counted once).

## 6. Registration, deletion, compliance

- [x] 6.1 Add tables to `ORG_TABLES`; workspace deletion removes receipt files and schedules encrypted Plaid cleanup; verify: `subaccountDeletion.test.ts` covers bank-row/file deletion and another studio's isolation, and `banking.test.ts` covers failed-item retries and retry exhaustion.
- [x] 6.2 `docs/compliance/banking-and-receipts.md` data-flow map + vendor checklist; `SECURITY-COMPLIANCE.md` Plaid row; privacy policy names Plaid and receipt reading; verify: page renders, no em dashes.

## 7. Web

- [x] 7.1 Load Plaid Link through `use-plaid-link.ts`; `/banking` page (connect, status, reconnect, refresh, disconnect dialog, balances, transactions table with filters and row actions); nav entry; verify: type-check and lint pass, Banking loads against sandbox, and Connect opens Plaid Link.
- [x] 7.2 `/expenses` receipts panel (upload, statuses, edit, suggestions, create expense), receipt column + attach on expense rows, history drawer; verify: receipt tests and a live synthetic upload through the public actions, followed by correction, automatic matching and audit checks. Live AI extraction remains blocked as recorded in 8.3.
- [x] 7.3 P&L bank tiles + reconciliation counts on `/expenses`; verify: renders with and without a bank.
- [x] 7.4 Settings → Integrations has a Plaid card with direct “Connect with Plaid” signup, connected-bank status, sandbox labeling and “Manage banking”; verify: four UI tests cover Reports availability, financial-read access, viewer restrictions and owner signup. Live deployment verification is part of 8.2.

## 8. Verify and ship

- [x] 8.1 `npm run check` green (tsc, eslint, vitest): 191 files / 1,678 tests pass; lint has 0 errors and 86 existing warnings (2026-09-14).
- [x] 8.2 Deploy and verify both app surfaces.
  - [x] Verify Convex prod env (`PLAID_ENV=sandbox`, client id, sandbox secret, `PLAID_TOKEN_KEY`) and deploy backend fixes to `pastel-corgi-340`.
  - [x] Commit frontend changes as `91a577c` and push to main.
  - [x] Confirm the deployed Settings → Integrations signup opens Plaid Link. Netlify deploy `6aa89ff5eae8e70009cb9b68` published `91a577c`; live browser verified the card and “Pulse uses Plaid to connect your account” sandbox dialog on 2026-09-14.
- [ ] 8.3 End to end on the demo studio.
  - [x] Confirm the imported First Platypus Bank sandbox feed has 14 accounts and 394 transactions. Two live sync passes preserve the transaction count, finish active and release the lease.
  - [x] Upload a synthetic $5.40 Uber receipt through the real public actions; verify the failed-read fallback, manual correction, automatic match (score 100), and `receipt.uploaded`, `receipt.read_failed`, `receipt.corrected` and `match.auto` audit entries.
  - [ ] Verify successful live AI extraction after the configured OpenAI account has API credits. The current request returns HTTP 429; it reaches `needs_review` and remains manually correctable.
  - [x] Remove the synthetic verification receipt and confirm its stored file and match are cleared.
- [x] 8.4 Security review of the new surface (webhook, token handling, upload validation, access checks); record results.

## Notes from implementation

- 7.1 / 7.4: Both Banking and Settings → Integrations use the same Plaid CDN loader (`src/components/finance/use-plaid-link.ts`). Signup is offered only to users with `banking.manage`; users without financial access or Reports do not issue the banking overview query.
- 3.2: refusals are returned, not thrown, so the file delete commits; the real file type is sniffed from its bytes before any AI call.
- 8.4: security review found one issue (reconcile.reject accepted another studio's ids into the audit log); fixed with `ownedRef` on every client-supplied reference and a test. `/pentest` (Strix) needs Docker, which is not installed here, so no automated pentest was run.
- Verification locations: 3.1 request shape is checked in `receipts.test.ts` ("sends the image to OpenAI"); 5.1 P&L counts in `banking.test.ts` ("the books"); 2.6 cron recovery/fan-out in `banking.test.ts`; 2.4 route-level verification in `bankingWebhook.test.ts`, with signature primitives in `plaid.test.ts`; 6.1 workspace deletion and receipt storage cleanup in `subaccountDeletion.test.ts`.
- Sync resilience: an 11-minute lease and generation guard protect every sync write; overlapping requests request one follow-up pass. Initial history is polled at one-minute intervals for at most ten retries, then reported as still preparing so a later refresh/cron can retry.
- Build verification: the production frontend build passed on 2026-09-14; publication and live Integrations verification are complete as recorded in 8.2.
- Removal resilience: disconnect keeps credentials and history when Plaid removal fails temporarily. Workspace cleanup retains encrypted retry arguments and retries only failed items after 1, 2, 4, 8 and 16 minutes; exhaustion requires operator recovery.
- Review follow-ups: user-facing transaction pagination and bounded deletion batches remain scale improvements. Plaid production approval is still unconfirmed; real-bank signup is not enabled by this sandbox deployment. iPhone integration remains outside this change.
