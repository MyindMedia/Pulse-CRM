# Eval: Payroll counts labour twice
Status: draft, waiting for owner approval
Risk: High. It changes how wages are calculated and what lands in the P&L. If it is wrong, a worker is paid twice or not at all for real hours, or a studio's labour cost is wrong.
RD: ./rd.md

## Must not break
- Payroll summary for hourly and salary staff, pay schedule settings
- Session payouts for commission and points engineers: queue, approve, mark paid, P&L expense
- Clock in / clock out on web and by SMS, overtime and intern prompts
- Expenses list and P&L totals
- `npx tsc --noEmit`, `npm run lint`, vitest, with only the known failures

## Checks
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| U-01 | Posting the same period twice creates no second expense | convex-test: `postToExpenses` twice → one `payroll` expense per member, second call reports skipped | PENDING | |
| U-02 | Double click on "Post" creates one set of expenses | Playwright on staging: click twice fast → one set | PENDING | |
| U-03 | A different period still posts | convex-test: next period → new rows | PENDING | |
| U-04 | Hourly engineer gets no per-session payout | `payoutMath.test.ts`: `payType: "hourly"` → `null` | PENDING | |
| U-05 | Commission and points payouts unchanged | Existing `payoutMath.test.ts` cases pass | PENDING | |
| U-06 | Hourly engineer's labour cost appears once in the P&L for a period with sessions | convex-test: clock hours, finish session with `autoPayouts` on, post payroll → one expense | PENDING | |
| U-07 | Open entry older than 12h is flagged and handled per decision 3 | convex-test | PENDING | |
| U-08 | Manager can fix a clock-out time; the change is logged with before and after | convex-test: `adjustEntry` → activity row | PENDING | |
| U-09 | Engineer cannot adjust their own or others' entries | convex-test with engineer identity → FORBIDDEN | PENDING | |
| U-10 | Signed-out caller cannot read or change entries | convex-test → error / null | PENDING | |
| U-11 | Another studio's entry id is refused | convex-test: org A manager, org B entry → "Time entry not found." | PENDING | |
| U-12 | Removing or voiding an entry keeps a record (decision 4) | convex-test | PENDING | |
| U-13 | Timesheet panel works on staging at 390 px and 1280 px | Playwright screenshots | PENDING | |
| U-14 | Must-not-break list passes | Full suite | PENDING | |
