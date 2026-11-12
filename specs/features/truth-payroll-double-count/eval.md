# Eval: Payroll counts labour twice
Status: built on fix/high-staff-wages (H3), recommended options 1(a), 2(a) as a report, 3(b), 4 (void); 12 PASS, 2 NOT RUN
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
| U-01 | Posting the same period twice creates no second expense | convex-test: `postToExpenses` twice → one `payroll` expense per member, second call reports skipped | PASS | convex/payrollOnce.test.ts "U-01 posting the same period twice creates no second expense and says it skipped", "U-01b two posts sent at the same moment ... still make one", "U-01c a period posted before this fix ... is not posted again" |
| U-02 | Double click on "Post" creates one set of expenses | Playwright on staging: click twice fast → one set | NOT RUN | Needs a browser on staging. Owner: on the staging payroll page, double-click "Post to expenses" and check Expenses shows one payroll row per teammate. (The server side of a double post is covered by U-01b, which PASSES.) |
| U-03 | A different period still posts | convex-test: next period → new rows | PASS | convex/payrollOnce.test.ts "U-03 a different period still posts" |
| U-04 | Hourly engineer gets no per-session payout | `payoutMath.test.ts`: `payType: "hourly"` → `null` | PASS | convex/payouts.test.ts "U-04 never pays an hourly teammate per session: payroll already pays their clocked hours" (the payout math tests live in payouts.test.ts; there is no payoutMath.test.ts) |
| U-05 | Commission and points payouts unchanged | Existing `payoutMath.test.ts` cases pass | PASS | convex/payouts.test.ts existing "commission takes a percentage of the session rate", "points multiply the org's point value" and the queueing/approve/pay cases, plus "U-05 commission and points engineers still get their session payout" |
| U-06 | Hourly engineer's labour cost appears once in the P&L for a period with sessions | convex-test: clock hours, finish session with `autoPayouts` on, post payroll → one expense | PASS | convex/payouts.test.ts "U-06 an hourly engineer's labour lands in the P&L once: payroll, not a session payout" |
| U-07 | Open entry older than 12h is flagged and handled per decision 3 | convex-test | PASS | convex/payrollOnce.test.ts "U-07 an open entry older than 12h is flagged, left out of pay, and holds back that teammate's post" (decision 3(b)) |
| U-08 | Manager can fix a clock-out time; the change is logged with before and after | convex-test: `adjustEntry` → activity row | PASS | convex/payrollOnce.test.ts "U-08 a manager fixes a clock-out time and the change is logged with before and after" |
| U-09 | Engineer cannot adjust their own or others' entries | convex-test with engineer identity → FORBIDDEN | PASS | convex/payrollOnce.test.ts "U-09 an engineer cannot add, adjust or remove entries, their own or anyone's" |
| U-10 | Signed-out caller cannot read or change entries | convex-test → error / null | PASS | convex/payrollOnce.test.ts "U-10 a signed-out caller cannot read or change entries" |
| U-11 | Another studio's entry id is refused | convex-test: org A manager, org B entry → "Time entry not found." | PASS | convex/payrollOnce.test.ts "U-11 another studio's entry id is refused" |
| U-12 | Removing or voiding an entry keeps a record (decision 4) | convex-test | PASS | convex/payrollOnce.test.ts "U-12 removing an entry voids it: kept on record, logged, out of pay, and a second remove does nothing", "U-12b voiding a running clock stops it ..." (decision 4: void) |
| U-13 | Timesheet panel works on staging at 390 px and 1280 px | Playwright screenshots | NOT RUN | Needs the deployed app. Owner: open /payroll on staging at 390 px and 1280 px wide as an owner, check the Timesheet panel lists punches, Edit / Add entry / Remove dialogs open and fit, and an engineer sees no edit buttons. |
| U-14 | Must-not-break list passes | Full suite | PASS | `npx vitest run` on fix/high-staff-wages: 4090 passed, 3 failed (only the known agentScope, marketing/results, outreachCalls live-call cases); `npx tsc --noEmit` clean; lint 164 problems (unchanged) |
