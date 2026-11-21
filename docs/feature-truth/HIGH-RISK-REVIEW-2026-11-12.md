# Review of the high-risk pull requests (2026-11-12)

Nine reviewers read pull requests #205 to #210 against `integration/truth-fixes`, and a skeptic per pull request re-checked every finding. All 50 findings were confirmed: 6 critical, 24 major, 20 minor. Several describe the same defect from two angles. Full text, with the case that triggers each one and the fix to apply, is in `high-risk-review-2026-11-12.json` (key `confirmed`, ids `H<pr>-<nn>`).

None of these pull requests may merge until its findings are fixed and re-reviewed.

| id | PR | severity | where | finding |
|---|---|---|---|---|
| H205-01 | #205 | critical | `convex/sessions.ts` | Auto-charge ignores everything the client paid beyond the deposit and charges the fee again on top of a full payment |
| H205-02 | #205 | critical | `convex/sessions.ts` | A cancellation by staff inside the window charges the client's card automatically, including when the studio cancels |
| H205-03 | #205 | critical | `convex/sessions.ts` | A client who prepaid the full session is charged a no-show fee on top of the full payment |
| H205-04 | #205 | critical | `convex/sessions.ts` | Any cancel inside the window, including one the studio makes or approves late, charges the client's card |
| H205-05 | #205 | major | `convex/booking.ts` | With the switch on, checkout can break for clients whose stored Stripe customer is on a previous connected account |
| H205-06 | #205 | major | `convex/cardOnFile.ts` | Checkout reuses a stored Stripe customer id without checking it exists on the studio's current connected account, so clients cannot pay |
| H205-07 | #205 | major | `convex/sessions.ts` | A no-show is charged within a second of the click, even for a future session, with no undo |
| H205-08 | #205 | minor | `convex/cardOnFile.ts` | An invoice stuck in 'charging' is never resolved or reported if the chargeFee action dies after the claim |
| H205-09 | #205 | minor | `convex/cardOnFile.ts` | An invoice stuck in 'charging' never falls back or tells anyone |
| H205-10 | #205 | minor | `convex/lib/cardOnFileWebhook.ts` | The no-show fee webhook silently drops a successful charge on an invoice that was already paid another way |
| H205-11 | #205 | minor | `convex/lib/cardOnFileWebhook.ts` | A late fee-charge webhook on an invoice the client already paid by link is dropped silently |
| H205-12 | #205 | minor | `specs/features/truth-saved-card-no-show/rd.md` | The go-live instructions omit the payment_intent.succeeded subscription that the checkout-consent path depends on |
| H206-01 | #206 | major | `convex/billingWebhooks.ts` | Payment on a deleted invoice is still silently dropped |
| H206-02 | #206 | major | `convex/billingWebhooks.ts` | Booking settle records Pulse's computed amount, not what Stripe collected; the new check only catches overpayment |
| H206-03 | #206 | major | `convex/billingWebhooks.ts` | The booking amount check catches only overpayment; an underpaid Checkout is still recorded as the full amount owed |
| H206-04 | #206 | minor | `convex/strayPayments.ts` | Refund that errors after Stripe succeeded, or a crashed action, leaves wrong or no record |
| H206-05 | #206 | minor | `convex/strayPayments.ts` | A refund in 'pending' or 'requires_action' state is reported as refunded, and a later failure is never surfaced |
| H206-06 | #206 | minor | `convex/strayPayments.ts` | A refund Stripe returns as 'pending' is marked refunded, and the client is told it is done, with no follow-up if it later fails |
| H206-07 | #206 | minor | `specs/features/truth-paid-after-release/eval.md` | eval truth-paid-after-release U-10 is marked PASS although its stated check (a payments row marks the failure) is not what the code does |
| H207-01 | #207 | critical | `convex/automation.ts` | A session set to be paid from prepaid hours still counts as unpaid, so the cron chases the balance and cancels public bookings while keeping the deposit |
| H207-02 | #207 | critical | `convex/packages.ts` | Choosing a prepaid block leaves the session looking unpaid: the cron demands the full balance, then forfeits public bookings and keeps the deposit |
| H207-03 | #207 | major | `convex/automation.ts` | The stale-session sweep takes prepaid hours for sessions that may never have happened |
| H207-04 | #207 | major | `convex/billingWebhooks.ts` | A pay-link payment that settles later (bank debit) is charged but never becomes hours |
| H207-05 | #207 | major | `convex/billingWebhooks.ts` | Client pays a pay link but gets no hours, with no alert, if the product was deleted or the payment is asynchronous |
| H207-06 | #207 | major | `convex/packages.ts` | Prepaid hours are valued at the package's discounted rate, so the client is billed cash for hours they already prepaid |
| H207-07 | #207 | major | `convex/packages.ts` | Draw-down ignores invoices already issued or paid for the session, so the client pays twice |
| H207-08 | #207 | major | `convex/packages.ts` | 'Refund: put the hours back' makes the client owe the session price in cash |
| H207-09 | #207 | major | `convex/packages.ts` | A paid pay link creates no credit, and no alert, if the package or client was deleted after the link was sent |
| H207-10 | #207 | major | `convex/packages.ts` | A session drawn fully from prepaid hours still gets a balance invoice for the gap between the block price and the session rate |
| H207-11 | #207 | major | `convex/packages.ts` | 'Refund: put the hours back' re-prices the completed session to full, so the client appears to owe the whole rate |
| H207-12 | #207 | minor | `convex/packages.ts` | Existing Core studios lose the Packages page and product management with no owner switch |
| H207-13 | #207 | minor | `convex/sessions.ts` | Voiding a completed session, now the documented way to return hours, also runs the No-Show Shield fee and card auto-charge |
| H207-14 | #207 | minor | `convex/sessions.ts` | Manual 'Apply' redemptions now raise the engineer's percentage pay and lifetime value for existing studios |
| H207-15 | #207 | minor | `src/lib/nav.ts` | Plan gate removes /packages and product management from existing Core studios with no owner notice or switch |
| H208-01 | #208 | major | `convex/payouts.ts` | Queued and approved hourly payouts from before the change can still be approved and paid, alongside payroll |
| H208-02 | #208 | major | `convex/payroll.ts` | Posting dedupe keys on the exact window, so overlapping or rolling ranges still post the same hours twice |
| H208-03 | #208 | major | `convex/payroll.ts` | Posting an in-progress period locks it, so later hours and corrections never reach the ledger |
| H208-04 | #208 | major | `convex/payroll.ts` | Wage-changing timesheet mutations are gated on schedule.manage, which a manager keeps when the owner hides money, and they allow editing your own hours |
| H208-05 | #208 | minor | `convex/payroll.ts` | Voided entries are still served to teammates and the native mirror as ordinary punches; a voided running clock shows 'on the clock' forever |
| H208-06 | #208 | minor | `convex/payroll.ts` | Manual entries can overlap existing punches, so the same hours are paid twice |
| H208-07 | #208 | minor | `convex/smsFlows.ts` | A denial no longer closes the intern's entry, and the sweep ignores denied entries |
| H209-01 | #209 | major | `convex/lib/splitSigning.ts` | A non-owner can redirect a signed contributor's royalty share by changing their email, and the sheet stays 'Signed by everyone' |
| H209-02 | #209 | major | `convex/splitSheets.ts` | Any edit to an existing hand-ticked fully_executed sheet is refused, and the owner's way out is hidden |
| H209-03 | #209 | major | `convex/splitSignatures.ts` | Legacy hand-ticked contributors never get a signing link, so their sheet can never execute by signature |
| H209-04 | #209 | minor | `convex/splitSignatures.ts` | Public signing lookup still returns every co-contributor's signature image, email and browser string |
| H210-01 | #210 | major | `convex/lib/agentAutoSend.ts` | Auto-send recipient check passes for anyone who submits a public form, so a steered model can still email a stranger without approval |
| H210-02 | #210 | major | `convex/orgs.ts` | Public booking-page query returns every owner discount code with its percentage, so codes can still be seen without guessing |
| H210-03 | #210 | minor | `convex/aiActions.ts` | The quiet-hour promo email draft advertises a code that does not work until a separate approval |
| H210-04 | #210 | minor | `convex/promos.ts` | Legacy codes the old sweep wrote are silently refused at checkout, but Settings still shows them active and the owner cannot turn them back on |
| H210-05 | #210 | minor | `convex/visitors.ts` | Visitor log is still readable and writable by every studio member (role check not built) |
