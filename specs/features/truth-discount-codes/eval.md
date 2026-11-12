# Eval: Discount codes that go live on their own
Status: draft, waiting for owner approval
Risk: High. It changes which codes checkout accepts and so what clients are charged. If it is wrong, studios keep giving unapproved discounts, or real promo codes stop working.
RD: ./rd.md

## Must not break
- Owner-issued codes in settings and Marketing > Promos (create, window, room limit, cap, deactivate)
- Checkout with a valid code, invalid code error, `?code=` links
- Weekly briefing and other Monday crons
- Social post approval flow
- `npx tsc --noEmit`, `npm run lint`, vitest, with only the known failures

## Checks
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| U-01 | Sweep writes no permanent code | convex-test: run `writeRateCutPromos` → `orgs.discountCodes` unchanged | PASS | `convex/rateCutPromos.test.ts` "U-01: the sweep writes no permanent code" |
| U-02 | Sweep promo is not redeemable before approval | convex-test: `resolveCode` with the new code → null | PASS | `convex/rateCutPromos.test.ts` "U-02: a sweep promo is not redeemable before approval" |
| U-03 | Approving the draft post activates the promo for its window and room only | convex-test → `resolveCode` returns the discount in window, null for another room | PASS | `convex/rateCutPromos.test.ts` "U-03: approving the draft post activates the promo for its window and room only" |
| U-04 | Declining the draft leaves the promo inactive | convex-test | PASS | `convex/rateCutPromos.test.ts` "U-04: declining the draft leaves the promo inactive, and it cannot be approved later" |
| U-05 | Approving twice (double click) does not create two promos or two posts | convex-test | PASS | `convex/rateCutPromos.test.ts` "U-05: approving twice does not create two promos or two posts"; also "a second weekly sweep adds nothing while the suggestion is still waiting" |
| U-06 | Another studio's member cannot approve or activate this studio's promo | convex-test with org B identity → error | PASS | `convex/rateCutPromos.test.ts` "U-06: another studio's member cannot approve or activate this studio's promo" and "U-06b: a member without marketing.approve cannot activate a promo" |
| U-07 | Signed-out caller cannot activate a promo | convex-test → error | PASS | `convex/rateCutPromos.test.ts` "U-07: a signed-out caller cannot activate a promo" |
| U-08 | Generated codes include a random part | Unit test: two runs → different codes | PASS | `convex/rateCutPromos.test.ts` "U-08: generated codes include a random part" |
| U-09 | Link uses `APP_URL` | Unit test: caption/link contains the configured app URL, not `pulse-dash-kit` | PASS | `convex/rateCutPromos.test.ts` "U-09: the promo link uses APP_URL, not the old domain" |
| U-10 | Owner code still applies at checkout | convex-test | PASS | `convex/rateCutPromos.test.ts` "U-10: an owner code still applies at checkout; the old sweep's permanent codes do not"; existing `convex/discountCodes.test.ts` (checkout with a code) still passes |
| U-11 | Deactivated promo does not fall back to a legacy code of the same name | Existing behaviour; convex-test | PASS | `convex/rateCutPromos.test.ts` "U-11: a deactivated promo does not fall back to a legacy code of the same name" (this was NOT existing behaviour: a switched-off promo used to fall through to the legacy code; now it does not) |
| U-12 | Must-not-break list passes | Full suite | PASS | Full suite: `npx tsc --noEmit`, `npm run lint`, `npx vitest run` with only the three known failures (counts in the pull request) |
