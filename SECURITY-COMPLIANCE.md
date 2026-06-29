# Pulse — Security & Compliance Notes

> **Not legal advice.** This is a build-time engineering guardrail + paper trail, produced with the `compliance-ops` skill. It documents how Pulse is designed to keep customer data scoped and the AI out of the protected path where it doesn't belong. Your compliance officer / counsel makes the final call. It does **not** make Pulse "SOC 2 certified" — only an independent CPA firm's Type II report does that.

## Scope & data classes

Pulse is a **multi-tenant SaaS** (Convex backend + Next.js on Netlify). The applicable lenses are **SOC 2** (customer data) and **GDPR** (PII). There is **no PHI** (not healthcare) and **no stored card data** (Stripe hosts the card fields / Connect; Pulse stores no PAN), so HIPAA and PCI-DSS scope are avoided by design.

**In-scope data:** studio + end-client PII (names, emails, phones), session/booking records, financials (invoices, payments, rates), and song-rights data (split sheets, contributor IPI). Every record carries `orgId` and is isolated per sub-account.

## Tenant isolation (the #1 invariant)

- Every query derives `orgId` **server-side** from the access engine (`lib/tenant.ts` `currentOrg` / `currentOrgWithCapability`) — never from client args. Every table is `by_org`-indexed; reads are scoped to one org.
- Financial/analytics reads are capability-gated (`insights.read`, `billing.read`, etc.) via `lib/accessPolicies.ts`.
- The Studio Brain graph, profitability, risk, and manager evaluations are all derived from a single org's data only, with **two-org isolation tests** asserting org A's graph/scan never contains org B refs.
- Execution paths re-verify `doc.orgId === action.orgId` before any mutation.

## AI sub-processors & egress (SOC 2 / GDPR control)

The AI layer routes through one chokepoint: `convex/lib/openai.ts → complete()` / `completeJSON()`.

| Endpoint | Role | Coverage requirement | Status |
|---|---|---|---|
| **OpenAI API** (gpt-5 / gpt-5-mini, Responses API) | primary | Commercial Terms + **DPA**, **no training on API data**, request **ZDR** (zero data retention) | API-key (commercial path). **Action: confirm DPA executed + ZDR enabled.** |
| **Google Gemini** (text fallback) | fallback | Paid (no-train) tier under Google Cloud **DPA** | **Gated OFF by default** (`AI_ALLOW_GEMINI_FALLBACK`). Enable only after the DPA is in place; otherwise OpenAI outage degrades to deterministic templates, not Gemini. |
| **Gemini image** (brand hero) | studio-aesthetic image gen | low risk — prompt is about room aesthetic, no client PII | OK |
| **Consumer Claude.ai / ChatGPT / Gemini app** | — | NEVER in the data path | not used (API keys only) |

**Minimum-necessary (already designed in):**
- Client-facing email drafts use a **merge token** (`{{user_FirstName}}`) — the model **never receives the real client name or email**; the name is merged in at send time outside the model.
- The agent/manager surfaces send client names only to produce owner-facing analysis; financial figures are sent as facts the model interprets (it never computes them).

## Prompt-injection defenses

Layered, at one chokepoint plus per-surface:
1. **`INJECTION_GUARD`** appended to every system prompt — observed text is data, never instructions.
2. **`tenantGuard(studioName)`** — binds every answer to one studio; refuses cross-tenant questions.
3. **`fenceUntrusted(label, content)`** wraps all client-controlled text before it reaches the model: client concierge questions, email FACTS, **and (new) the Studio Brain relationship/history block + the Studio Manager fact block** — so a client who names themselves "ignore your instructions" can never become an instruction.
4. **`detectInjection()`** blocks obvious jailbreak phrasings on client free-text (concierge portal) before it hits the model.
5. **Draft verifier (`lib/aiVerify.ts`)** — a deterministic gate that drops any AI email body containing a placeholder token or an **invented dollar amount** before it can reach the approval inbox; the deterministic template is kept instead.
6. **Structured outputs** (`completeJSON`) — the agent's plan is a forced JSON contract, not brace-sliced free text.
7. **Real protection is the data boundary:** the access engine only ever loads ONE org's data into a prompt, so even a successful injection cannot reach another tenant's records (the prompt-layer guards just make the model refuse to try).

## Vendor DPA / sub-processor checklist (for the compliance officer)

Confirm each holds **SOC 2 Type II + an executed DPA** and add to the sub-processor list:

- [ ] **Convex** (production DB / functions) — DPA + security posture.
- [ ] **Clerk** (auth / user PII) — DPA.
- [ ] **Stripe** (payments, Connect) — DPA; PCI handled by Stripe hosted fields (Pulse stays SAQ-A-eligible, no PAN stored).
- [ ] **Resend** (transactional + client email) — DPA.
- [ ] **Twilio** (SMS / phone PII) — DPA; A2P 10DLC registered.
- [ ] **Netlify** (frontend hosting / SSR) — DPA.
- [ ] **OpenAI** (AI sub-processor) — **DPA + ZDR / no-train** confirmation.
- [ ] **Google Cloud / Gemini** — DPA before enabling `AI_ALLOW_GEMINI_FALLBACK`.

## The six SOC 2 builder controls — status

1. **Data inventory** — this document + the `by_org` schema. ✅ (keep current)
2. **Least-privilege access** — capability model (`accessPolicies.ts`), Clerk auth, scoped reads. ✅
3. **Encryption in transit + at rest** — TLS everywhere; Convex managed encryption; secrets in 1Password / Convex env, never committed. ✅
4. **Audit logging** — `auditEvents` + `activity` on sensitive actions; agent runs append-only `agentAuditLogs`. ✅ (retain + review)
5. **Vendor DPA chain** — the checklist above. ⏳ (compliance officer to execute/collect)
6. **Change management** — PR-based, CI typecheck + 442 tests + lint, no direct prod pushes for app code. ✅

## GDPR notes (PII)

- **Lawful basis / roles:** the studio is the controller of its clients' PII; Pulse is the processor; sub-processors above need Art. 28 DPAs + a transfer mechanism (SCCs / EU-US DPF) for any US transfer.
- **Data-subject rights — IMPLEMENTED (`convex/dataRights.ts`):** per client, the studio can **export** a structured data bundle (portability) and **erase** (right to be forgotten). Erasure anonymizes the client's identifying fields and scrubs their identity from session titles/notes, message history, outbound notifications and AI email drafts, and the knowledge-graph node; financial records (invoices, payments) are retained in anonymized form under the accounting legitimate-interest basis. Erasure is owner/manager-gated (`members.remove`), org-scoped, audited (`auditEvents` + `activity`), and idempotent. UI: a Privacy menu on the client detail (`/roster/[id]`).

## Open items (ranked)

1. **Execute + record the OpenAI DPA and enable ZDR** (AI sub-processor is the main egress of customer data). _Highest._
2. **Collect/execute DPAs** for the vendor checklist; maintain a published sub-processor list.
3. ~~Formalize a GDPR erasure/export flow per data subject.~~ **Done** (`convex/dataRights.ts`).
4. Keep `AI_ALLOW_GEMINI_FALLBACK` off until the Google DPA is in place.

## Platform vulnerability audit + remediation (2026-06-29)

A four-track read-only audit (tenant isolation/IDOR, authorization, public endpoints/webhooks, secrets/auth/input) followed by fixes. All shipped; 458 tests + typecheck + lint + build green.

**Critical — fixed**
- **Auth bypass (`lib/access.ts`):** the no-Clerk-identity branch synthesized an OWNER viewer pointed at `appState.activeOrgId` without checking Clerk was configured, so a tokenless Convex API call got owner access to a real prod org. Now denied in production (demo viewer only when `CLERK_JWT_ISSUER_DOMAIN` is unset or `PULSE_DEMO_MODE=1`). Verified `CLERK_JWT_ISSUER_DOMAIN` is set on prod, so the gate is active.
- **Unauthenticated cross-tenant wipe (`seed.run`, `seedSchedule.run`):** public mutations took an arbitrary `orgId` and deleted ~30 tables. Now require `members.remove` on the target org.
- **Financial/PII exfiltration (`exports.ts`):** CSV exports of invoices/bookings/clients/splits had no gate. Now capability-gated (`invoices.read`/`insights.read`/`splitsheet.read`/`songs.read`/`activity.read`).
- **Stripe Connect (`stripeConnect.ts`):** bank/payout dashboard link + account/deposit actions were `currentOrg`-only. Now gated `invoices.send` at the shared chokepoints.

**High — fixed**
- **Authorization migration:** ~50 destructive/financial mutations across artists, songs, equipment, sessions (setComp), orgs settings, opportunities, licensing, splitSheets, releases, deliverables, software, automation.runNow moved from bare `currentOrg` to `currentOrgWithCapability(cap)` so a low-privilege member (intern) can no longer delete data, comp bookings, or rewrite pricing.
- **Cross-tenant financial read (`agency.subaccount`):** guard only handled agency members; studio members fell through to any org's rollup. Now requires an agency member of that org's agency.
- **SMS inbound webhook (`http.ts`):** the only check was a bypassable LoopMessage header (skipped when absent), letting forged posts opt numbers in/out + inject cross-org messages. Now fail-closed on a shared secret (`SMS_INBOUND_SECRET`/`LOOPMESSAGE_WEBHOOK_SECRET`, via header or `?token=`).
- **Webhook idempotency (`billingWebhooks.ts`):** the session/invoice settle branches didn't `markProcessed`, so a Stripe retry double-recorded a payment. Fixed.

**Medium — fixed**
- Public `availability` no longer returns session titles (leaked client names). `grants.revoke` now verifies the grant's org. `externalCalendars.getInternal`/`listActiveInternal` changed `query`→`internalQuery` (were leaking private iCal URLs). `fetchIcal` now blocks SSRF (https + public-IP-resolved host only). `demoMode.status` is agency-scoped; `requireAgencyOverOrg` treats an orphan org as a mismatch. Two email-HTML interpolations now HTML-escaped (`agent.ts`, `agencyBilling.ts`).

**Verified clean**
No committed secrets; nothing secret in the browser bundle (only publishable keys); no `eval`/unsafe `dangerouslySetInnerHTML`; Stripe webhook signature verified; payment amounts always server-derived; magic-link/split-sheet/portal tokens are random + scoped + single-use.

**Open (abuse/CSRF mitigations, lower severity — recommended next):**
1. Rate-limit/captcha `booking.createBooking` (unbounded record + email amplification) and cap `portal.ask` LLM calls per token.
2. Google OAuth callback (`http.ts /google/callback`) should use a random single-use `state` nonce bound to the initiating user/org (CSRF: an attacker could attach their Google account to a victim org).

_Note: the auth-bypass fix means any unauthenticated pitch-demo browsing in prod must use a logged-in demo account; the bare slug-less `/book` page no longer renders for anonymous callers in prod (real studios use `/book/<slug>`, which is unaffected)._

_Generated with the `compliance-ops` skill. Not legal advice._
