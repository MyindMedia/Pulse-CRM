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
- [x] 2.7 Queries `banking.overview` (safe projection, balances, attention counts), legacy `banking.transactions`, and cursor-based `banking.transactionsPage`; verify: no token/cursor/item id in response rows, engineer refused, 1,205 imported transactions reachable, and sparse-filter continuation tested. The web list loads 50 rows per page and offers All history.
- [x] 2.8 Mutations `categorize`, `exclude/include`, `addToBooks` (creates expense source bank + link + audit); verify: test expense created once, second call refused.

## 3. Receipts (server)

- [x] 3.1 `completeVisionJSON` in `lib/openai.ts` (image data URL / PDF file, JSON schema, guard, no Gemini); verify: `openai.vision.test.ts` builds the request shape with a stubbed fetch.
- [x] 3.2 `receipts.generateUploadUrl`, `attach` (type/size from storage metadata, meter storage, audit), `extract` internal action + `_saveExtraction` (validation, needs_review, audit with model); verify: tests for refused types, size, engineer refusal, needs_review on low confidence, injection text ignored.
- [x] 3.3 `receipts.update` (corrections audited with before/after), `remove` (file deleted, links cleared, audit), `createExpense` (source receipt, file attached, chain to matched transaction); verify: tests.
- [x] 3.4 Queries `receipts.list` (status filter, file URL, top suggestions) and `reconcile.history` (by receipt/expense/transaction); verify: history retains upload, AI-read and match evidence after unmatch/deletion, includes former counterparts without recursively following unrelated later matches, and enforces tenant/access boundaries.

## 4. Reconciliation (server)

- [x] 4.1 `lib/financeLinks.ts` link helpers + `unlink` enforce one counterpart per kind and propagation. Whole-chain preflight rejects conflicting direct or indirect links before writing; suggestions and automatic matching skip incompatible candidates. Verify: conflict and partial-undo regression tests leave rows/audit unchanged on refusal.
- [x] 4.2 Auto-match after extraction and after sync; suggestions on read; `reconcile.confirm`, `reconcile.reject` (rejection memory), `reconcile.unmatch`; all audited with score and reasons. Auto-match continues through 100-row receipt/expense pages instead of stopping after the first 300 receipts or 1,000 expenses; verify: continuation tests reach later eligible records.
- [x] 4.3 Receipt corrections detach matches that no longer fit and audit the undo without rewriting the expense ledger; compatible tax/capitalization corrections keep the chain. Verify: corrected amount can match a different bank line after detachment.
- [x] 4.4 Require automatic-match confidence from both sides of a pair, leaving competing receipts/expenses for manual confirmation. Four ambiguity regressions fail before the fix and pass afterward; unique existing chains still complete. The focused finance group passes 72 tests.
- [x] 4.5 Record displayed match suggestions with the viewer, server-derived score/reasons and durable duplicate protection. The server verifies the displayed version to avoid auditing a changed snapshot. Nine new tests cover actor attribution, duplicate protection, stale/forged candidates, history direction and the rendered 2/5-row subset. The focused finance/UI group passes 41 tests.

## 5. P&L

- [x] 5.1 Extend `expenses.plReport` with bank in/out/net, spending categories, current balances/as-of and reconciliation counts. Verify: `expenses.test.ts` covers transfers/card/loan/personal exclusions, pending/removed lines, tenant isolation, hidden/revoked balances, expense-only profit, true unmatched receipts, receipts still needing an expense, and review counts.
- [x] 5.2 Separate UTC calendar bounds for bank/dated-receipt records from actual collection/upload timestamps; pass the same bank bounds to the attention link. Verify: Los Angeles first/last bank dates stay in the report while late-night payments/payroll retain their local month.
- [x] 5.3 Count distinct paid booking payments plus paid invoices without suppressing payments merely because they share a session. Verify: actual `payDeposit` → completion invoice → invoice payment writes produce $100 August + $200 September = $300 combined; manual payment methods remain unrecorded unless known.

## 6. Registration, deletion, compliance

- [x] 6.1 Add tables to `ORG_TABLES`; workspace deletion removes receipt files and schedules encrypted Plaid cleanup; verify: `subaccountDeletion.test.ts` covers bank-row/file deletion and another studio's isolation, and `banking.test.ts` covers failed-item retries and retry exhaustion.
- [x] 6.2 `docs/compliance/banking-and-receipts.md` data-flow map + vendor checklist; `SECURITY-COMPLIANCE.md` Plaid row; privacy policy names Plaid and receipt reading; verify: page renders, no em dashes.

## 7. Web

- [x] 7.1 Load Plaid Link through `use-plaid-link.ts`; `/banking` page (connect, status, reconnect, refresh, disconnect dialog, balances, transactions table with filters and row actions); nav entry; verify: type-check and lint pass, Banking loads against sandbox, and Connect opens Plaid Link.
- [x] 7.2 `/expenses` receipts panel (upload, statuses, edit, suggestions, create expense), receipt column + attach on expense rows, history drawer; verify: receipt tests and a live synthetic upload through the public actions, followed by correction, automatic matching and audit checks. Live AI extraction remains blocked as recorded in 8.3.
- [x] 7.3 P&L displays net cash flow, bank spending categories, cash/card balances and their as-of timestamp, plus receipt review/unmatched/to-book counts. Reconciliation links preserve the selected calendar period and attention filter; type-check and focused calculation tests pass. Final live verification is tracked in 8.5.
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
- [x] 8.5 Verify and deploy the completion pass (transaction pagination, P&L accuracy and permanent reconciliation history).
  - [x] Run the final combined `npm run check` and production build. On 2026-09-14, 195 test files / 1,707 tests pass, TypeScript passes, and ESLint reports no errors (86 existing warnings). Production Next.js build passes.
  - [x] Deploy the updated backend and frontend, then verify the affected live views. Convex production deploy passed; source `72befcb` was pushed to main and Netlify deploy `6aa8a71862cf53000824f7bc` published it on 2026-09-14 at 19:03 PDT. Live browser verified the populated bank report and no-bank view, All time report loading, preserved September report bounds, All history, 50→100 transaction pagination, and the Integrations signup card. The original workspace view was restored and the temporary tab closed.

## Notes from implementation

- 7.1 / 7.4: Both Banking and Settings → Integrations use the same Plaid CDN loader (`src/components/finance/use-plaid-link.ts`). Signup is offered only to users with `banking.manage`; users without financial access or Reports do not issue the banking overview query.
- 3.2: refusals are returned, not thrown, so the file delete commits; the real file type is sniffed from its bytes before any AI call.
- 8.4: security review found one issue (reconcile.reject accepted another studio's ids into the audit log); fixed with `ownedRef` on every client-supplied reference and a test. `/pentest` (Strix) needs Docker, which is not installed here, so no automated pentest was run.
- Verification locations: 3.1 request shape is checked in `receipts.test.ts` ("sends the image to OpenAI"); 5.1–5.3 P&L in `expenses.test.ts` and `banking.test.ts`; 2.6 cron recovery/fan-out in `banking.test.ts`; 2.4 route-level verification in `bankingWebhook.test.ts`, with signature primitives in `plaid.test.ts`; 6.1 workspace deletion and receipt storage cleanup in `subaccountDeletion.test.ts`; permanent history in `financeHistory.test.ts`; chain/correction/continuation regressions in `receiptReconciliation.test.ts`.
- Sync resilience: an 11-minute lease and generation guard protect every sync write; overlapping requests request one follow-up pass. Initial history is polled at one-minute intervals for at most ten retries, then reported as still preparing so a later refresh/cron can retry.
- Build verification: the production frontend build passed on 2026-09-14; publication and live Integrations verification are complete as recorded in 8.2.
- Removal resilience: disconnect keeps credentials and history when Plaid removal fails temporarily. Workspace cleanup retains encrypted retry arguments and retries only failed items after 1, 2, 4, 8 and 16 minutes; exhaustion requires operator recovery.
- Completion-pass focused verification: 65 P&L, booking, money-reconciliation and invoice tests passed, plus TypeScript and scoped lint. These do not replace the final combined checks in 8.5.
- Report query keys use a stable next-local-midnight boundary for This year/All time; they do not shift on every render. Final browser verification is part of 8.5.
- Launch recheck on 2026-09-14: production still reports `PLAID_ENV=sandbox`; a new synthetic receipt-image request using the configured OpenAI key/model returns HTTP 429, `credit_balance_exhausted` / `insufficient_quota`. Successful receipt extraction remains blocked by the external API balance.
- Completion-pass graph verification: refreshed index; full structured `detect_changes(scope=all)` includes all 17 staged files, 175 symbols and 25 indexed affected processes, critical risk, with no partial/truncated result flag. The graph's sampled process catalog is supplemented by focused source reviews, 29 added regressions, and the full checks above.
- Review follow-ups: bounded deletion and large-report read limits remain scale improvements. Plaid production approval is still unconfirmed; real-bank signup is not enabled by this sandbox deployment. iPhone integration remains outside this change.
