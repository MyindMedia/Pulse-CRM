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

## Round 2 checks (review findings, 2026-11-12)
Owner decision: the public booking page never returns discount codes.

| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| R2-01 | H210-02: the anonymous slug lookup returns branding only: no codes (active or not), no owner email, prices, tax or billing | convex-test with no identity on `orgs.getBySlug` | PASS | `convex/discountCodes.test.ts` "returns branding only, never discount codes" |
| R2-02 | H210-02: the public booking page payload carries no discount codes | convex-test on `booking.studioFront` | PASS | `convex/discountCodes.test.ts` "the public booking page payload carries no discount codes either" |
| R2-03 | H210-03: a post whose sweep promo was declined cannot be approved from the composer | convex-test on `marketing.posts.approve` | PASS | `convex/rateCutPromos.test.ts` "H210-03: a post whose promo was declined cannot be approved from the composer (it would advertise a dead code)" |
| R2-04 | H210-03: a post whose owner promo was switched off cannot be approved; once it is on again it can | convex-test | PASS | `convex/rateCutPromos.test.ts` "H210-03: a post whose owner promo was switched off cannot be approved; an active one can" |
| R2-05 | H210-03: the promo email draft tells the owner the code works only after approval; the client email itself does not carry that note | convex-test on the sweep's `aiArtifacts` row | PASS | `convex/rateCutPromos.test.ts` "H210-03: the email draft tells the owner the code is not live until approved, and the client email does not" |
| R2-06 | H210-04: Settings marks an old sweep code as refused at checkout; toggling it does not hide that; a member without the settings permission cannot keep it; the owner can keep it and checkout then accepts it while it is on | convex-test on `orgs.current`, `orgs.setDiscountCodes`, `resolveCode` | PASS | `convex/rateCutPromos.test.ts` "H210-04: Settings shows an old sweep code as refused at checkout, and the owner can choose to keep accepting it" |
| R2-07 | H210-04: the Settings card shows the refused note and "Accept it again" | Browser on staging | NOT RUN | On staging, add a code `ROOMAMONMOR20` labelled `Room A Monday morning (9am-12pm)` in Settings > Pricing > Discount codes, save, and confirm the note and button appear |
| R2-08 | Same class: a second sweep makes no overlapping promo for a window whose suggested percentage changed, or whose promo is still waiting | convex-test | PASS | `convex/rateCutPromos.test.ts` "same class as H210 findings: a second sweep makes no overlapping promo for a window whose suggested percentage changed" |

