# Eval: Prepaid hours that nobody can buy
Status: built on `feat/high-prepaid-hours` (H6). 11 PASS, 2 NOT RUN (need Stripe test mode on staging).
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
| U-01 | Pay link creates exactly one credit after payment | convex-test: webhook `checkout.session.completed` with package metadata → one `packageCredits` row | PASS | `convex/prepaidHours.test.ts` "U-01 a paid checkout creates exactly one credit, sized to what was sold"; "U-01 the credit keeps the hours and price the client was offered when the studio reprices before payment"; existing `convex/packages.test.ts` "webhook checkout.session.completed (kind=package) creates the credit once" |
| U-02 | Replayed webhook creates no second credit | convex-test: same event twice → one row | PASS | `convex/prepaidHours.test.ts` "U-02 a replayed webhook, or the same payment under a new event id, creates no second credit" |
| U-03 | Webhook from the wrong connected account creates nothing | convex-test → `.account_mismatch` | PASS | `convex/prepaidHours.test.ts` "U-03 a webhook from another studio's connected account creates nothing" (ledger row ends `.account_mismatch`); "U-03 metadata mixing studios (org A account, org B client) creates nothing" |
| U-04 | Package or client from another studio refused when creating the link | convex-test: org A member, org B product or artist → error | PASS | `convex/prepaidHours.test.ts` "U-04 a pay link for another studio's package or client is refused"; "U-04/U-05 another studio's package or client is refused" |
| U-05 | In-person sale records one credit with who recorded it | convex-test on `recordSale` | PASS | `convex/prepaidHours.test.ts` "U-05 records one credit with who recorded it and how the client paid" |
| U-06 | Double click on "Record payment" records once | convex-test or Playwright | PASS | `convex/prepaidHours.test.ts` "U-06 a double click (same sale key) records once"; "a reused sale key for a different client is refused, not silently matched" |
| U-07 | Member without the finance role cannot record a sale | convex-test with engineer identity → FORBIDDEN | PASS | `convex/prepaidHours.test.ts` "U-07 a member without the finance role cannot record a sale" (engineer: `lacks invoices.send`, pay link refused too) |
| U-08 | Signed-out caller cannot sell or record | convex-test → error | PASS | `convex/prepaidHours.test.ts` "U-08 a signed-out caller cannot sell, record, draw or return" (Clerk configured: `Sign in required`) |
| U-09 | Core studio refused (if gated) | convex-test → UPGRADE_REQUIRED | PASS | `convex/prepaidHours.test.ts` "U-09 a Core studio is refused selling with UPGRADE_REQUIRED" (recordSale, create, list, pay link; public list empty) |
| U-10 | Client lands on a client-facing page after paying | Staging, test card | NOT RUN | Needs a browser and Stripe test mode. On staging (Growth studio, Stripe test account connected): Packages > Sell to a client > Pay link, open the link, pay with 4242 4242 4242 4242; you should land on /pay/package?status=paid and the block should appear under "Hours on the books". |
| U-11 | Expired or abandoned Checkout creates nothing | Staging: open link, cancel → no credit | NOT RUN | Needs Stripe test mode. On staging, open a pay link and press back/cancel: you land on /pay/package?status=cancelled and no block appears. Supporting unit test (webhook level only, not this check): `convex/prepaidHours.test.ts` "U-11 (webhook level) an unpaid or expired checkout creates nothing". |
| U-12 | Redeeming the new credit takes hours off it | convex-test on `redeem` | PASS | `convex/prepaidHours.test.ts` "U-12 redeeming the new credit by hand takes hours off it"; draw-down on completion: "nothing comes off when the block is chosen; the session's hours come off once when completed" |
| U-13 | Must-not-break list passes | Full suite | PASS | `npx tsc --noEmit` clean; `npm run lint` 164 problems (not worse); `npx vitest run` 4087 passed, 3 failed - only the three known failures (agentScope, marketing/results, outreachCalls live call). Existing `convex/packages.test.ts` unchanged and passing. |
