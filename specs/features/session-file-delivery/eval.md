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
| A-01 | Unknown, malformed, off and expired tokens all get the same `null` from `page` | convex-test: four tokens → identical result | PENDING | |
| A-02 | `fileUrl` refuses while the delivery is `awaiting_payment` | convex-test: locked delivery, valid token and version → error, no URL | PENDING | |
| A-03 | `fileUrl` refuses a file that is not marked Final | convex-test: same booking, working file → error | PENDING | |
| A-04 | `fileUrl` refuses a Final file from another booking | convex-test: token of booking A, version of booking B (same studio) → error | PENDING | |
| A-05 | `fileUrl` refuses a file from another studio | convex-test: second org's version → error | PENDING | |
| A-06 | `fileUrl` refuses after Turn off link and after expiry | convex-test: `off`, then `expiresAt` in the past → error | PENDING | |
| A-07 | `page` never returns a file URL or the R2 key | convex-test: deep scan of the result for `http` and the key prefix | PENDING | |
| A-08 | Signed-out caller cannot call any staff function | convex-test: `setFinal`, `status`, `markReady`, `releaseNow`, `turnOff`, `resend`, `copyLink` with no identity → refused | PENDING | |
| A-09 | Member of another studio cannot call any staff function on this booking | convex-test with a second org identity → refused | PENDING | |
| A-10 | Engineer cannot `releaseNow` or `turnOff` | convex-test with an engineer identity → refused | PENDING | |
| A-11 | Engineer never receives the balance amount | convex-test: `status` as engineer → no cents field; browser as engineer: no dollar figure in the card | PENDING | |
| A-12 | Unmarking Final removes the file from the client page and from `fileUrl` at once | convex-test: release, unmark, `page` and `fileUrl` | PENDING | |
| A-13 | Deleting a Final file removes it from the client page | convex-test: `sessionFiles.remove` then `page` | PENDING | |
| A-14 | `fileUrl` is rate limited | convex-test: call 121 in an hour → the 121st refused | PENDING | |
| A-15 | The link token is not written to logs or returned to non-staff | grep the diff for `console.` near the token; convex-test: public results carry no token | PENDING | |

### Trigger and gate
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| G-01 | Paid first, then Ready: released and one "files ready" email | convex-test: settle full, `markReady` → status `released`, one notification row to the client email | PENDING | |
| G-02 | Ready first, then paid: one "pay to unlock" email, then one "files ready" email when the payment settles | convex-test: `markReady` with a balance, then `settlePayment` balance | PENDING | |
| G-03 | A deposit that leaves a balance does not release | convex-test: `markReady`, settle deposit → still `awaiting_payment`, no files email | PENDING | |
| G-04 | Stripe webhook payment releases the same way as a manual one | convex-test through the webhook settle path (provider `stripe`) | PENDING | |
| G-05 | A comp that leaves nothing owed releases | convex-test: `markReady`, `sessions.setComp` | PENDING | |
| G-06 | Release happens once: a replayed webhook or second settle call sends no second email | convex-test: call `onBalanceSettled` twice → one notification | PENDING | |
| G-07 | The settling payment sends one client email, not two | convex-test: ready then paid → files email present, plain "Paid in full" absent; with no delivery → "Paid in full" still sent | PENDING | |
| G-08 | `markReady` refuses with no Final files | convex-test → clear error, no row, no email | PENDING | |
| G-09 | `markReady` refuses with no client email, and the card says how to fix it | convex-test; browser: "No email on file" state | PENDING | |
| G-10 | Owner or manager "Send now anyway" releases without payment and records who did it | convex-test: `releasedBy` is the member's name | PENDING | |
| G-11 | A released delivery stays released after the rate is raised | convex-test: release, raise `rateCents` → `page` still unlocked | PENDING | |
| G-12 | Resend sends again to the booked email and starts a fresh 30 days | convex-test: `sendCount` + 1, `expiresAt` moved | PENDING | |
| G-13 | Ready to deliver after Turn off issues a new token; the old link stays dead | convex-test | PENDING | |
| G-14 | A cancelled booking cannot be marked ready and a delivery on it does not release | convex-test | PENDING | |

### Staff panel (web)
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| U-01 | Drop three files on the zone: all three upload with their own progress bars and land in the list | browser on staging, 3 fixtures (wav, zip, pdf) | PENDING | |
| U-02 | Cancel one upload mid-way: it stops, the others finish, no orphan row | browser; then `media.myPending` is empty after the sweep window | PENDING | |
| U-03 | A refused type (html, svg, exe) shows the reason and uploads nothing | browser | PENDING | |
| U-04 | Final toggle works by mouse and keyboard and announces its state | browser + keyboard; `aria-pressed` or switch role | PENDING | |
| U-05 | Delivery card shows each state as in the mockup: none, waiting for payment, sent, off | screenshots vs `mockup.html` | PENDING | |
| U-06 | Copy link copies the `/delivery/<token>` URL | browser | PENDING | |
| U-07 | Panel at 390 px: no horizontal scroll, targets at least 44 px | screenshot + overflow check | PENDING | |
| U-08 | Empty, loading and error states are shown (no files, skeleton, R2 not configured) | browser | PENDING | |

### Email
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| E-01 | "Files ready" email renders with the studio name, accent and a readable button | unit test on the template; rendered copy opened in a browser, screenshot | PENDING | |
| E-02 | "Pay to unlock" email renders with the amount and the Pay and unlock button | same | PENDING | |
| E-03 | A hostile studio name, booking title or file name cannot inject HTML | unit test with `<script>` and `"><img>` in each field | PENDING | |
| E-04 | A light accent gets dark button text and a dark accent gets light text | unit test over `#fdb913`, `#0a0a0a`, `#ffffff` | PENDING | |
| E-05 | The email goes out through the booking notification channel ("Studio via Pulse", replies to the studio) and is logged on the booking | convex-test: notification row with `sessionId`; staging: one real send to a test inbox | PENDING | |
| E-06 | No em dashes in any new copy | grep the diff for U+2014 | PENDING | |

### Client page
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| C-01 | Unlocked: files listed, each downloads under its original name | browser on staging: Chromium, Firefox, WebKit | PENDING | |
| C-02 | Locked: names and sizes shown, no download control, Pay button opens the booking's checkout | browser | PENDING | |
| C-03 | Paying on another tab unlocks the open page without a reload | browser: two tabs, sandbox payment | PENDING | |
| C-04 | Expired or turned off: one clear message, no file names | browser | PENDING | |
| C-05 | Audio files play inline; a zip does not offer a player | browser | PENDING | |
| C-06 | Download all starts every file | browser, 3 files | PENDING | |
| C-07 | Page wears the studio's logo and accent; a studio with no logo shows its name | browser, two studios | PENDING | |
| C-08 | Reachable signed out; not redirected to sign-in | `curl -sI` the route → 200 | PENDING | |
| C-09 | `noindex` and `Referrer-Policy: no-referrer` are set; no third-party requests | `curl -sI`, network log | PENDING | |
| C-10 | 390 px, 200% text and reduced motion all hold | screenshots | PENDING | |
| C-11 | Cross-browser checker passes | `node tools/browser-check/check.mjs <staging url>` table | PENDING | |
| C-12 | Matches the mockup | `/pixel-perfect mockup.html <staging url>` → PASS | PENDING | |

### Performance
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| F-01 | Every new query uses an index and a bound; no `.collect()` on an unbounded table | review the diff | PENDING | |
| F-02 | File bytes never pass through Convex or a Netlify function | network log: PUT and GET go to R2 hosts only | PENDING | |
| F-03 | Client page ships no calendar or app-shell code | bundle report for `/delivery/[token]` | PENDING | |

### Regression
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| R-01 | Session file upload, list, download and delete behave as before | no tests exist today, so the builder first adds tests that pin today's behavior (`convex/sessionFiles.test.ts`), then they stay green | PENDING | |
| R-02 | `settlePayment` behaves as before when no delivery exists: amounts, hold confirmation, team alert, deposit and paid-in-full emails | no tests exist today, so the builder first adds tests that pin today's behavior (`convex/payments.test.ts`), then they stay green | PENDING | |
| R-03 | Portal, deliverables gate and library guest link tests pass unchanged | `npx vitest run convex/portal convex/files convex/mediaLibrary` | PENDING | |
| R-04 | Mirror tests pass: no required field added to a mirrored table | `npx vitest run convex/money convex/lib/mirroredTables` | PENDING | |
| R-05 | `npm run check` | full run, counts recorded | PENDING | |
| R-06 | `/security-review` on the diff: no open high or critical finding | report | PENDING | |
| R-07 | `/pentest` scan of staging for the new route and functions | report URL | PENDING | |

## Liability layer   (Risk: high · Legal review needed: yes, a public page that gates files on payment)
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| LL-01 | Privacy link on the client page | script LL-01 on staging | PENDING | |
| LL-02 | Terms link on the client page | script LL-02 | PENDING | |
| LL-04 | Nothing non-essential loads before consent (the page loads no third parties at all) | script LL-04, fresh context | PENDING | |
| LL-10 | Disclosure matches reality: no new vendor, cookie or form field | script LL-10 + `rd.md` data flow table | PENDING | |
| LL-12 | Automated WCAG 2.2 AA scan of the client page, every state | axe via the script | PENDING | |
| LL-13 | Manual pass: keyboard only, focus visible, contrast, labels, player controls | manual, both themes | PENDING | |
| LL-16 | Data map row added for the delivery link and download stats | `specs/liability/data-map.md` | PENDING | |
| LL-18 | Bucket private, signed URLs 10 minutes, every function checks the caller | A-01 to A-15 | PENDING | |

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
