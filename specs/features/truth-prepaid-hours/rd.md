# RD: Prepaid hours that nobody can buy (truth fix, B5)

Status: draft, waiting for owner approval. No code has been written.
Audit id covered: `money-reporting-prepaid-hours`.
Code read on `develop` (2026-11-12).

## What Pulse says
Growth row "Prepaid blocks of hours" (`convex/lib/pricing.ts:516`): "Studio time that a client buys in advance. Pulse holds the purchase as credit and takes hours off it as the client uses them." (`convex/lib/pricing.ts:870-873`); module blurb "Prepaid blocks of studio time drawn down as credits" (`convex/lib/modules.ts:100`).

## What actually happens today
- Studios can create package products on `/packages` (`convex/packages.ts:80-160`), and staff can apply a client's existing credit to a session by hand from the session sheet (`packages.redeem`, `convex/packages.ts:222-270`).
- **No credit can ever be created by a user.** Credits are made only by `applyPackagePurchase` (`convex/packages.ts:337`), which runs from the Stripe webhook when a Checkout made by `packages.purchaseCheckout` completes (`convex/billingWebhooks.ts:179-199`), or from `_applyPurchase`, which is internal and used only by tests (`convex/packages.ts:386-394`). `purchaseCheckout` (`convex/packages.ts:300-329`) has no caller in `src/` (the iOS app is not in this repo, so I could not check it). The public booking page and client portal never list packages. There is no "record a cash sale" mutation.
- The page says "No packages sold yet. Once a client buys a block it shows here" (`src/app/(app)/packages/page.tsx:177`), and there is no way for that to happen.
- `purchaseCheckout`'s success and cancel URLs point to the staff page `/packages` (`convex/packages.ts:307-322`), so if it were wired to a client as-is, the client would land on a staff screen after paying.
- The functions are gated by Core finance roles (`invoices.read` / `invoices.send`, `convex/packages.ts:39`, `:89`) and never by the Growth `packages` entitlement.

## Who is hurt and how
- **Studios on Growth** pay for a feature that cannot take a sale. No client is charged wrongly; the harm is a promise that cannot be kept, plus studios that set up packages and tell clients about them.
- Lowest harm in this batch.

**Can it be happening in production now?** The gap, yes. How the owner can check: production `packageCredits` should be empty or seed-only; `packageProducts` rows show which studios set packages up expecting to sell them.

## Cause (verified on develop)
`convex/packages.ts:300` (no caller), `:386` (test-only), `:39`/`:89` (Core gates). The audit description is correct.

## Proposed fix (this is a build, not a bug fix)
1. **Staff sells a block.** On `/packages` and the client profile, "Sell to a client": pick the client and the package, then either (a) "Send pay link" (calls `purchaseCheckout`, emails/texts the client the URL), or (b) "Record a payment taken in person" (new mutation `packages.recordSale` → `applyPackagePurchase` with provider manual and who recorded it, plus an activity row).
2. **Client-facing success page** for the pay link: a new public route (or reuse the booking checkout layout) instead of `/packages`.
3. **Optional: clients buy on the booking page** using the existing `listActivePublic` query (`convex/packages.ts:55`).
4. **Gate** all package functions with `requireFeature(ctx, orgId, "packages")` in addition to the role checks.
5. **Optional: draw down automatically** when a client with credit books (today it is manual from the session sheet). Recommend keeping it manual for the first release.
Files: `convex/packages.ts`, `src/app/(app)/packages/page.tsx`, client profile, a new public success page, `convex/billingWebhooks.ts` (only to send a receipt), tests in `convex/packages.test.ts`.
**Schema:** `packageCredits` (`convex/schema.ts:1935-1948`) has no source or recorded-by field; add optional `source: "stripe" | "manual"` and `recordedBy`. Additive. `applyPackagePurchase` hard-codes `provider: "stripe"` (`convex/packages.ts:367`) and must take the provider as an argument.
**One-time correction:** none.

## Decisions for the owner
1. Build it now, or reword it now and build later? Recommend: reword now (interim step), build after the money fixes above.
2. Which sale paths: (a) pay link only; (b) pay link and in-person record (recommended: studios take cash and card in person); (c) also on the public booking page.
3. Refunds of unused hours: out of scope for the first release, or included? Recommend out of scope, with the wording saying so.

## Interim step (no money logic)
Change the price row to "Set up prepaid blocks and take hours off a client's credit." and remove "Pulse holds the purchase as credit" until a sale path ships; change the empty state to "Selling blocks from Pulse is coming soon." Copy only.

## Risk
- New code that takes money and creates credit balances. The webhook branch already exists and is idempotent per event; the manual sale path needs its own double-click guard.
- Adding the `packages` gate could hide `/packages` from Core studios that set packages up. Tell them first.
- **Rollback:** hide the "Sell" buttons; credits already sold stay valid and redeemable.
