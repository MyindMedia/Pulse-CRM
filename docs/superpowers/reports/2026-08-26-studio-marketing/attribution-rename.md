# Attribution rename: Myind Sound -> ThaMyind

Pulse's own "who built this" credit now reads ThaMyind. Myind Sound the studio
tenant, and Myind Sound the legal operating entity, are untouched.

## Sites changed (13 files, Role 1 only)

From the assignment's list:

- `src/app/layout.tsx:59` - `authors: [{ name: "Myind Sound" }]` -> `"ThaMyind"`.
- `src/app/opengraph-image.tsx:235` - `PULSE BY MYIND SOUND · PULSE.MYINDSOUND.COM` -> `PULSE BY THAMYIND · PULSE.MYINDSOUND.COM`. Domain left as-is.
- `src/app/preview/page.tsx:454` - `Confidential. Pulse by Myind Sound · studiopulse.tech` -> `... Pulse by ThaMyind ...`.
- `src/components/shell/sidebar.tsx:124` - `Pulse by Myind Sound` -> `Pulse by ThaMyind`.
- `src/components/brand/pulse-logo.tsx:7-8` - both doc-comment lines describing the "by Myind Sound" subtext now describe "by ThaMyind".
- `src/components/marketing/hero.tsx:576` - `Pulse by Myind Sound` -> `Pulse by ThaMyind`.
- `src/components/marketing/footer.tsx:68` - copyright line -> `&copy; 2026 ThaMyind. All rights reserved.`
- `src/components/marketing/logo-marquee.tsx:139` - `Studios that trust Myind Sound.` -> `Studios that trust ThaMyind.`
- `convex/lib/emailTemplates/betaInvite.ts:101`, `betaEnding.ts:113`, `betaWelcome.ts:99` - all three footer lines -> `Pulse by ThaMyind &middot; studiopulse.tech`.

Found by my own repo-wide grep, not on the assignment's list, but the same
Role 1 category:

- `src/components/marketing/footer.tsx:63` - the "Made by" cell directly above the copyright line said `Myind Sound`; changed to `ThaMyind`. This is the same attribution as the copyright line one paragraph down and would have been an inconsistent half-rename if left.
- `README.md:5` - `Built by Myind Sound.` -> `Built by ThaMyind.` Repo README's own build credit, same pattern as the in-app "Made by" / "Pulse by" lines.
- `marketing/remotion/src/scenes/CTA.tsx:5` - a code comment describing the end-card logo as reading `"Pulse · by Myind Sound"` -> updated to `"Pulse · by ThaMyind"` for consistency with the rest of the brand copy, even though (see below) the actual PNG it describes has no subtext baked in.

No test asserted on any of the strings above (checked `invite.test.ts`,
`layout.test.ts`, `betaAccess.test.ts`, `checkin-sign.test.ts`,
`parking-sign.test.ts`, and searched for `.test.ts(x)` files under every
touched component's directory) so no test files needed updating.

## Deliberately left alone (Role 2 - tenant/demo data)

Confirmed unchanged, matching the assignment's explicit exclusion list:

- `convex/seed.ts`, `convex/seedGuard.test.ts`, `src/app/(app)/dashboard/page.tsx` - demo-org-rebuild comments.
- `src/components/settings/workspace-panel.tsx:152`, `branding-panel.tsx:366` - example-studio-name placeholders.
- `src/components/payments/invoice-sheet.tsx:46`, `src/components/marketing/mobile-sim.tsx:62`, `src/components/marketing/dashboard-sim.tsx` - sample/mock-up content.
- `convex/betaAccess.ts:381` - agency display-name fallback (`ag?.name ?? "Myind Sound"`).
- `src/lib/parking-sign.test.ts`, `src/lib/checkin-sign.test.ts` - test fixtures.
- Every reference to `myindsound.com`, `pulse.myindsound.com`, the `myind-sound` slug, and `org_...` Clerk org ids.

Additional Role 2 instances my grep turned up, also left alone:

- `convex/demoRefresh.ts:19`, `convex/lib/sms.ts:20` - comments about the demo org's id and the GHL/LeadConnector location, both infrastructure notes about the real tenant, not credit.
- `src/components/settings/data-panel.tsx:37,55,101` - "rebuild the Myind Sound demo workspace" toast/copy, same category as `seed.ts`.
- `convex/lib/emailTemplates/betaInvite.ts:38` - `args.fromName ?? "Lawrence at Myind Sound"`, a sender-identity default, same shape as the agency-name fallback the assignment already excluded. `invite.test.ts` and the 2026-05-22 plan doc both assert on this exact string; untouched.
- `convex/betaAccess.test.ts`, `convex/lib/emailTemplates/layout.test.ts` - test fixtures for studio/agency names.
- `src/components/marketing/logo-marquee.tsx:66` - "Myind Sound" listed as one of the client-studio logos in the marquee ("Myind / REC. CO" mark), alongside Slang City, Good Music, Velvet Room Audio. This is a client-studio credit (Pulse's customer), not Pulse's own maker credit.
- `marketing/remotion/src/promo/scenesSpec.ts:112` - "glowing in Myind Sound yellow" is a color-name reference to the brand gold, not an attribution string. Left alone; it doesn't say who made anything.
- `docs/superpowers/**`, `Grilled.md`, `LAUNCH-CHECKLIST.md`, `STRIPE-CONNECT-SETUP.md`, `scripts/ghl-sms.py`, `scripts/twilio-bundle-detail.py` - internal planning/ops docs and scripts referring to the real Myind Sound org, its Clerk org id, and Lawrence's own operator identity for Stripe/GHL setup. None of these are product-facing attribution copy.

## Two legal documents left untouched, as instructed

- `src/lib/terms.ts:16` - "Pulse is studio-management software operated by Myind Sound."
- `convex/lib/betaNda.ts:31` and `:51` - "written permission from Myind Sound" / "property of Myind Sound."

Both still name Myind Sound as the operating/owning entity. Not touched, per
the assignment. Flagging here so Lawrence can decide with his own eyes
whether the Terms of Service and beta NDA should eventually name a different
entity - that's a legal-entity decision, not a rebrand-the-credit-line one,
and it's out of scope for this change.

## Public assets checked

`public/pulse-logo.png` and `public/pulse-logo-main.png` were opened and
visually inspected: neither has "by Myind Sound" (or any subtext) baked into
the raster image, only the "PULSE" wordmark and waveform glyph. The
`pulse-logo.tsx` doc comment describing a "by Myind Sound" subtext on the
footer variant was therefore already describing something the current PNG
doesn't show; its text has been updated to say "ThaMyind" for consistency
with every other attribution site, but the underlying PNG mismatch (no
subtext in either asset) predates this change and is unrelated to it.
`grep -rniI "myind sound" public/` returned no other text hits (all other
files under `public/` are binary images/video with no embedded searchable
strings).

## Verification

- `npm test` - 169 files, 1444 tests, all passed.
- `npm run typecheck` - clean, no errors.
- `npm run lint` - 0 errors, 84 pre-existing warnings (none in files touched by this change).
- No em dashes introduced (checked full diff).
