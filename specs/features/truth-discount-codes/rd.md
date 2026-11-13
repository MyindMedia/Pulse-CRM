# RD: Discount codes that go live on their own (truth fix, B5)

Status: draft, waiting for owner approval. No code has been written.
Audit id covered: `bookings-clients-mod-discount-codes`.
Code read on `develop` (2026-11-12).

## What Pulse says
Module blurb: "Owner-issued and AI-generated codes at checkout" (`convex/lib/modules.ts:88`).

## What actually happens today
- Owner-issued codes work (settings pricing panel and Marketing > Promos).
- The "AI-generated" codes come from a fixed rule, not AI: a room window under 40% booked with 8 or more free hours (`convex/aiContext.ts:331`). The code is built from the room, day and part of day plus the percentage (`convex/aiContext.ts:341`), so it is easy to guess.
- Every Monday at 13:05 UTC the `rate-cut-sweep` cron runs this for every active studio (`convex/crons.ts:125-128`). For each recommendation `writeRateCutPromos` (`convex/aiActions.ts:388-440`):
  1. writes a permanent code into `orgs.discountCodes` with `active: true`, no end date, no room limit, no use limit (`convex/aiActions.ts:404`, `convex/orgs.ts:407-420`);
  2. creates a 28-day promo row that is also `active: true` from the moment it is created (`convex/aiActions.ts:423-427`, `convex/promos.ts` `createInternal`);
  3. drafts a social post for the owner to approve.
  Only the post waits for approval. The discount is redeemable at checkout straight away.
- The promo email/post link is hard-coded to the old domain `https://pulse-dash-kit.netlify.app/book/...` (`convex/aiActions.ts:396-399`).

**Correction to the audit:** "codes never expire" is only partly true. Checkout looks up the promo row first; while that row exists and is active, an expired or wrong-room promo returns no discount and does not fall through to the permanent code (`convex/promos.ts:14-41`, comment at `:36`). The permanent code becomes usable (any room, any time, no limit) when the promo row is switched off (`promos.deactivate`, `convex/promos.ts:90-96`) or removed. So an owner who switches off a promo they did not want leaves a permanent discount behind.

## Who is hurt and how
- **Studios** lose money: a discount of up to 90% (`convex/orgs.ts:414`) can be redeemed by anyone who guesses or sees the code, without the owner ever agreeing to it, for 28 days, and forever after the owner switches the promo off.
- **Clients** who follow the link land on the old domain (it redirects today, but it is not the studio's address).

**Can it be happening in production now?** Yes for every active studio with a quiet room window. How the owner can check: production `orgs.discountCodes` entries whose `label` looks like "{room} {window}" (made by the sweep); `promos` rows with `source: "rate_cut"` and their `redemptions` count; uses of the permanent codes are not counted anywhere, but the team "new booking" notification text says "Discount code {code} applied" (`convex/booking.ts:1138-1140`), so `notifications` can be searched for those codes.

## Cause (verified on develop)
`convex/aiActions.ts:404` (permanent code), `:423-427` (promo active at once), `:396-399` (domain); `convex/orgs.ts:417`; `convex/crons.ts:126`; `convex/promos.ts:14-41`.

## Proposed fix (smallest correct change)
1. Delete the `ensureDiscountCode` call in `writeRateCutPromos` (no new permanent codes).
2. Create the rate-cut promo row with `active: false`, and set it active when the owner approves the draft post (the approval action for `social_post_draft`), so nothing is redeemable before a person says yes.
3. Build the link from `appUrl()` (`convex/lib/links.ts`), not the hard-coded domain.
4. Make generated codes harder to guess (add a short random suffix).
5. Reword the blurb: "Codes you issue, plus suggested codes for quiet hours that you approve."
Files: `convex/aiActions.ts`, `convex/promos.ts` (createInternal takes `active`), the approval handler for `social_post_draft` actions (`convex/opsActions.ts`, type at `:111`), `convex/lib/modules.ts`, tests.
**Schema:** none.
**One-time correction:** remove the permanent codes the sweep already wrote into `orgs.discountCodes` (identified by label and by a matching `promos` row with `source: "rate_cut"`). Owner decides (below), because a studio may have shared one.

## Decisions for the owner
1. Existing sweep-made permanent codes: (a) switch them off for all studios and tell studios (recommended); (b) list them per studio and let each owner decide.
2. Existing active `rate_cut` promos that nobody approved: (a) switch off those whose draft post was never approved (recommended); (b) let them run out (28 days).
3. Should the weekly sweep run at all for studios that never opened Promos? Recommend: only for studios that turned "suggest quiet-hour deals" on.

## Interim step (no money logic)
Reword the blurb now (copy only). The owner could also pause the `rate-cut-sweep` cron, but that is a deploy-level change on production and needs the owner's say-so; I have not done it.

## Risk
- This changes which codes checkout accepts and so what clients pay: a client holding a sweep code would lose the discount after the cleanup. Decision 1 covers telling studios.
- **Rollback:** restore the `ensureDiscountCode` call and `active: true`. Data cleanup should record removed codes so they can be put back.
