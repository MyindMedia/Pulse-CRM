# Eval: Interns told to stay clocked in, then not paid for it
Status: built on fix/high-staff-wages (H3), recommended options 1(a) and 2(a); round 2 fix H208-07 added as R2-07; 12 PASS, 0 NOT RUN
Risk: High. It changes recorded working hours, which feed wages. If it is wrong, interns are underpaid or overpaid, or a manager's approval is lost.
RD: ./rd.md

## Must not break
- Intern 4-hour prompt, manager approve and deny by SMS and in the app
- Overtime prompts for non-interns (`otStatus`), clock in and out by SMS and web
- Payroll summary and posting
- SMS opt-outs
- `npx tsc --noEmit`, `npm run lint`, vitest, with only the known failures

## Checks
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| U-01 | EXTEND reply gets the new "clock out now" text | convex-test on the SMS inbound flow → queued body equals new template | PASS | convex/internClockOut.test.ts "U-01 EXTEND gets the 'clock out now' text, never 'stay clocked in'" |
| U-02 | No manager with a phone: intern is told to ask in person | convex-test with no manager phones | PASS | convex/internClockOut.test.ts "U-02 no manager with a phone: the intern is told to ask in person" |
| U-03 | Manager approves in time: entry stays open, intern texted approval | convex-test | PASS | convex/internClockOut.test.ts "U-03 manager approves in time: entry stays open and the intern is told", plus "U-03b approval after the intern clocked out (as told) says they can clock back in" |
| U-04 | Manager denies: intern texted to clock out, entry unchanged until they do | convex-test | PASS | convex/internClockOut.test.ts "U-04 manager denies: intern texted to clock out, entry unchanged until they do" |
| U-05 | Timeout closes the entry at the approval window end, not clock-in + 4h | convex-test: clock in, EXTEND at 4h05, advance 2h, sweep → `clockOutAt` = prompt `expiresAt` | PASS | convex/internClockOut.test.ts "U-05 closes the entry at the approval window end, not clock-in + 4h" |
| U-06 | Timeout never sets a clock-out in the future | convex-test with a late `expiresAt` | PASS | convex/internClockOut.test.ts "U-06 never sets a clock-out in the future, never before the 4-hour mark" and "U-06b a prompt with a late expiry ..." |
| U-07 | Sweep running twice does not change the entry twice or text twice | convex-test | PASS | convex/internClockOut.test.ts "U-07 a second sweep (or a duplicate run) changes nothing and texts nobody again" and "U-07b an approval landing between the sweep's read and its write wins" |
| U-08 | Intern who clocked out themselves before the timeout is untouched | convex-test | PASS | convex/internClockOut.test.ts "U-08 an intern who clocked out themselves before the timeout is untouched" |
| U-09 | A reply from another studio's number or a stranger cannot extend an entry | convex-test: EXTEND from an unknown phone → no change | PASS | convex/internClockOut.test.ts "U-09 EXTEND from a stranger, or from another studio's intern, changes nothing" |
| U-10 | Payroll summary reflects the new clock-out | convex-test: summary hours after timeout | PASS | convex/internClockOut.test.ts "U-10 the payroll summary pays the time up to the new clock-out" |
| U-11 | Must-not-break list passes | Full suite | PASS | After round 2: `npx vitest run` on fix/high-staff-wages: 4119 passed, 3 failed (only the known agentScope, marketing/results, outreachCalls live-call cases); `npx tsc --noEmit` clean; lint 164 problems (unchanged) |

## Round 2 checks (review findings, 2026-11-12)
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| R2-07 | A denied intern still clocked in a reply window after the denial is texted again once, the managers are told, and the clock is not cut; nothing is sent if they clocked out; entries denied before the denial time was recorded are followed up (H208-07) | convex-test | PASS | convex/internClockOut.test.ts "still clocked in a reply window after the denial: intern and managers are texted again, once; the clock is not cut", "an intern who clocked out after the denial gets no follow-up", "an entry denied before the denial time was recorded is followed up on the next sweep" |
