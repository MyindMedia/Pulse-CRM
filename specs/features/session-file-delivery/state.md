# State: session file delivery

Eval approved by Lawrence 2026-11-13. Branch `feat/session-file-delivery`, worktree `~/Dev/pulse-session-delivery`, 49 commits ahead of `develop`. Nothing pushed.

## Rounds
| Round | Verifier | Review | Fixes |
|---|---|---|---|
| 1 | 58 PASS, 3 FAIL, 9 NOT RUN, 3 PENDING of 73 (`b8ea7a4`) | code: 1 critical, 4 major, 8 minor; security: 2 medium, 8 low | Addendum 2: F2-01 to F2-14, F2-20 to F2-29 |
| 2 | 64 PASS, 6 FAIL, 15 NOT RUN, 3 PENDING of 88 (`56887fc`) | 3 major, 1 minor, 2 unconfirmed, all on the Pay button amount | Addendum 3: R3-01 to R3-07, V3-01 to V3-06 |
| 3 | running | running (new diff `d0f4dc9..HEAD`, payment code equivalence first) | |

My gate after round 3 fixes: `tsc` exit 0; vitest 4292 pass, 3 fail (the same three fail on `develop`).

Cap is 5 rounds. Round 3 replaced the Pay button approach with one rule after two rounds of amount mismatches; if round 3 review still finds a wrong-amount path, stop patching and take the Pay button off the locked page for v1.

## Open after round 3 fixes
- Deliberately not fixed: S-09 (120 per hour download limit, approved number), S-06 (booking id in pay links, existing behavior).
- Waits for staging: S-02 (does the sign-in script ever see the page address), real uploads and downloads, real email send, engineer sign-in, real iPhone download, pixel-perfect, cross-browser checker, pentest.

## Needs Lawrence
1. Yes to merge into `develop` (staging) once round 3 passes locally.
2. Confirm the change to the approved mockup: the Pay button shows only when its amount is certain; otherwise "the studio will send you a way to pay" (alternative: Ready to deliver sends the draft invoice automatically).
3. No-show bookings: refuse Ready to deliver, or leave as is (locked unless Send now anyway)?
4. "Ship it" for production after staging checks.

## Found along the way, outside this feature (not fixed)
- Engineers can read dollar amounts in the booking message log (deposit and paid-in-full emails).
- Client portal, song page and Today screen ignore paid invoices when showing a balance.
- Other booking emails come from "Pulse", not "Studio via Pulse".
- 13 places build a studio logo link in a way that would sign a private-bucket file; root cause is that logo uploads do not check the bucket.
- A draft balance invoice stays live after the client pays at checkout (double billing if staff then send it).
- `npm run check` exits non-zero on `develop` (53 lint errors, 3 failing tests, one not listed in `docs/ENVIRONMENTS.md`).
