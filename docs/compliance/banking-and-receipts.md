# Data-Flow Map and Vendor Checklist: Banking (Plaid) and Receipts

**Prepared by:** Compliance Ops (build-time guardrail, not legal advice)
**Date:** 2026-09-15
**Change:** `openspec/changes/add-bank-sync-receipts`
**Regimes:** SOC 2 (customer data); FTC Safeguards Rule principles as required by Plaid's developer policy; PCI-DSS scope check; GDPR if EU studios are onboarded
**Protected data class:** a studio's business bank and card data (account names, last four digits, balances, transactions), receipt documents (vendor, amounts, sometimes card last four, sometimes a cashier or customer name), and the staff identities who act on them

---

## Roles

- Each **studio** is the controller of its financial records and chooses to connect its bank.
- **Myind Media (Pulse)** is the processor.
- **Plaid** retrieves bank data on the studio's instruction; the studio accepts Plaid's end-user terms inside Plaid Link.
- The vendors below are Pulse's sub-processors for this feature.

## Scope decisions

- **PCI-DSS: out of scope.** Pulse requests only Plaid's Transactions product: no Auth (account and routing numbers), no card numbers. Receipts keep at most the last four card digits; any longer digit string returned by the model is discarded before storage (`receipts.cleanExtraction`). Pulse never stores a PAN.
- **Bank credentials never touch Pulse.** The studio signs in to its bank inside Plaid Link (Plaid's frame, Plaid's CDN). Pulse receives only a one-time public token, exchanged server-side.

## Surfaces

| Surface | Touches protected data? | Lane | Vendor | Agreement status |
|---|---|---|---|---|
| Plaid Link (bank sign-in) | Yes: bank credentials and MFA | 2 | Plaid (hosted Link, cdn.plaid.com) | Plaid SOC 2 Type II + ISO 27001; **confirm Plaid production approval for Pulse's use case** |
| Token exchange, sync, disconnect (`banking.ts` actions) | Yes: access token, transactions, balances | 2 | Convex (server), Plaid API | Convex: **verify SOC 2 + DPA executed** (open from messages.md) |
| Stored bank data (`bankConnections`, `bankAccounts`, `bankTransactions`) | Yes | 2 | Convex | Access token sealed with AES-256-GCM (`lib/secretBox`, key `PLAID_TOKEN_KEY` in Convex env) |
| Plaid webhook `/plaid/webhook` | Item id, event codes only | 2 (minimal) | Convex HTTP action | ES256 JWT verified, body hash checked, 5-minute freshness |
| Banking and Expenses pages | Yes: shown to authorized staff | 2 | Netlify serves the page; data flows browser to Convex directly | Netlify: no bank data passes through Netlify functions |
| Receipt upload and storage (`receipts`) | Yes: receipt document | 2 | Convex file storage | Type from storage metadata plus byte sniff; 10 MB cap; metered |
| Receipt reading (`receipts.extract`) | Yes: receipt image or PDF | 2 | Configured paid Gemini API via `lib/receiptAI.completeReceiptVisionJSON`; explicit OpenAI rollback | Paid Gemini project verified on 2026-09-15. Paid terms incorporate Google's processor DPA and exclude product-improvement use; limited abuse/legal retention still applies. No automatic cross-provider fallback. |
| Matching (`lib/financeMatch`, `reconcile.ts`) | Yes: amounts, dates, vendor names | 2 | Convex only | Deterministic code; **no AI, bank data never sent to any model** |
| Finance audit trail (`financeAudit`) | Minimal: ids, amounts, actor names | 2 | Convex | Append-only; readable with `insights.read` |
| Staff sign-in | Staff identity | 1 (adjacent) | Clerk | DPA for staff personal data; confirm executed |
| This build's AI assistant (Claude Code) | No: built against code, tests and Plaid sandbox fixtures | 1 | Anthropic | No production bank data or receipts read |

---

## Protected-data paths (explicit)

```
Owner connects a bank
   → browser loads Plaid Link from cdn.plaid.com with a Link token (banking.createLinkToken,
     banking.manage only)
   → studio signs in to its bank inside Plaid's frame                     [Plaid]
   → Plaid returns a one-time public token to the browser
   → banking.exchangePublicToken (Convex action) → Plaid /item/public_token/exchange
   → access token sealed (AES-256-GCM) and stored; never returned to any client

Sync
   → Plaid webhook (verified) or 6-hourly cron → banking.syncConnection
   → token opened in memory → Plaid /transactions/sync + /accounts/get
   → rows upserted in Convex; cursor saved after the full page set applies
   → reconcile.autoMatch (code only)

Receipt
   → staff browser → Convex upload URL → Convex storage
   → receipts.attach checks type and size → receipts.extract
   → bytes sniffed; not an image or PDF → marked failed, never sent anywhere
   → configured paid Gemini API (image/PDF, JSON schema, injection guard)      [Google]
   → or explicitly configured OpenAI Responses API; never automatic fallback
   → every field validated; only 4-digit card suffix kept → stored
   → reconcile.autoMatch (code only)

AI: only the receipt document goes to the configured provider. Bank transactions, balances and tokens never do. Gemini requests use `store:false`, which does not establish zero abuse-monitoring retention. GIF receipts remain available for manual review.
```

## Controls built into this feature

- **Least privilege:** `banking.manage` (connect, repair, refresh, disconnect) is owner and agency owner or admin only and is a sensitive (audited) capability; reads need `insights.read`; categorizing, receipts and matches need `invoices.send`; the owner's "managers can see money" switch removes both money capabilities from managers. Every query and mutation is org-scoped on the server.
- **Secret handling:** Plaid access token sealed at rest, opened only inside internal actions, never logged, never returned; no bank table is mirrored to devices.
- **Webhook integrity:** Plaid-Verification ES256 JWT, key fetched per kid, `iat` within 300 s, SHA-256 body match, constant-time compare; unverified requests return 401 and change nothing.
- **Minimization:** Transactions product only; no Auth, Identity or Balance products; receipts keep vendor, date, total, tax, currency and a 4-digit card suffix.
- **Untrusted input:** receipt text is data, never instructions (injection guard in the system prompt, strict schema, per-field validation, length and control-character limits); a file that is not really an image or PDF is refused before any AI call.
- **Audit logging:** `financeAudit` records uploads, AI reads (with model), corrections (before and after), automatic and confirmed matches (with score and reasons), undo, rejections, expense creation, categorization, bank connect, sync (counts), errors and disconnect, including system and AI actors that `changeAudit` does not capture.
- **Deletion:** disconnect calls Plaid `/item/remove` and destroys the token, with the owner choosing whether imported lines stay; workspace deletion removes Plaid items and deletes receipt files before rows; org reset never touches finance tables.
- **Retention:** bank lines and receipts are financial records kept for the studio's books until the studio deletes them or the workspace; client erasure (`dataRights`) keeps anonymized financial records, consistent with the existing accounting legitimate-interest basis.

## Vendor agreement checklist

- [ ] Plaid: production approval for Pulse; developer policy and end-user privacy policy reviewed; Plaid listed as a sub-processor (privacy policy updated 2026-09-14).
- [x] Paid Gemini API project verified; [paid-service data-use terms](https://ai.google.dev/gemini-api/terms) reviewed on 2026-09-15. They incorporate the processor DPA; this does not claim a separate negotiated agreement or zero retention.
- [ ] Follow Google's required postpay-to-prepay migration notice to prevent service interruption. No billing change was made by this integration task.
- [ ] OpenAI rollback: API DPA/retention account evidence remains open.
- [ ] Convex: SOC 2 Type II report reviewed; DPA executed.
- [ ] Record `PLAID_TOKEN_KEY` in 1Password.

## Not yet covered

- Authenticated native verification and release remain open; iPhone receipt/banking implementation is in Pulse-Native draft PR #1.
- EU studios: Plaid EU coverage, SCCs with Plaid and OpenAI, EU data residency. Not enabled.
- Independent penetration test of the new surface: the `/pentest` tool needs Docker, which is not installed on this machine. A code-level security review was done instead (see the change's tasks).

---

*Compliance Ops is a build-time guardrail, not legal advice, and it cannot make a Claude consumer subscription able to process protected data. Confirm the final architecture with your compliance officer or counsel before any protected data flows.*
