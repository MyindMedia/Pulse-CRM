# Core / Growth / Max build: hand-off (branch feat/core-growth-max-pricing)

Nothing here is pushed, deployed, migrated on a live database, or changed in live Stripe.

## Lawrence: do these in order
1. Review the diff, especially `convex/billingWebhooks.ts` (plan mapping, plus the separate commit "Webhook: ignore connected-account events in platform signup", which you may drop) and `convex/migrations.ts`.
2. Set `MYPULSE_PASSWORD` in Netlify to a NEW password (the old one is in git history). Until set, /mypulse is locked for everyone. Add a Netlify rate-limit rule on POST /mypulse.
3. Create the 3 products and 6 prices in Stripe from `docs/STRIPE-NEW-TIERS.md`; set the six `STRIPE_PRICE_{CORE,GROWTH,MAX}_{MONTHLY,ANNUAL}` env vars on the Convex deployment. Until then /pricing cards fall back to "Book a demo".
4. Deploy in two steps: (a) deploy this branch (schema still accepts old plan values), (b) run `migrations:migrateToCoreGrowthMax` with `dryRun` first, read `orgTiers`/`lowered`, then the real run (it refuses to lower anyone). Then narrow the schema and delete `convex/lib/legacyPlans.ts`.
5. R2 per-studio buckets: follow `docs/R2-PER-ORG-BUCKETS.md` (bucket-create token, Worker redeploy, backfill dry-run, `R2_PER_ORG_BUCKETS=1`). Then flip `R2_PER_ORG_LIVE` in `src/app/pricing/model.ts` to show the R2 line on /pricing. Create a read-only R2 token for the Worker.
6. Decide: the 50%-off-3-months early-adopter offer is still on in checkout (Core shows $74.50 for 3 months).
7. Run `npm run build` and `node tools/browser-check/check.mjs <url>` on a Netlify deploy preview (neither was run: the build starts with `convex codegen`).

## Known gaps
- iOS: built on `~/Dev/pulse-native` branch `feat/core-growth-max-ios` (9 commits, not pushed): projects, version review, barcode gear check-out. 208/208 PulseKit tests pass; UI files were type-checked for iOS only, NOT built into the app or run on a simulator. Run `tools/iphone.sh sim` and scan a label before any TestFlight. Not built on iOS: create/edit projects and tasks, uploads, restore, guest links, assigning label codes. No plan wording in the app (App Review 3.1.3(f)).
- `convex/marketing/results.test.ts` fails on a stale 2026-08 date fixture; confirmed it also fails on main.
- `next build` passes (run without the Convex codegen prebuild). Browser check on a local build: logos and /demo prefetch fixed; remaining console noise is the Convex query not yet on the dev deployment, cancelled ?_rsc prefetches, and an intermittent React #418 likely from the hero's live clock (hero.tsx:47, not changed by this work).
- Dev Convex deployment fiery-cricket-350 received two accidental `convex codegen` pushes from agents. Prod (pastel-corgi-340) untouched.
- No dynamic Strix scan (needs Docker + LLM key). Static security review done; its CRITICAL and HIGH items are fixed and tested.
- No UI toggle yet for `mediaLibrary.setGroupSharing` (shared library is opt-in per studio, default off).
- Room and staff caps are shown but not enforced (same as before). Texts and email are unmetered.
- `/vs` page names a rival: noindex and unlinked, not deleted.

## Prod migration dry run (read-only, 2026-10-07)
Prod orgs and agencies were read (no writes, nothing deployed to prod) and run through the migration's own `oldRuleTier` / `newRuleTier` / `migratedOrgFields`: 6 orgs, 1 agency (plan `agency`). pulse-demo old=new=growth; the 4 beta studios and the 1 non-beta agency studio all old=new=max. Nobody resolves lower. The real run is still a separate step after merge.
