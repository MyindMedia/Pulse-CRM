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
| U-01 | Sent, viewed and overdue invoices still open Checkout | convex-test with mocked Stripe for each status → URL returned | PENDING | |
| U-02 | Void invoice: `payViaStripe` returns no URL | convex-test → `{ url: null }`, no Stripe call | PENDING | |
| U-03 | Draft invoice handled per decision 1 | convex-test → `{ url: null }` (if 1a) | PENDING | |
| U-04 | Paid invoice still refused | convex-test → `{ url: null }` | PENDING | |
| U-05 | Webhook for a void invoice does not flip it to paid | convex-test: `checkout.session.completed` with `invoiceId` of a void invoice → status stays `void`, team alerted, refund scheduled (if 2a) | PENDING | |
| U-06 | Replayed webhook does nothing twice | convex-test: same event id twice → one alert, one refund | PENDING | |
| U-07 | Another studio's connected account is refused | convex-test → `.account_mismatch`, invoice untouched | PENDING | |
| U-08 | Bad or other-type id in the URL shows "not found", not an error page | Playwright on staging: `/pay/invoice/<random id>` | PENDING | |
| U-09 | Page shows the cancelled state for a void invoice, no Pay button | Playwright on staging with a test invoice voided | PENDING | |
| U-10 | Page shows the paid state for a paid invoice | Playwright on staging | PENDING | |
| U-11 | Double click on Pay opens one Checkout | Playwright: button disabled while busy | PENDING | |
| U-12 | Checkout opened before the void, paid after it, is caught by U-05 | Staging: open Checkout, void in the app, pay → invoice stays void, refund | PENDING | |
| U-13 | No-show fee auto-charge still settles a draft fee invoice | Existing/added test for `_markFeePaid` on a draft | PENDING | |
| U-14 | Must-not-break list passes | Full suite | PENDING | |
