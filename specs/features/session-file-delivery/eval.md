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
| A-01 | Unknown, malformed, off and expired tokens all get the same `null` from `page` | convex-test: four tokens → identical result | PASS | convex/sessionDelivery.test.ts A-01 green (feature subset: 15 files, 183 tests passed, evidence/round2/vitest-feature-subset.log); browser: unknown, turned-off and erased tokens all render the same "This link has expired" page with no studio or file names (evidence/round2/C-04-gone-erased-chromium-1280.png) |
| A-02 | `fileUrl` refuses while the delivery is `awaiting_payment` | convex-test: locked delivery, valid token and version → error, no URL | PASS | convex/sessionDelivery.test.ts A-02 green: locked delivery throws, no URL, downloadCount stays 0 |
| A-03 | `fileUrl` refuses a file that is not marked Final | convex-test: same booking, working file → error | PASS | convex/sessionDelivery.test.ts A-03 green: working file on the same booking refused |
| A-04 | `fileUrl` refuses a Final file from another booking | convex-test: token of booking A, version of booking B (same studio) → error | PASS | convex/sessionDelivery.test.ts A-04 green: booking B version refused with booking A token |
| A-05 | `fileUrl` refuses a file from another studio | convex-test: second org's version → error | PASS | convex/sessionDelivery.test.ts A-05 green: second studio's version refused |
| A-06 | `fileUrl` refuses after Turn off link and after expiry | convex-test: `off`, then `expiresAt` in the past → error | PASS | convex/sessionDelivery.test.ts A-06 green: off and past expiresAt both refused |
| A-07 | `page` never returns a file URL or the R2 key | convex-test: deep scan of the result for `http` and the key prefix | PASS | convex/sessionDelivery.test.ts A-07 green: the fixture now has a studio logo; deep scan finds no file URL and no key prefix |
| A-08 | Signed-out caller cannot call any staff function | convex-test: `setFinal`, `status`, `markReady`, `releaseNow`, `turnOff`, `resend`, `copyLink` with no identity → refused | PASS | convex/sessionDelivery.test.ts A-08 green: every staff function refused signed out (copy link is the `link` query) |
| A-09 | Member of another studio cannot call any staff function on this booking | convex-test with a second org identity → refused | PASS | convex/sessionDelivery.test.ts A-09 green: second studio identity refused |
| A-10 | Engineer cannot `releaseNow` or `turnOff` | convex-test with an engineer identity → refused | PASS | convex/sessionDelivery.test.ts A-10 green: engineer refused on releaseNow and turnOff |
| A-11 | Engineer never receives the balance amount | convex-test: `status` as engineer → no cents field; browser as engineer: no dollar figure in the card | NOT RUN (browser half needs an engineer sign-in on staging; local demo mode signs in as owner only) | unit half: convex/sessionDelivery.test.ts "A-11 an engineer never receives the balance amount; an owner does" green |
| A-12 | Unmarking Final removes the file from the client page and from `fileUrl` at once | convex-test: release, unmark, `page` and `fileUrl` | PASS | convex/sessionDelivery.test.ts A-12 green: page and fileUrl drop the file at once |
| A-13 | Deleting a Final file removes it from the client page | convex-test: `sessionFiles.remove` then `page` | PASS | convex/sessionDelivery.test.ts A-13 green: sessionFiles.remove then page |
| A-14 | `fileUrl` is rate limited | convex-test: call 121 in an hour → the 121st refused | PASS | convex/sessionDelivery.test.ts A-14 green: 121st call in the hour refused |
| A-15 | The link token is not written to logs or returned to non-staff | grep the diff for `console.` near the token; convex-test: public results carry no token | PASS | convex/sessionDelivery.test.ts A-15 green; diff grep: the only new console call is console.error("[sessionDelivery] release failed:", err.message), no token |

### Trigger and gate
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| G-01 | Paid first, then Ready: released and one "files ready" email | convex-test: settle full, `markReady` → status `released`, one notification row to the client email | PASS | convex/sessionDelivery.test.ts G-01 green; local: Velvet Hours paid in full, then Ready 0.5 s later: one "Paid in full" at the payment, one delivery.ready at Ready |
| G-02 | Ready first, then paid: one "pay to unlock" email, then one "files ready" email when the payment settles | convex-test: `markReady` with a balance, then `settlePayment` balance | PASS | convex/sessionDelivery.test.ts G-02 green; local: Costa de Noche Ready (one delivery.pay), then payments:record full: one delivery.ready |
| G-03 | A deposit that leaves a balance does not release | convex-test: `markReady`, settle deposit → still `awaiting_payment`, no files email | PASS | convex/sessionDelivery.test.ts G-03 green |
| G-04 | Stripe webhook payment releases the same way as a manual one | convex-test through the webhook settle path (provider `stripe`) | PASS | convex/sessionDelivery.test.ts G-04 green, now through internal.billingWebhooks.handle with a Stripe event, not settlePayment directly |
| G-05 | A comp that leaves nothing owed releases | convex-test: `markReady`, `sessions.setComp` | PASS | convex/sessionDelivery.test.ts G-05 green |
| G-06 | Release happens once: a replayed webhook or second settle call sends no second email | convex-test: call `onBalanceSettled` twice → one notification | PASS | convex/sessionDelivery.test.ts G-06 green: onBalanceSettled twice gives one notification |
| G-07 | The settling payment sends one client email, not two | convex-test: ready then paid → files email present, plain "Paid in full" absent; with no delivery → "Paid in full" still sent | PASS | convex/sessionDelivery.test.ts G-07 green; local: Costa de Noche (payment) and Halflight (invoice) each got one delivery.ready and no "Paid in full" or invoice receipt |
| G-08 | `markReady` refuses with no Final files | convex-test → clear error, no row, no email | PASS | convex/sessionDelivery.test.ts G-08 green |
| G-09 | `markReady` refuses with no client email, and the card says how to fix it | convex-test; browser: "No email on file" state | PASS | convex/sessionDelivery.test.ts G-09 green; browser: card says "No email on file. Add one for Remy to deliver.", Ready to deliver disabled. evidence/round2/U-05-noemail-1280.png |
| G-10 | Owner or manager "Send now anyway" releases without payment and records who did it | convex-test: `releasedBy` is the member's name | PASS | convex/sessionDelivery.test.ts G-10 green: releasedBy is the member's name |
| G-11 | A released delivery stays released after the rate is raised | convex-test: release, raise `rateCents` → `page` still unlocked | PASS | convex/sessionDelivery.test.ts G-11 green |
| G-12 | Resend sends again to the booked email and starts a fresh 30 days | convex-test: `sendCount` + 1, `expiresAt` moved | PASS | convex/sessionDelivery.test.ts G-12 green |
| G-13 | Ready to deliver after Turn off issues a new token; the old link stays dead | convex-test | PASS | convex/sessionDelivery.test.ts G-13 green |
| G-14 | A cancelled booking cannot be marked ready and a delivery on it does not release | convex-test | PASS | convex/sessionDelivery.test.ts G-14 green; browser: cancelled booking card says "This booking was cancelled, so there is nothing to deliver." evidence/round2/U-05-cancelled-1280.png |

### Staff panel (web)
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| U-01 | Drop three files on the zone: all three upload with their own progress bars and land in the list | browser on staging, 3 fixtures (wav, zip, pdf) | NOT RUN (needs staging: local R2 is a dummy endpoint, so no upload can land) | |
| U-02 | Cancel one upload mid-way: it stops, the others finish, no orphan row | browser; then `media.myPending` is empty after the sweep window | NOT RUN (needs staging: local R2 is a dummy endpoint, so no upload can land) | |
| U-03 | A refused type (html, svg, exe) shows the reason and uploads nothing | browser | PASS | html, svg and exe each show "That file type is not supported. Upload audio, video, stems (zip), PDFs, images or text."; 0 R2 requests; mediaFiles 33 to 33. evidence/round2/U-03-refused-types-1280.png |
| U-04 | Final toggle works by mouse and keyboard and announces its state | browser + keyboard; `aria-pressed` or switch role | FAIL | mouse and Space toggle it, aria-pressed flips, focus ring visible; but after a keyboard toggle focus drops to the dialog (the button sets disabled while saving, session-extras.tsx Final button), so the new state is not announced and a second Space or Enter does nothing. evidence/round2/U-04-final-focus-unpressed.png, evidence/round2/U-04-final-keyboard-after-space.png |
| U-05 | Delivery card shows each state as in the mockup: none, waiting for payment, sent, off | screenshots vs `mockup.html` | FAIL | none state reads "2 files marked Final. The gets a download link by email once the booking is paid." for the client "The Midnight Tape": firstName() takes the first word of a band or company name ("The", "Crosstown"). Waiting, sent, off, cancelled and no-email states match the mockup apart from MINORs. evidence/round2/U-05-none-1280.png, evidence/round2/U-05-waiting-1280.png, evidence/round2/U-05-sent-1280.png, evidence/round2/U-05-off-1280.png |
| U-06 | Copy link copies the `/delivery/<token>` URL | browser | PASS | Chromium: toast "Link copied", clipboard http://localhost:3311/delivery/<64 hex>; clipboard denied: "Could not copy. Select the link and copy it." with the read-only link selected; Firefox: toast and clipboard correct; WebKit: toast shown, clipboard read-back blocked by WebKit. evidence/round2/U-06-chromium-granted.png, evidence/round2/U-06-chromium-denied.png |
| U-07 | Panel at 390 px: no horizontal scroll, targets at least 44 px | screenshot + overflow check | PASS | 390x844 Chromium: no horizontal scroll (scrollWidth 390); Link a song 71.8x44, Upload as new song 181.4x44, Dismiss 44x44, Cancel 44x44, Final 53x44, Download 44x44, Delete 44x44, Play 44x44, Resend 69.9x44, Copy link 108.2x44, Turn off link 111.2x44, Send now anyway 139.3x44, Ready to deliver 159.6x44. evidence/round2/U-07-panel-390-sent-card.png, evidence/round2/U-07-panel-390-uploads.png |
| U-08 | Empty, loading and error states are shown (no files, skeleton, R2 not configured) | browser | PASS | empty: "No files yet..." and "Mark at least one file Final to deliver." evidence/round2/U-08-empty-1280.png; client skeleton (aria-busy, "Loading your files") evidence/round2/U-08-client-loading-skeleton-1280.png; R2_ENDPOINT unset locally: row "File storage is not set up on this deployment yet.", 0 R2 requests evidence/round2/U-08-r2-not-configured-1280.png; dropped folder: "Folders cannot be uploaded. Zip it first." evidence/round2/U-08-folder-refused-1280.png. Staff card skeleton seen in code only |

### Email
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| E-01 | "Files ready" email renders with the studio name, accent and a readable button | unit test on the template; rendered copy opened in a browser, screenshot | PASS | rendered from the queued delivery.ready row with notificationEmailHtml: "Myind Sound" header, #fdb913 bar, button ink #1a1a1f on #fdb913 = 10.01:1; readableEmailInk: #ff6b4a gets #1a1a1f (6.15:1), #0f8f6f gets #000000 (5.18:1), #3b63e6 gets #ffffff (5.11:1). evidence/round2/E-01-files-ready-640.png, evidence/round2/E-01-files-ready.html |
| E-02 | "Pay to unlock" email renders with the amount and the Pay and unlock button | same | PASS | rendered from the queued delivery.pay row: "There is a $900.00 balance", button "Pay $900.00 and unlock" to the delivery page. evidence/round2/E-02-pay-to-unlock-640.png, evidence/round2/E-02-pay-to-unlock.html |
| E-03 | A hostile studio name, booking title or file name cannot inject HTML | unit test with `<script>` and `"><img>` in each field | PASS | convex/lib/emailTemplates/sessionDelivery.test.ts E-03 green |
| E-04 | A light accent gets dark button text and a dark accent gets light text | unit test over `#fdb913`, `#0a0a0a`, `#ffffff` | PASS | sessionDelivery.test.ts E-04 green; ratio check over 7 accents, lowest 4.69:1 (#777777 gets #000000) |
| E-05 | The email goes out through the booking notification channel ("Studio via Pulse", replies to the studio) and is logged on the booking | convex-test: notification row with `sessionId`; staging: one real send to a test inbox | NOT RUN (the real send to a test inbox needs staging) | unit half: convex/deliverySender.test.ts green: delivery.ready and delivery.pay go from "<Studio> via Pulse <support@studiopulse.tech>" with reply-to the studio, other kinds keep the default sender; the row carries sessionId (G-01) |
| E-06 | No em dashes in any new copy | grep the diff for U+2014 | PASS | 0 U+2014 in added lines; unit test E-06 green |

### Client page
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| C-01 | Unlocked: files listed, each downloads under its original name | browser on staging: Chromium, Firefox, WebKit | NOT RUN (needs staging R2) | partial with R2 mocked: Chromium and Firefox saved Session Notes.pdf, Midnight Drive - Stems.zip, Master.wav and Final Mix.wav under their original names (signed response-content-disposition). evidence/round2/C-01-unlocked-chromium-1280.png |
| C-02 | Locked: names and sizes shown, no download control, Pay button opens the booking's checkout | browser | PASS | Gravity Well locked in Chromium, Firefox, WebKit: names and sizes, 0 Download or Play controls, "Pay and unlock" goes to /book/myind-sound/checkout/<sessionId>. evidence/round2/C-02-locked-gravity-chromium-1280.png |
| C-03 | Paying on another tab unlocks the open page without a reload | browser: two tabs, sandbox payment | PASS | two tabs open on the locked page; run A payments:record (Costa de Noche) and run B invoices:setStatus paid by Zelle (Halflight): the open tab switched to "Your files are ready" with 0 navigations. evidence/round2/C-03-runA-payment-unlocked-no-reload.png, evidence/round2/C-03-runB-invoice-unlocked-no-reload.png |
| C-04 | Expired or turned off: one clear message, no file names | browser | PASS | unknown token, turned-off link and erased client's link, three engines: "This link has expired. Ask the studio to send a new one..." with no studio or file names. evidence/round2/C-04-gone-erased-chromium-1280.png |
| C-05 | Audio files play inline; a zip does not offer a player | browser | NOT RUN (needs staging R2) | partial with R2 mocked: Master.wav plays inline (currentTime 2.6 to 2.8 s, button becomes Pause) in Chromium, Firefox and WebKit; zip and pdf rows offer no Play. evidence/round2/C-05-playing-webkit-1280.png |
| C-06 | Download all starts every file | browser, 3 files | NOT RUN (needs staging R2 and real Safari) | partial with R2 mocked: Download all made one hidden iframe per file (4), the page URL did not change, 4 R2 GETs in all three engines; Chromium and Firefox reported 4 downloads, Playwright WebKit none; iframes gone after 2 min (Chromium clock); iPhone 13 WebKit shows "Tap a file to download it." and no Download all. evidence/round2/C-06-iphone-webkit-390.png |
| C-07 | Page wears the studio's logo and accent; a studio with no logo shows its name | browser, two studios | NOT RUN (logo half needs file storage) | accent changed live #fdb913 to #3b63e6 with no reload: --studio, button fill and white ink follow, then restored; no logo shows "MS" and the studio name. evidence/round2/C-07-accent-blue-1280.png |
| C-08 | Reachable signed out; not redirected to sign-in | `curl -sI` the route → 200 | PASS | curl -sI /delivery/<token>: 200, no Location; fresh signed-out context renders the page |
| C-09 | `noindex` and `Referrer-Policy: no-referrer` are set; no third-party requests | `curl -sI`, network log | PASS | headers Referrer-Policy: no-referrer and X-Robots-Tag: noindex, nofollow; meta robots and referrer set; fresh context: only localhost:3311, the local Convex socket and, on download or play, the R2 signed URL host; 0 cookies |
| C-10 | 390 px, 200% text and reduced motion all hold | screenshots | FAIL | 390 px: scrollWidth 390 on unlocked, locked and expired; reduced motion: 0 running animations; 200% text at 1280: no overflow. But 390 px with 200% text: each audio row's Play and Download buttons squeeze the file name to about one character per line (name column 58 px at 150%). evidence/round2/C-10-unlocked-390-text200-list.png |
| C-11 | Cross-browser checker passes | `node tools/browser-check/check.mjs <staging url>` table | PENDING | |
| C-12 | Matches the mockup | `/pixel-perfect mockup.html <staging url>` → PASS | NOT RUN (/pixel-perfect on staging not run) | manual compare with mockup.html view 3 at 1280 and 390 locally: layout, type and states match; MAJOR: band or company clients are greeted by first word ("Your files are finished, The"); MINORs in the round 2 report |

### Performance
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| F-01 | Every new query uses an index and a bound; no `.collect()` on an unbounded table | review the diff | FAIL | sessionDelivery queries are bounded (take(200), take(100), take(10), first), but the new erase code in convex/dataRights.ts:132-133 does two unbounded .collect() on collaboratorGrants, one over the whole studio (by_org) |
| F-02 | File bytes never pass through Convex or a Netlify function | network log: PUT and GET go to R2 hosts only | NOT RUN (needs staging R2) | partial: minted GET URL is on pulse-private.<acct>.r2.cloudflarestorage.com with X-Amz-Expires=600; client download and play requests went only to that host |
| F-03 | Client page ships no calendar or app-shell code | bundle report for `/delivery/[token]` | PASS | next build at fd9abae code: /delivery/[token] 857,865 B first load vs /_not-found 825,875 B and /calendar 1,543,895 B; the 2 extra chunks are the page (22.2 KB) and the Convex client (9.8 KB). evidence/round2/F-03-route-bundle-stats.json, evidence/round2/F-03-next-build.log |

### Regression
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| R-01 | Session file upload, list, download and delete behave as before | no tests exist today, so the builder first adds tests that pin today's behavior (`convex/sessionFiles.test.ts`), then they stay green | PASS | convex/sessionFiles.test.ts added in e231c65 before the behavior change, unchanged since, green |
| R-02 | `settlePayment` behaves as before when no delivery exists: amounts, hold confirmation, team alert, deposit and paid-in-full emails | no tests exist today, so the builder first adds tests that pin today's behavior (`convex/payments.test.ts`), then they stay green | PASS | convex/payments.test.ts added in e231c65 before the behavior change, unchanged since, green |
| R-03 | Portal, deliverables gate and library guest link tests pass unchanged | `npx vitest run convex/portal convex/files convex/mediaLibrary` | PASS | npx vitest run convex/portal convex/files convex/mediaLibrary: 4 files, 45 tests passed |
| R-04 | Mirror tests pass: no required field added to a mirrored table | `npx vitest run convex/money convex/lib/mirroredTables` | PASS | npx vitest run convex/money convex/lib/mirroredTables: 3 files, 96 tests passed |
| R-05 | `npm run check` | full run, counts recorded | PASS | no new failures: tsc exit 0 (also with --incremental false); eslint 164 problems (53 errors, 111 warnings) on HEAD and develop, the 64 changed files clean; vitest 3 failed / 4220 passed (develop: 3 failed / 4054 passed), the same three (outreachCalls, marketing/results, lib/agentScope). The command exits non-zero on both. evidence/round2/R-05-vitest-head.log, evidence/round2/R-05-vitest-develop.log |
| R-06 | `/security-review` on the diff: no open high or critical finding | report | PENDING | |
| R-07 | `/pentest` scan of staging for the new route and functions | report URL | PENDING | |

## Liability layer   (Risk: high · Legal review needed: yes, a public page that gates files on payment)
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| LL-01 | Privacy link on the client page | script LL-01 on staging | PASS | local: /privacy link on unlocked, locked and expired pages, 200 (staging script not run) |
| LL-02 | Terms link on the client page | script LL-02 | PASS | local: /terms link on every state, 200 (staging script not run) |
| LL-04 | Nothing non-essential loads before consent (the page loads no third parties at all) | script LL-04, fresh context | PASS | fresh context: 41 requests, hosts localhost:3311 and the local Convex socket only; 0 cookies, empty localStorage and sessionStorage |
| LL-10 | Disclosure matches reality: no new vendor, cookie or form field | script LL-10 + `rd.md` data flow table | PASS | 0 form fields, 0 cookies, no storage writes, no new vendor |
| LL-12 | Automated WCAG 2.2 AA scan of the client page, every state | axe via the script | FAIL | axe-core 4.11.4 (wcag2a, 2aa, 21a, 21aa, 22aa): dark theme 0 violations on unlocked, locked, expired and loading; light theme locked page: color-contrast on the "Balance due" pill, #e3a200 on #f3f1ea = 1.96:1. evidence/round2/LL-12-locked-light-contrast-node.png |
| LL-13 | Manual pass: keyboard only, focus visible, contrast, labels, player controls | manual, both themes | FAIL | keyboard order logical (Download all, each Download and Play, Privacy, Terms), every control labeled with a visible focus outline, Play becomes Pause. Light theme: the "Balance due" pill is 1.96:1 and the gold focus outline on Download all, Privacy and Terms is about 2.2:1 on white and 1.8:1 on the page. evidence/round2/LL-13-unlocked-light-keyboard-focus.png |
| LL-16 | Data map row added for the delivery link and download stats | `specs/liability/data-map.md` | PASS | specs/liability/data-map.md rows for the link token, open stats, download stats and releasedBy; no IP or user agent recorded |
| LL-18 | Bucket private, signed URLs 10 minutes, every function checks the caller | A-01 to A-15 | PASS | access tests A-01 to A-18 green; signed GET on the private bucket host with X-Amz-Expires=600 |

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
| G-15 | Ready first, then the balance invoice is paid online: released, one "files ready" email, no separate invoice receipt | convex-test through `settleInvoice` | PASS | convex/sessionDelivery.test.ts "G-15 Ready first, then the balance invoice is paid online" and "G-15 with no delivery ... the invoice receipt still goes" green |
| G-16 | Balance invoice paid first, then Ready: released at once, no "pay to unlock" email | convex-test | PASS | convex/sessionDelivery.test.ts G-16 green |
| G-17 | Marking the invoice paid by hand, or charging a saved card, releases the same way | convex-test | PASS | convex/sessionDelivery.test.ts G-17 by hand and saved card green; local: Halflight invoice set paid (Zelle) released with one delivery.ready |
| G-18 | A paid invoice smaller than what is owed, a void invoice and a draft invoice do not release | convex-test | PASS | convex/sessionDelivery.test.ts G-18 green: smaller paid, void, draft, other studio's invoice and cancelled booking |
| G-19 | The locked page's Pay button goes to the open invoice when one exists, otherwise to checkout | convex-test on `page.payUrl` | PASS | convex/sessionDelivery.test.ts G-19 green; browser: Halflight (sent invoice) Pay goes to /pay/invoice/<id>, Gravity Well (none) to /book/myind-sound/checkout/<id>. evidence/round2/C-02-locked-halflight-chromium-1280.png |
| G-20 | A non-finite or negative rate never releases | convex-test with NaN, Infinity, -1 | PASS | convex/sessionDelivery.test.ts G-20 green: NaN, Infinity, -Infinity, -1; setComp refuses a non-finite amount |
| A-16 | Erasing a client turns their link off and the old link answers like an unknown one | convex-test | PASS | convex/sessionDelivery.test.ts A-16 green; local: dataRights:eraseArtist on Mira Quartz, then page on her old token answers like an unknown token. evidence/round2/C-04-gone-erased-chromium-1280.png |
| A-17 | A Final file moved to another booking is no longer Final | convex-test | PASS | convex/sessionDelivery.test.ts A-17 green (moved loses Final, edited in place keeps it) |
| A-18 | Resend within 2 minutes is refused | convex-test with fake timers | PASS | convex/sessionDelivery.test.ts A-18 green with fake timers (119 s refused, 120 s allowed) |
| U-09 | Closing the session panel mid-upload: running and queued uploads all finish, and reopening shows them | unit tests on the upload store; browser on staging | NOT RUN (browser half needs staging R2) | unit half: src/lib/upload-manager.test.ts "keeps running with nobody watching, and a new watcher sees the rows" green |
| C-13 | The date on the page matches the date in the email for a late-night session | convex-test: 11 PM Pacific | PASS | convex/sessionDelivery.test.ts C-13 green (11 PM Pacific, "November 10"); browser: page "November 14, 2026" and email "on November 14" for Velvet Hours |

- A-08 names `copyLink`; the function is `link`. Same check.
- R-05: `npm run check` already exits non-zero on `develop` (53 lint errors, 3 failing tests, one of them not in `docs/ENVIRONMENTS.md`). The bar for this branch is no new failure.
- E-05: booking emails come from "Pulse", not "Studio via Pulse" as the first correction said. The delivery emails are being changed to "Studio via Pulse" to match the approved mockup; other booking emails keep their sender.

## Added after round 2 (2026-11-13)
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| G-21 | A Pay button is offered only when what it will charge equals the amount shown; otherwise there is no button | convex-test: scenarios (a) to (f) in plan Addendum 3, each comparing the target's charge with `page.balanceCents` | NOT RUN (added in d8fb2a2 while round 2 ran; the code at fd9abae has no change for it yet) | eval row added after verification started; nothing to verify yet |
| G-22 | An old booking whose deposit is recorded only by the `depositPaid` flag releases once its balance invoice is paid | convex-test | NOT RUN (added in d8fb2a2 while round 2 ran; the code at fd9abae has no change for it yet) | eval row added after verification started; nothing to verify yet |
| G-23 | A booking with hidden prices never shows the client an amount, on the page or in the email | convex-test + browser | NOT RUN (added in d8fb2a2 while round 2 ran; the code at fd9abae has no change for it yet) | eval row added after verification started; nothing to verify yet |
| C-14 | Locked page with no pay target: no Pay button, and the line telling the client the studio will send a way to pay | browser | NOT RUN (added in d8fb2a2 while round 2 ran; the code at fd9abae has no change for it yet) | eval row added after verification started; nothing to verify yet |

- Change to an approved behavior (Lawrence to confirm at the staging gate): the mockup's "Pay and unlock" button now appears only when its amount is certain. When the booking has an unsent draft invoice, hidden prices, or amounts that disagree, the client is told the studio will send a way to pay, and the team card tells staff to send the invoice. Reason: Pulse's checkout and its invoices each compute their own amount, and a button labeled $50 that charges $350 is worse than no button.
