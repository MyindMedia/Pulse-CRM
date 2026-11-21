# Eval: Interns told to stay clocked in, then not paid for it
Status: draft, waiting for owner approval
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
| U-01 | EXTEND reply gets the new "clock out now" text | convex-test on the SMS inbound flow → queued body equals new template | PENDING | |
| U-02 | No manager with a phone: intern is told to ask in person | convex-test with no manager phones | PENDING | |
| U-03 | Manager approves in time: entry stays open, intern texted approval | convex-test | PENDING | |
| U-04 | Manager denies: intern texted to clock out, entry unchanged until they do | convex-test | PENDING | |
| U-05 | Timeout closes the entry at the approval window end, not clock-in + 4h | convex-test: clock in, EXTEND at 4h05, advance 2h, sweep → `clockOutAt` = prompt `expiresAt` | PENDING | |
| U-06 | Timeout never sets a clock-out in the future | convex-test with a late `expiresAt` | PENDING | |
| U-07 | Sweep running twice does not change the entry twice or text twice | convex-test | PENDING | |
| U-08 | Intern who clocked out themselves before the timeout is untouched | convex-test | PENDING | |
| U-09 | A reply from another studio's number or a stranger cannot extend an entry | convex-test: EXTEND from an unknown phone → no change | PENDING | |
| U-10 | Payroll summary reflects the new clock-out | convex-test: summary hours after timeout | PENDING | |
| U-11 | Must-not-break list passes | Full suite | PENDING | |
