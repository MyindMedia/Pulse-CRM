# State: session file delivery

Eval approved by Lawrence 2026-11-13. Branch `feat/session-file-delivery`, worktree `~/Dev/pulse-session-delivery`, 78 commits ahead of `develop`. Nothing pushed, nothing deployed. **Stopped at the 5-round cap; waiting for Lawrence.**

## Rounds
| Round | Verifier | Review |
|---|---|---|
| 1 | 58 PASS, 3 FAIL, 9 NOT RUN, 3 PENDING of 73 (`b8ea7a4`) | code: 1 critical (paying by invoice never unlocked), 4 major, 8 minor; security: 2 medium, 8 low |
| 2 | 64 PASS, 6 FAIL, 15 NOT RUN, 3 PENDING of 88 (`56887fc`) | 3 major, 1 minor: Pay button could charge a different amount than shown |
| 3 | 72 PASS, 2 FAIL, 11 NOT RUN, 3 PENDING (`cb16fb1`) | 2 major, 5 minor: staff advice, no-show |
| 4 | 73 PASS, 1 FAIL, 11 NOT RUN, 3 PENDING (`d71d4bf`) | 2 major, 2 minor: "pay the invoice the studio sent you" pointed at wrong-amount invoices (my rule) |
| 5 (final) | 72 PASS, 2 FAIL, 11 NOT RUN, 3 PENDING (`c64d707`) | 1 major, 2 minor |

Gate on the final code (`01c745e`): `tsc` exit 0; vitest 4367 pass, 3 fail (the same three fail on `develop`).

Held in every round since round 3, by reviewers and verifiers reading `git diff origin/develop..HEAD`: the checkout, invoice and saved-card charge math is identical to `develop`; no Pay button is offered whose charge differs from the amount shown; nothing releases while money is owed; no amount or invoice number reaches a caller without money sight.

## Open after round 5 (not patched: cap reached)
| ID | Severity | What | Fix direction |
|---|---|---|---|
| R5x-01 | Major | Team card says "A balance invoice is drafted but not sent. Send it" without knowing the draft's amount ($700 draft, $500 owed) | Return draft number and amount in `payFacts`; say "send it" only when exactly one draft equals owed, else state the facts |
| U-05 FAIL | Medium | Waiting card says "was emailed a pay link" / "about the balance" from today's pay options, not from the email that was sent | Store which email went out on the delivery row, or use one neutral phrase ("was emailed that the files are ready") |
| C-10 FAIL | Low | 390 px with 200% text: the audio waveform's 64 bars need 316 px in a 283 px row, widening it; name and controls run past the content edge (still inside the list, nothing cut off) | Let the waveform shrink (`min-width: 0`, fewer bars or `overflow: hidden`) |
| R5x-02 | Minor | `status.onlinePay` / `onlinePayReason` tell a caller without money sight that an invoice exists (no amount or number) | Return the reason only with money sight; collapse `onlinePay` to none / not none |
| R5x-03 | Minor | "Payment received" on the client page when the booking was comped to $0 and nothing was paid | "Nothing is owed" wording |
| note | Minor | With no pay target, the pay email has no link to the download page | Add the link as plain text or a secondary button |

## Not run locally (11) and pending (3): need staging (`develop`)
U-01, U-02, U-09 browser half, C-01, C-05, C-06, F-02, C-07 logo half (real R2); A-11 browser half (engineer sign-in); E-05 (one real send); C-12 (`/pixel-perfect`). Pending: C-11 (cross-browser checker), R-06 (`/security-review`: two review passes done by agents, the skill itself not run), R-07 (`/pentest`). Also on staging: S-02 (does the sign-in script ever see the page address), single-file download on a real iPhone.

## Decided without Lawrence (he was away), all reversible
- Pay button only when its charge is exactly the amount shown; otherwise no button and "the studio will be in touch about payment".
- No-show bookings cannot be delivered, same as cancelled.
- Hidden-prices bookings never show an amount or a Pay button on the page.
- No button when the studio cannot take cards online.

## Needs Lawrence
1. Go or no-go on one short pass for the six open items (wording, one field, the waveform width; no money logic).
2. Yes to merge into `develop` (staging). Nothing is pushed.
3. "Ship it" for production after staging.

## Found along the way, outside this feature (not fixed)
- Pulse keeps two payment records. Checkout charges `rate - amountPaidCents` and ignores paid invoices; the client portal, song page, Today screen and the booking panel's "Paid / balance" row do the same.
- A draft balance invoice stays live after the client pays at checkout (double billing if staff then send it).
- The Stripe webhook records the booking balance when it arrives, not what Stripe charged, and swallows "already paid in full".
- Engineers can read dollar amounts in the booking message log (deposit and paid-in-full emails).
- 13 places build a studio logo link in a way that would sign a private-bucket file.
- Other booking emails come from "Pulse", not "Studio via Pulse".
- Client erasure revokes no guest grants on `develop`; this branch revokes them, except ones whose email differs only by letter case.
- The checkout page shows a deposit larger than it charges when a discount drops the rate below the deposit.
- `npm run check` exits non-zero on `develop` (53 lint errors, 3 failing tests, one not in `docs/ENVIRONMENTS.md`).
- Public client pages are always dark; they follow Pulse's theme setting, not the client's device.
