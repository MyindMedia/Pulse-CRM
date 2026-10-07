# Core / Growth / Max build: approved decisions (2026-10-07, Lawrence)

Source of truth for scope: `source-prompt.md` (the full prompt). Step 1 inspection is done; this file records the approvals and what Step 1 found.

## Approved
- Repo: ~/Dev/pulse-web, branch `feat/core-growth-max-pricing`.
- Tier checklist: exactly the 14 groups and per-tier lists in source-prompt.md, plus the 15th group "New: production, media and gear check-out".
- Beta users: keep the beta flag (betaCohort etc.) separate. Beta orgs get Max-level access until graduation, then pick a tier.
- Stripe receiver: `convex/billingWebhooks.ts` may be edited ONLY for plan mapping (tierForPriceId, the studio-downgrade skip at ~L349, price->plan). Lawrence reviews the diff before any deploy. Nothing deploys from this task.
- Book a demo: route `/demo` ALREADY EXISTS (Zuops booking calendar). Use it. Do not build a new page.
- App Store URL: `APP_STORE_URL` in src/components/marketing/app-store.ts (id6810760056). Also accept NEXT_PUBLIC_PULSE_IOS_APP_URL as override.

## Step 1 findings agents must respect
- Old ladder: studio $149.99 / pro $297 / label $499.99 (+ flow, enterprise, legacy growth, agency, agency_plus). Source: convex/lib/plans.ts, convex/lib/tier.ts (PLAN_TO_TIER), convex/lib/entitlements.ts, convex/lib/access.ts (requireCapability), convex/usage.ts (allowances).
- Legacy field `orgs.plan` (solo|studio|label) means DIFFERENT tiers than the same word in `orgs.tier` (solo->studio, studio->pro). Collapse it.
- `growth` already exists as a legacy tier key; `core` is already a module flag in convex/lib/modules.ts. Do not collide: keep module flag `core` untouched, rename only plan identifiers.
- NEVER rename the studio entity (studio_id, `studio_${slug}`, CapabilityKey "studio" = Rooms page, artistType "label", licensing.tier, "studio_name", scope "studio").
- SUPERSEDED (2026-10-07 review): main's precedence is kept, because agency studios are stamped a default tier and ran at the agency's tier. Resolution is: demo -> max; beta (not graduated) -> max; org with agencyId -> the agency's plan (unknown/missing falls back to orgs.tier); standalone -> orgs.tier. A graduated beta studio under an agency follows the agency plan; graduation's orgs.tier only governs a studio outside an agency. migrateToCoreGrowthMax reports old-rule vs new-rule tier per org and refuses to run if any org would resolve lower.
- orgs.update lets branding.edit users change orgs.plan: lock down.
- Capabilities gated as one block need splitting: songs (Finished mixes + Notes on one version in Core; Every song + streaming link Growth; ownership/splits Max), patch/cable map (Growth; Max adds fill-in-gear-once, maker sheet, notes+history), inventory (Growth).
- Allowances today (assistant/mo, storage, rooms, staff): studio 100/10GB/2/3, pro 1000/100GB/6/15, label 5000/1000GB/unlimited/unlimited. Map Core/Growth/Max from these. Growth = unlimited rooms at one location (raise from 6). Texts and email are NOT metered today: do not invent caps; leave unmetered and document.
- Max = unlimited studios, flat $699, no per-studio charge. Allowances pooled across studios. subAccountCap 5 -> unlimited for Max.
- Prices: Core $149/mo $1,490/yr; Growth $297/mo $2,970/yr; Max $699/mo $6,990/yr.
- iOS app has NO plan reads and passed App Review as a free companion by removing all plan wording. Do NOT add visible plan names, upsell or tier gating copy inside the iOS app. Per-tier app capabilities are WEB copy on /pricing and /mypulse only, and list only what works in the app today.
- 3 new features are REQUIRED and must work end to end behind tier gates. Existing foundations: songs.stage, deliverables (version, approval), revisionComments, collaboratorGrants (expiring links), equipment (status, rentable, labelPrefix), mediaFiles + R2 helpers (convex/lib/media.ts, convex/media.ts, src/lib/use-r2-upload.ts).
- R2: still on Convex _storage: receipts, expense receipts, spec-sheet photos, and ctx.storage.store in brandHero, stageDemo, songImport, studioImport, members.importMemberPhoto. Move them to R2 (the "everything on R2" public line is shown only if true).
- Never say "CRM" anywhere public (known: pricing-tiers.ts:32, convex/lib/emailTemplates/invite.ts:65; reword all).
- Do NOT create/edit/archive Stripe live products or prices. Price IDs via env STRIPE_PRICE_{CORE,GROWTH,MAX}_{MONTHLY,ANNUAL}; add to .env.example.
- /mypulse password fallback is committed in src/app/mypulse/auth.ts: remove the literal fallback (fail closed if MYPULSE_PASSWORD unset) and tell Lawrence to set env.
- No em dashes in any copy.
