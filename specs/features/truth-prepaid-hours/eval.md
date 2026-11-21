# Eval: Prepaid hours that nobody can buy
Status: draft, waiting for owner approval
Risk: High. New paths that take a client's money and create a credit balance. If it is wrong, a client pays and gets no hours, gets hours twice, or a staff member creates credit without payment.
RD: ./rd.md

## Must not break
- Creating, editing and removing package products
- Redeeming existing credit from the session sheet
- Booking checkout, invoice and membership webhook branches
- `npx tsc --noEmit`, `npm run lint`, vitest, with only the known failures

## Checks
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| U-01 | Pay link creates exactly one credit after payment | convex-test: webhook `checkout.session.completed` with package metadata → one `packageCredits` row | PENDING | |
| U-02 | Replayed webhook creates no second credit | convex-test: same event twice → one row | PENDING | |
| U-03 | Webhook from the wrong connected account creates nothing | convex-test → `.account_mismatch` | PENDING | |
| U-04 | Package or client from another studio refused when creating the link | convex-test: org A member, org B product or artist → error | PENDING | |
| U-05 | In-person sale records one credit with who recorded it | convex-test on `recordSale` | PENDING | |
| U-06 | Double click on "Record payment" records once | convex-test or Playwright | PENDING | |
| U-07 | Member without the finance role cannot record a sale | convex-test with engineer identity → FORBIDDEN | PENDING | |
| U-08 | Signed-out caller cannot sell or record | convex-test → error | PENDING | |
| U-09 | Core studio refused (if gated) | convex-test → UPGRADE_REQUIRED | PENDING | |
| U-10 | Client lands on a client-facing page after paying | Staging, test card | PENDING | |
| U-11 | Expired or abandoned Checkout creates nothing | Staging: open link, cancel → no credit | PENDING | |
| U-12 | Redeeming the new credit takes hours off it | convex-test on `redeem` | PENDING | |
| U-13 | Must-not-break list passes | Full suite | PENDING | |
