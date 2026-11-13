# Eval: Deliver final session files to the client
Status: approved         <!-- owner: "approved", 2026-11-13, mockup v1 and all 12 decisions as written -->
Risk: high: "if it breaks, a stranger could download a client's unreleased music, a client could get files without paying, or a paid client could be locked out"
RD: ./rd.md · Mockup: ./mockup.html · Branch: feat/session-file-delivery

## Must not break
- Session panel: notes, songs, invoices, history, message log; file upload, play, download, delete for staff
- `settlePayment`: deposit and balance math, hold confirmation, team alert, deposit email, Stripe webhook path
- Song Deliverables gate (`convex/files.ts`), client portal (`/portal/<token>`), library guest link (`/files/<token>`)
- Media library listing of session files (Growth studios), storage metering, `media-sweep-pending` cron
- iPhone app sync: no required field added or renamed on any mirrored table
- `npm run check` (tsc, eslint, vitest) with no new failures beyond the known ones in `docs/ENVIRONMENTS.md`

## Checks

### Access (who can reach what)
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| A-01 | Unknown, malformed, off and expired tokens all get the same `null` from `page` | convex-test: four tokens → identical result | PASS | convex/sessionDelivery.test.ts A-01 green (feature subset: 8 files, 99 tests passed); four tokens give identical null |
| A-02 | `fileUrl` refuses while the delivery is `awaiting_payment` | convex-test: locked delivery, valid token and version → error, no URL | PASS | convex/sessionDelivery.test.ts A-02 green; locked delivery throws and returns no URL |
| A-03 | `fileUrl` refuses a file that is not marked Final | convex-test: same booking, working file → error | PASS | convex/sessionDelivery.test.ts A-03 green; working file refused |
| A-04 | `fileUrl` refuses a Final file from another booking | convex-test: token of booking A, version of booking B (same studio) → error | PASS | convex/sessionDelivery.test.ts A-04 green; booking B version refused with booking A token |
| A-05 | `fileUrl` refuses a file from another studio | convex-test: second org's version → error | PASS | convex/sessionDelivery.test.ts A-05 green; second org's version refused |
| A-06 | `fileUrl` refuses after Turn off link and after expiry | convex-test: `off`, then `expiresAt` in the past → error | PASS | convex/sessionDelivery.test.ts A-06 green; off and past expiresAt both refused |
| A-07 | `page` never returns a file URL or the R2 key | convex-test: deep scan of the result for `http` and the key prefix | PASS | convex/sessionDelivery.test.ts A-07 green; deep scan finds no http and no key prefix. Not covered: a studio with a logo (logoUrl is not a delivery file) |
| A-08 | Signed-out caller cannot call any staff function | convex-test: `setFinal`, `status`, `markReady`, `releaseNow`, `turnOff`, `resend`, `copyLink` with no identity → refused | PASS | convex/sessionDelivery.test.ts A-08 green; every staff function refused signed out. The copy-link function is named `link` (query) in code |
| A-09 | Member of another studio cannot call any staff function on this booking | convex-test with a second org identity → refused | PASS | convex/sessionDelivery.test.ts A-09 green; second org identity refused |
| A-10 | Engineer cannot `releaseNow` or `turnOff` | convex-test with an engineer identity → refused | PASS | convex/sessionDelivery.test.ts A-10 green; engineer refused on releaseNow and turnOff |
| A-11 | Engineer never receives the balance amount | convex-test: `status` as engineer → no cents field; browser as engineer: no dollar figure in the card | NOT RUN (browser half needs an engineer Clerk sign-in on staging; local demo mode is owner only) | convex/sessionDelivery.test.ts A-11 green: status as engineer has no cents field |
| A-12 | Unmarking Final removes the file from the client page and from `fileUrl` at once | convex-test: release, unmark, `page` and `fileUrl` | PASS | convex/sessionDelivery.test.ts A-12 green; page and fileUrl drop the file at once |
| A-13 | Deleting a Final file removes it from the client page | convex-test: `sessionFiles.remove` then `page` | PASS | convex/sessionDelivery.test.ts A-13 green; sessionFiles.remove then page |
| A-14 | `fileUrl` is rate limited | convex-test: call 121 in an hour → the 121st refused | PASS | convex/sessionDelivery.test.ts A-14 green; 121st call in the hour refused |
| A-15 | The link token is not written to logs or returned to non-staff | grep the diff for `console.` near the token; convex-test: public results carry no token | PASS | convex/sessionDelivery.test.ts A-15 green; diff grep: the only new console call is console.error("[payments] session delivery release failed:", err.message), no token |

### Trigger and gate
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| G-01 | Paid first, then Ready: released and one "files ready" email | convex-test: settle full, `markReady` → status `released`, one notification row to the client email | PASS | convex/sessionDelivery.test.ts G-01 green; released, one notification row with sessionId |
| G-02 | Ready first, then paid: one "pay to unlock" email, then one "files ready" email when the payment settles | convex-test: `markReady` with a balance, then `settlePayment` balance | PASS | convex/sessionDelivery.test.ts G-02 green |
| G-03 | A deposit that leaves a balance does not release | convex-test: `markReady`, settle deposit → still `awaiting_payment`, no files email | PASS | convex/sessionDelivery.test.ts G-03 green |
| G-04 | Stripe webhook payment releases the same way as a manual one | convex-test through the webhook settle path (provider `stripe`) | PASS | convex/sessionDelivery.test.ts G-04 green. Calls settlePayment(provider stripe) directly, the same call billingWebhooks.ts:163 makes, not the webhook handler itself |
| G-05 | A comp that leaves nothing owed releases | convex-test: `markReady`, `sessions.setComp` | PASS | convex/sessionDelivery.test.ts G-05 green |
| G-06 | Release happens once: a replayed webhook or second settle call sends no second email | convex-test: call `onBalanceSettled` twice → one notification | PASS | convex/sessionDelivery.test.ts G-06 green; onBalanceSettled twice gives one notification |
| G-07 | The settling payment sends one client email, not two | convex-test: ready then paid → files email present, plain "Paid in full" absent; with no delivery → "Paid in full" still sent | PASS | convex/sessionDelivery.test.ts G-07 green; locally one delivery.ready email and no Paid in full after payments:record |
| G-08 | `markReady` refuses with no Final files | convex-test → clear error, no row, no email | PASS | convex/sessionDelivery.test.ts G-08 green |
| G-09 | `markReady` refuses with no client email, and the card says how to fix it | convex-test; browser: "No email on file" state | PASS | convex/sessionDelivery.test.ts G-09 green; browser: card says "Add an email for Remy to deliver.", Ready disabled, evidence/round1/G-09-no-email-card-1280.png |
| G-10 | Owner or manager "Send now anyway" releases without payment and records who did it | convex-test: `releasedBy` is the member's name | PASS | convex/sessionDelivery.test.ts G-10 green; releasedBy is the member name |
| G-11 | A released delivery stays released after the rate is raised | convex-test: release, raise `rateCents` → `page` still unlocked | PASS | convex/sessionDelivery.test.ts G-11 green |
| G-12 | Resend sends again to the booked email and starts a fresh 30 days | convex-test: `sendCount` + 1, `expiresAt` moved | PASS | convex/sessionDelivery.test.ts G-12 green |
| G-13 | Ready to deliver after Turn off issues a new token; the old link stays dead | convex-test | PASS | convex/sessionDelivery.test.ts G-13 green |
| G-14 | A cancelled booking cannot be marked ready and a delivery on it does not release | convex-test | PASS | convex/sessionDelivery.test.ts G-14 green |

### Staff panel (web)
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| U-01 | Drop three files on the zone: all three upload with their own progress bars and land in the list | browser on staging, 3 fixtures (wav, zip, pdf) | NOT RUN (needs staging: no file storage locally) |  |
| U-02 | Cancel one upload mid-way: it stops, the others finish, no orphan row | browser; then `media.myPending` is empty after the sweep window | NOT RUN (needs staging: no file storage locally) |  |
| U-03 | A refused type (html, svg, exe) shows the reason and uploads nothing | browser | PASS | html, svg, exe each show "That file type is not supported..."; mediaFiles 10 to 10. evidence/round1/U-03-refused-types-1280.png |
| U-04 | Final toggle works by mouse and keyboard and announces its state | browser + keyboard; `aria-pressed` or switch role | PASS | native button with aria-pressed, Space, Enter and mouse toggle it, focus ring visible. evidence/round1/U-04-final-toggles-focus.png, evidence/round1/U-04-final-focus-pressed.png |
| U-05 | Delivery card shows each state as in the mockup: none, waiting for payment, sent, off | screenshots vs `mockup.html` | PASS | evidence/round1/U-05-none-1280.png, evidence/round1/U-05-waiting-1280.png, evidence/round1/U-05-sent-1280.png, evidence/round1/U-05-off-1280.png; MINOR differences only |
| U-06 | Copy link copies the `/delivery/<token>` URL | browser | PASS | clipboard read back http://localhost:3311/delivery/<64 hex>, toast "Link copied" |
| U-07 | Panel at 390 px: no horizontal scroll, targets at least 44 px | screenshot + overflow check | FAIL | no horizontal scroll at 390, but Play, Download, Delete, Dismiss are 26x26 and Ready to deliver is 26 tall: global `:root:has(.pulse-hw) .pl-key[data-size="icon-sm"]` overrides max-sm:size-11. evidence/round1/U-07-panel-390-top.png, evidence/round1/U-07-panel-390-card.png |
| U-08 | Empty, loading and error states are shown (no files, skeleton, R2 not configured) | browser | PASS | empty: evidence/round1/U-08-empty-1280.png; client skeleton (aria-busy, "Loading your files"): evidence/round1/U-08-client-loading-skeleton-1280.png; R2 env unset: "File storage is not set up on this deployment yet." evidence/round1/U-08-r2-not-configured-1280.png. Staff card skeleton seen in code only |

### Email
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| E-01 | "Files ready" email renders with the studio name, accent and a readable button | unit test on the template; rendered copy opened in a browser, screenshot | FAIL | gold render readable (evidence/round1/E-01-files-ready-email.png), but the mockup's Coral #ff6b4a gets white ink at 2.82:1 (dark would be 6.15:1): readableEmailInk threshold lum > 0.45. evidence/round1/E-01-coral-accent-button-contrast.png |
| E-02 | "Pay to unlock" email renders with the amount and the Pay and unlock button | same | PASS | unit test green; evidence/round1/E-02-pay-to-unlock-email.png |
| E-03 | A hostile studio name, booking title or file name cannot inject HTML | unit test with `<script>` and `"><img>` in each field | PASS | convex/lib/emailTemplates/sessionDelivery.test.ts E-03 green |
| E-04 | A light accent gets dark button text and a dark accent gets light text | unit test over `#fdb913`, `#0a0a0a`, `#ffffff` | PASS | sessionDelivery.test.ts E-04 green over #fdb913, #ffffff, #0a0a0a (mid tones not covered, see E-01) |
| E-05 | The email goes out through the booking notification channel ("Studio via Pulse", replies to the studio) and is logged on the booking | convex-test: notification row with `sessionId`; staging: one real send to a test inbox | FAIL | notifications.deliver calls sendEmail with no from, so the sender is RESEND_FROM or "Pulse <support@studiopulse.tech>", not "Studio via Pulse". Reply-to the studio and the row with sessionId (G-01) are fine. Real staging send NOT RUN |
| E-06 | No em dashes in any new copy | grep the diff for U+2014 | PASS | 0 U+2014 in the diff; unit test E-06 green |

### Client page
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| C-01 | Unlocked: files listed, each downloads under its original name | browser on staging: Chromium, Firefox, WebKit | NOT RUN (needs staging: no file storage locally) | partial: Playwright with mocked R2, Chromium and Firefox saved 4 files under original names |
| C-02 | Locked: names and sizes shown, no download control, Pay button opens the booking's checkout | browser | PASS | names and sizes, 0 download buttons, Pay opens /book/myind-sound/checkout/<id> (200). evidence/round1/C-02-locked-1280.png, evidence/round1/C-02-locked-390.png |
| C-03 | Paying on another tab unlocks the open page without a reload | browser: two tabs, sandbox payment | PASS | payments:record on the booking; the open tab switched to "Your files are ready" with no reload. evidence/round1/C-03-unlocked-without-reload-1280.png |
| C-04 | Expired or turned off: one clear message, no file names | browser | PASS | "This link has expired", no studio or file names. evidence/round1/C-04-bad-token-1280.png, evidence/round1/C-04-turned-off-live-1280.png |
| C-05 | Audio files play inline; a zip does not offer a player | browser | NOT RUN (needs staging R2) | partial with mocked R2: Master.wav plays in Chromium, Firefox, WebKit; zip and pdf show no Play |
| C-06 | Download all starts every file | browser, 3 files | NOT RUN (needs staging R2) | partial with mocked R2: 4 R2 GETs; Chromium and Firefox got 4 downloads, WebKit no download events (inconclusive) |
| C-07 | Page wears the studio's logo and accent; a studio with no logo shows its name | browser, two studios | NOT RUN (logo path needs file storage) | accent live: evidence/round1/C-07-accent-cobalt-1280.png, evidence/round1/C-07-accent-coral-locked-1280.png; no logo shows initials and name |
| C-08 | Reachable signed out; not redirected to sign-in | `curl -sI` the route → 200 | PASS | curl -sI /delivery/x: 200, no redirect. Clerk off locally; middleware lists /delivery/(.*) as public |
| C-09 | `noindex` and `Referrer-Policy: no-referrer` are set; no third-party requests | `curl -sI`, network log | PASS | headers Referrer-Policy: no-referrer, X-Robots-Tag: noindex, nofollow; meta robots present; fresh context: only localhost:3311 and 127.0.0.1:3210 requests, 0 cookies |
| C-10 | 390 px, 200% text and reduced motion all hold | screenshots | PASS | scrollWidth 390, 0 animations, no clipping at 200% text. evidence/round1/C-10-unlocked-390-reduced.png, evidence/round1/C-10-unlocked-390-text200.png |
| C-11 | Cross-browser checker passes | `node tools/browser-check/check.mjs <staging url>` table | PENDING | |
| C-12 | Matches the mockup | `/pixel-perfect mockup.html <staging url>` → PASS | NOT RUN (/pixel-perfect on staging not run) | manual compare with mockup.html at 1280 and 390 locally: no CRITICAL or MAJOR, MINORs listed in the round 1 report |

### Performance
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| F-01 | Every new query uses an index and a bound; no `.collect()` on an unbounded table | review the diff | PASS | diff review: by_org_session take(200), by_asset first, by_session / by_token / by_org first; no unbounded collect |
| F-02 | File bytes never pass through Convex or a Netlify function | network log: PUT and GET go to R2 hosts only | NOT RUN (needs staging R2) | partial: minted PUT and GET URLs are R2 hosts only (pulse-private.<acct>.r2.cloudflarestorage.com, X-Amz-Expires=600) |
| F-03 | Client page ships no calendar or app-shell code | bundle report for `/delivery/[token]` | PASS | next build route-bundle-stats.json: /delivery/[token] 855,185 B first load vs /_not-found 825,875 B and /calendar 1,536,990 B; the 2 extra chunks are the page (19.5 KB) and the convex client lib (9.8 KB), no calendar or app-shell code |

### Regression
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| R-01 | Session file upload, list, download and delete behave as before | no tests exist today, so the builder first adds tests that pin today's behavior (`convex/sessionFiles.test.ts`), then they stay green | PASS | convex/sessionFiles.test.ts added in e231c65 before the behavior change, green |
| R-02 | `settlePayment` behaves as before when no delivery exists: amounts, hold confirmation, team alert, deposit and paid-in-full emails | no tests exist today, so the builder first adds tests that pin today's behavior (`convex/payments.test.ts`), then they stay green | PASS | convex/payments.test.ts added in e231c65 before the behavior change, green |
| R-03 | Portal, deliverables gate and library guest link tests pass unchanged | `npx vitest run convex/portal convex/files convex/mediaLibrary` | PASS | npx vitest run convex/portal convex/files convex/mediaLibrary: 4 files, 45 tests passed |
| R-04 | Mirror tests pass: no required field added to a mirrored table | `npx vitest run convex/money convex/lib/mirroredTables` | PASS | npx vitest run convex/money convex/lib/mirroredTables: 3 files, 96 tests passed |
| R-05 | `npm run check` | full run, counts recorded | PASS | no new failures: tsc exit 0; eslint 164 problems (53 errors, 111 warnings), identical on origin/develop, changed files clean; vitest 3 failed / 4149 passed (outreachCalls live consent, marketing/results, lib/agentScope), same as develop. The command exits non-zero on both branches |
| R-06 | `/security-review` on the diff: no open high or critical finding | report | PENDING | |
| R-07 | `/pentest` scan of staging for the new route and functions | report URL | PENDING | |

## Liability layer   (Risk: high · Legal review needed: yes, a public page that gates files on payment)
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| LL-01 | Privacy link on the client page | script LL-01 on staging | PASS | /privacy link present, 200 |
| LL-02 | Terms link on the client page | script LL-02 | PASS | /terms link present, 200 |
| LL-04 | Nothing non-essential loads before consent (the page loads no third parties at all) | script LL-04, fresh context | PASS | fresh context: 39 requests, all localhost:3311 plus the local Convex socket; no third party |
| LL-10 | Disclosure matches reality: no new vendor, cookie or form field | script LL-10 + `rd.md` data flow table | PASS | no inputs, 0 cookies, empty localStorage, no new vendor |
| LL-12 | Automated WCAG 2.2 AA scan of the client page, every state | axe via the script | PASS | axe-core 4.11.4 (wcag2a, 2aa, 21a, 21aa, 22aa): 0 violations on unlocked, locked, expired, dark and light |
| LL-13 | Manual pass: keyboard only, focus visible, contrast, labels, player controls | manual, both themes | PASS | logical tab order, focus-visible on every control, labels present. evidence/round1/LL-13-keyboard-focus-unlocked.png |
| LL-16 | Data map row added for the delivery link and download stats | `specs/liability/data-map.md` | PASS | specs/liability/data-map.md: rows for the token, open stats, download stats and releasedBy |
| LL-18 | Bucket private, signed URLs 10 minutes, every function checks the caller | A-01 to A-15 | PASS | A-01 to A-15 green; signed GET X-Amz-Expires=600 on the private bucket host |

## Decisions made without asking
1. Staff choose which files are Final. Working files are never shown to the client.
2. The email waits for both: files ready and balance zero. Whichever happens last sends it.
3. Ready with a balance sends one "pay to unlock" email. It is not repeated; the existing balance reminders carry on.
4. Owners and managers can "Send now anyway". Engineers cannot, and never see the amount.
5. Once unlocked, a delivery stays unlocked until staff turn it off or 30 days pass. Resend starts a new 30 days.
6. No per-studio on/off switch: nothing is sent until a team member taps Ready to deliver on a booking.
7. The files email replaces the plain "Paid in full" email when one payment does both.
8. "Download all" starts each file in turn. No server-side zip.
9. Uploads stay single-request (2 GB cap). Progress bar and cancel are added; resumable upload is a follow-up.
10. Web first. iPhone screens come after, and every new field is optional so the shipped app is unaffected.
11. No text message delivery in v1.
12. The full compliance interview was not run: no new vendor, no new personal data field, no AI in the path. The data flow table in `rd.md` stands in for it.

## Corrections after approval (2026-11-13, facts found while planning; none loosens a check)
- R-01, R-02: there were no existing tests for session files or `settlePayment`. The builder writes them first.
- E-05 and the mockup note said the email could go through the studio's Gmail. Booking emails all go through "Studio via Pulse" (Resend) with replies to the studio; this one does the same.
- Expired page: A-01 requires expired links to look exactly like unknown ones, so the expired page shows no studio name or logo. The mockup's expired state was changed to match.

## Added after round 1 (2026-11-13; new checks from review findings, none replaces an approved one)
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| G-15 | Ready first, then the balance invoice is paid online: released, one "files ready" email, no separate invoice receipt | convex-test through `settleInvoice` | PENDING | |
| G-16 | Balance invoice paid first, then Ready: released at once, no "pay to unlock" email | convex-test | PENDING | |
| G-17 | Marking the invoice paid by hand, or charging a saved card, releases the same way | convex-test | PENDING | |
| G-18 | A paid invoice smaller than what is owed, a void invoice and a draft invoice do not release | convex-test | PENDING | |
| G-19 | The locked page's Pay button goes to the open invoice when one exists, otherwise to checkout | convex-test on `page.payUrl` | PENDING | |
| G-20 | A non-finite or negative rate never releases | convex-test with NaN, Infinity, -1 | PENDING | |
| A-16 | Erasing a client turns their link off and the old link answers like an unknown one | convex-test | PENDING | |
| A-17 | A Final file moved to another booking is no longer Final | convex-test | PENDING | |
| A-18 | Resend within 2 minutes is refused | convex-test with fake timers | PENDING | |
| U-09 | Closing the session panel mid-upload: running and queued uploads all finish, and reopening shows them | unit tests on the upload store; browser on staging | PENDING | |
| C-13 | The date on the page matches the date in the email for a late-night session | convex-test: 11 PM Pacific | PENDING | |

- A-08 names `copyLink`; the function is `link`. Same check.
- R-05: `npm run check` already exits non-zero on `develop` (53 lint errors, 3 failing tests, one of them not in `docs/ENVIRONMENTS.md`). The bar for this branch is no new failure.
- E-05: booking emails come from "Pulse", not "Studio via Pulse" as the first correction said. The delivery emails are being changed to "Studio via Pulse" to match the approved mockup; other booking emails keep their sender.
