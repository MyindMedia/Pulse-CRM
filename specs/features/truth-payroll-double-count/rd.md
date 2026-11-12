# RD: Payroll counts labour twice (truth fix, B5)

Status: draft, waiting for owner approval. No code has been written.
Audit ids covered: `staff-floor-gear-payroll-hourly-double-count`, `staff-floor-gear-payroll-open-entries`.
Code read on `develop` (2026-11-12).

## What Pulse says
"Pulse multiplies each person's hours by their pay rate, spreads salaries across the pay period and adds the engineer's share of each session. What it works out goes into your studio's costs." (`convex/lib/pricing.ts:998`)

## What actually happens today
**A. Hourly engineers are counted twice when session payouts are on.**
- Payroll pays every clocked hour for hourly staff: `memberPay` (`convex/lib/payroll.ts:41-60`), posted by `payroll.postToExpenses` as one `payroll` expense per person (`convex/payroll.ts:205-250`).
- With the studio's `autoPayouts` switch on (off by default, `convex/payouts.ts:64`), each finished session also queues a payout for the engineer. For an hourly engineer `payoutForSession` returns an "hourly" payout for the clocked hours inside the session (`convex/lib/payoutMath.ts:80-91`, hours from `clockedHours`, `convex/payouts.ts:82-84`). `markPaid` posts that as a second `payroll` expense (`convex/payouts.ts:202-230`).
- The comment in `convex/lib/payroll.ts:32-34` assumes only commission and points go through payouts. Hourly was added to payouts without removing it from payroll.

**B. Open time entries and posting a period twice.**
- An entry with no clock-out is counted up to "now" (`convex/lib/payroll.ts:52`), so a forgotten clock-out keeps adding paid hours.
- The correction tools exist on the server (`payroll.listEntries`, `addManualEntry`, `adjustEntry`, `removeEntry`, `convex/payroll.ts:114-203`) but nothing on the web app calls them (the payroll page uses only `getSchedule`, `setSchedule`, `summary`, `postToExpenses`). The iOS app is not in this repository, so I could not confirm the audit's note about the iOS sheet.
- `postToExpenses` writes a period tag into `notes` (`convex/payroll.ts:221`) but never checks it, so pressing "Post" twice (or once on web and once on iOS) doubles the period's labour cost.

## Who is hurt and how
- **The studio's books:** labour cost in the P&L is overstated (double for hourly engineers with payouts on; inflated by forgotten clock-outs; doubled by a second post). Margins and any tax or investor numbers built on them are wrong.
- **Workers and the studio's cash:** if the studio pays people from these numbers (payout marked paid and payroll run from the summary), an hourly engineer can be paid twice for the same hours, or paid for hours after a forgotten clock-out. The reverse (underpaid) does not happen here.

**Can it be happening in production now?** A: only for studios with `orgs.autoPayouts = true` and an hourly engineer. Check production `payouts` rows with `basis: "hourly"`; any with status `paid` overlap a payroll expense. B: check `expenses` with `category: "payroll"` and the same `notes` period tag twice for the same `memberId`, and `timeEntries` with no `clockOutAt` older than a day.

## Cause (verified on develop)
A: `convex/lib/payoutMath.ts:80-91` and `convex/payouts.ts:82-84` vs `convex/lib/payroll.ts:32-34`, `:57`. B: `convex/lib/payroll.ts:52`, `convex/payroll.ts:221-247`, no UI caller of the correction mutations. Audit descriptions are correct.

## Proposed fix
Three separately shippable parts, in this order:
1. **Duplicate-post guard (smallest, do first).** In `postToExpenses`, before inserting, look for an existing `payroll` expense for that `memberId` whose `notes` equal the period tag; skip it and return how many were skipped. Better: add a `payrollPeriod` field and index instead of matching on free-text notes (schema change, additive). Recommend the field.
2. **Hourly not paid through payouts.** In `payoutForSession`, return `null` for `payType: "hourly"` as for salary, and update `convex/lib/payoutMath.test.ts`. Payroll stays the one place clocked hours are paid. Before shipping, list queued or approved payouts with `basis: "hourly"` and decide what to do with them (decision 2).
3. **Timesheet panel for managers** on `src/app/(app)/payroll/page.tsx`, wired to the existing `listEntries`, `adjustEntry`, `addManualEntry`, `removeEntry`, with every change written to the activity log (who, before, after). `removeEntry` is a hard delete: recommend replacing it with a "void" flag so pay history is never lost. Also show open entries older than 12 hours as "Needs a clock-out time" and exclude them from `postToExpenses` until fixed (decision 3).

**One-time correction:** duplicate payroll expenses from double posts, and paid hourly payouts that overlap a posted payroll period, should be reviewed by each studio and voided by hand.

## Decisions for the owner
1. Who should be the one source of hourly pay? (a) payroll (recommended; it already handles all clocked hours); (b) payouts per session.
2. Existing queued/approved hourly payouts: (a) void them with a note (recommended); (b) let them be paid and skip those hours in payroll.
3. Open entries: (a) leave them counted to "now" but flag them (no wage change); (b) exclude them from posting until a manager closes them (recommended, so a forgotten clock-out never posts by itself); (c) auto-close at the scheduled shift end.
4. `removeEntry`: keep the hard delete, or replace with void (recommended).

## Interim step (no money logic)
Change the payroll page and the price-list text to say plainly: "Post each pay period once. If an engineer is paid hourly, leave session payouts off." Owner can also ask studios with `autoPayouts` on and hourly engineers to switch payouts off.

## Risk
- Part 2 changes what an hourly engineer is shown as owed per session; if a studio relied on per-session payouts to pay hourly staff, they would now need to run payroll. Communicate before shipping.
- Part 3 lets a manager change wages after the fact: needs an audit trail and the right role (`invoices.send` or a payroll capability).
- **Rollback:** each part reverts on its own. The guard and the payouts change touch no stored data; the timesheet panel only uses mutations that already exist.
