# Eval: A cancelled invoice can still be paid
Status: draft, waiting for owner approval
Risk: High. It changes which invoices a client can pay by card and what happens to money that arrives for a cancelled invoice. If it is wrong, clients cannot pay real invoices (studio not paid) or still pay cancelled ones.
RD: ./rd.md

## Must not break
- Paying a sent, viewed or overdue invoice by link, receipt email, team alert
- Overdue reminder emails with the pay link (`convex/automation.ts`)
- No-show fee auto-charge (`cardOnFile.chargeFee` / `_markFeePaid`), which settles drafts by its own path
- Manual "mark paid" on invoices in the app
- `npx tsc --noEmit`, `npm run lint`, vitest, with only the known failures

## Checks
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| U-01 | Sent, viewed and overdue invoices still open Checkout | convex-test with mocked Stripe for each status → URL returned | PASS | `convex/voidInvoicePayable.test.ts` "U-01: sent, viewed and overdue invoices still open Checkout on the studio's account" (mocked Stripe) |
| U-02 | Void invoice: `payViaStripe` returns no URL | convex-test → `{ url: null }`, no Stripe call | PASS | `convex/voidInvoicePayable.test.ts` "U-02: a void invoice returns no URL and makes no Stripe call" |
| U-03 | Draft invoice handled per decision 1 | convex-test → `{ url: null }` (if 1a) | PASS | `convex/voidInvoicePayable.test.ts` "U-03: a draft invoice returns no URL (decision 1a)" |
| U-04 | Paid invoice still refused | convex-test → `{ url: null }` | PASS | `convex/voidInvoicePayable.test.ts` "U-04: a paid invoice is still refused" |
| U-05 | Webhook for a void invoice does not flip it to paid | convex-test: `checkout.session.completed` with `invoiceId` of a void invoice → status stays `void`, team alerted, refund scheduled (if 2a) | PASS | `convex/voidInvoicePayable.test.ts` "U-05: a void invoice stays void, the team is alerted and one refund is scheduled" (also runs the refund: client and team told); and "a draft invoice paid by an old link stays a draft and is refunded" |
| U-06 | Replayed webhook does nothing twice | convex-test: same event id twice → one alert, one refund | PASS | `convex/voidInvoicePayable.test.ts` "U-06: a replayed webhook does nothing twice" |
| U-07 | Another studio's connected account is refused | convex-test → `.account_mismatch`, invoice untouched | PASS | `convex/voidInvoicePayable.test.ts` "U-07: another studio's connected account is refused and the invoice is untouched" |
| U-08 | Bad or other-type id in the URL shows "not found", not an error page | Playwright on staging: `/pay/invoice/<random id>` | NOT RUN | Needs a browser on staging: open `/pay/invoice/abc123` → "Invoice not found". Backend side passes: `convex/voidInvoicePayable.test.ts` "U-08 (backend): a malformed or other-table id is 'not found', not a server error" (args are now strings, normalized). |
| U-09 | Page shows the cancelled state for a void invoice, no Pay button | Playwright on staging with a test invoice voided | NOT RUN | Needs a browser on staging: void a test invoice in the app, open its pay link → "This invoice was cancelled. You do not owe anything on it.", no Pay button. |
| U-10 | Page shows the paid state for a paid invoice | Playwright on staging | NOT RUN | Needs a browser on staging: open the pay link of a paid test invoice → "Paid in full". |
| U-11 | Double click on Pay opens one Checkout | Playwright: button disabled while busy | NOT RUN | Needs a browser on staging: double-click Pay → one Checkout. The button is disabled while busy and `handlePay` now returns early if already busy. |
| U-12 | Checkout opened before the void, paid after it, is caught by U-05 | Staging: open Checkout, void in the app, pay → invoice stays void, refund | NOT RUN | Needs staging Stripe test mode: open Checkout, void the invoice in the app, pay with 4242 4242 4242 4242 → invoice stays void, refund in the connected test account. Webhook side is U-05. |
| U-13 | No-show fee auto-charge still settles a draft fee invoice | Existing/added test for `_markFeePaid` on a draft | PASS | `convex/voidInvoicePayable.test.ts` "U-13: the no-show fee auto-charge still settles a draft fee invoice"; existing `convex/recoveryOnPaid.test.ts` "a late-cancel fee charged to a saved card counts as cancellation_fee" also passes |
| U-14 | Must-not-break list passes | Full suite | PASS | Full `npx vitest run`, `npx tsc --noEmit`, `npm run lint` on this branch; only the known failures (see pull request). |
