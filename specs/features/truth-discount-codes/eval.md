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
| U-01 | Sweep writes no permanent code | convex-test: run `writeRateCutPromos` → `orgs.discountCodes` unchanged | PENDING | |
| U-02 | Sweep promo is not redeemable before approval | convex-test: `resolveCode` with the new code → null | PENDING | |
| U-03 | Approving the draft post activates the promo for its window and room only | convex-test → `resolveCode` returns the discount in window, null for another room | PENDING | |
| U-04 | Declining the draft leaves the promo inactive | convex-test | PENDING | |
| U-05 | Approving twice (double click) does not create two promos or two posts | convex-test | PENDING | |
| U-06 | Another studio's member cannot approve or activate this studio's promo | convex-test with org B identity → error | PENDING | |
| U-07 | Signed-out caller cannot activate a promo | convex-test → error | PENDING | |
| U-08 | Generated codes include a random part | Unit test: two runs → different codes | PENDING | |
| U-09 | Link uses `APP_URL` | Unit test: caption/link contains the configured app URL, not `pulse-dash-kit` | PENDING | |
| U-10 | Owner code still applies at checkout | convex-test | PENDING | |
| U-11 | Deactivated promo does not fall back to a legacy code of the same name | Existing behaviour; convex-test | PENDING | |
| U-12 | Must-not-break list passes | Full suite | PENDING | |
