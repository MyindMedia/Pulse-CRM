# Platform debrand: Myind Sound -> ThaMyind (round 2)

Round 1 (`5d9bcb9`) fixed the obvious "who built this" attribution lines.
This round covers the harder set Lawrence flagged plus a full repo grep: the
two legal documents, the public host stamped into live social posts and
brand-card URLs, and every other `myindsound` / `Myind Sound` hit, decided
platform vs. sub-account by the rule: describes who operates Pulse -> change;
describes a studio using Pulse -> leave.

## 1. Legal documents (name swap + version bump)

- `src/lib/terms.ts:16` - "operated by Myind Sound" -> "operated by ThaMyind".
- `src/lib/terms.ts:64` - liability clause "Pulse and Myind Sound" -> "Pulse and ThaMyind". Not in the assignment's named list but same document, same operator reference; leaving it would have contradicted line 16 in the same file.
- `src/lib/terms.ts:76` - "support@myindsound.com" -> "support@thamyind.com" (contact address, platform speaking).
- `convex/lib/betaNda.ts:31` - "permission from Myind Sound" -> "permission from ThaMyind".
- `convex/lib/betaNda.ts:51` - "property of Myind Sound" -> "property of ThaMyind".

**Version bumps (judgment call):** Both files document their own invariant:
`TERMS_VERSION`/`NDA_VERSION` exist so a studio's or signer's stored version
can be compared against the current one to detect stale acceptance
(`terms.ts` comment: "Bump TERMS_VERSION when this text changes - studios
re-accept"; `betaNda.ts` comment: "If the terms are ever edited, previously
captured signatures still point at the version they actually agreed to").
Editing the operator name without bumping the version would have made every
existing acceptance silently claim to match text it never saw. I bumped
both: `TERMS_VERSION` "2026-06-12.1" -> "2026-08-28.1", `NDA_VERSION`
"2026-08-20.2" -> "2026-08-28.1". No test hardcodes either literal version
string (checked); `NDA_TERMS_HASH` recomputes automatically from the edited
clause text. This is a version-identifier bump, not a reword - no clause
text changed beyond the name swap.

## 2. Public host (the loudest remaining mention)

- `convex/lib/ghl.ts:17` - GHL client `UA` -> `"Pulse/1.0 (+https://studiopulse.tech)"`. Test only asserts `toContain("Pulse/1.0")`, unaffected.
- `convex/lib/sms.ts:34` - same GHL User-Agent literal, same fix. Comment two lines up ("rides the Myind Sound location's number") left alone - that names the real GHL/LeadConnector location this feature actually uses, not the platform.
- `src/app/opengraph-image.tsx:235` - `PULSE BY THAMYIND · PULSE.MYINDSOUND.COM` -> `PULSE BY THAMYIND · STUDIOPULSE.TECH`.
- `convex/marketing/posts.ts` - checked the full `appHost()` chain (`PULSE_PUBLIC_HOST` -> `appUrl()` -> `"http://localhost:3000"`). No `myindsound` literal in the executable chain; already clean. The one hit in this file is a doc comment describing a bug that was already fixed before this task ("It used to read `PULSE_PUBLIC_HOST ?? "https://pulse.myindsound.com"`"), phrased in the past tense as engineering history. Left as-is; it's not a live trace, it's the record of one being removed.
- `convex/booking.ts:983` - a second, independent `APP_URL` fallback for the engineer-request notification link, still reading the old domain (everywhere else already used `studiopulse.tech` as the fallback) -> fixed to match.
- `convex/songImport.ts:34`, `convex/studioImport.ts:46` - `Pulse-StudioOS/1.0` outbound User-Agent literals (MusicBrainz/streaming metadata fetches) -> domain updated. No tests reference either.
- `src/app/layout.tsx:41` - `SITE_URL` (Next.js `metadataBase`, canonical/OG URLs) -> `studiopulse.tech`.
- `src/app/sign/[token]/page.tsx:230` - footer link back to the marketing site -> `studiopulse.tech/?ref=sign` (matches the existing `?ref=book` pattern in `book/layout.tsx`).
- `src/app/privacy/page.tsx:29` - "It covers pulse.myindsound.com and the studio booking pages..." -> `studiopulse.tech`.
- `src/components/marketing/contact.tsx:104` - `mailto:support@myindsound.com` -> `mailto:support@thamyind.com`.
- `marketing/remotion/src/copy.ts:7`, `promo/close.tsx:23`, `promo/treatment.tsx:153` - the domain rendered as on-screen 3D text/CTA in the promo video -> `studiopulse.tech`.
- `scripts/ghl-sms.py:38` - same GHL User-Agent pattern as `ghl.ts`/`sms.ts` -> updated for consistency (this is a manual admin script, not tied to any Twilio filing).
- `STRIPE-CONNECT-SETUP.md:55` - Stripe branding-setup doc's example logo URL -> `studiopulse.tech`.
- Domain literal in **test fixtures** that stood in for "the app's host" (not a studio's identity): `convex/lib/emailTemplates/invite.test.ts`, `convex/lib/emailTemplates/layout.test.ts`, `convex/marketing/attribution.test.ts`, `convex/marketing/posts.test.ts` - all `https://pulse.myindsound.com` literals -> `https://studiopulse.tech`. These are synthetic test data, not real assertions about production URLs, but a stale old domain in test source is still a repo trace; changing it is zero-risk (all four files still pass in full).

**Left alone, flagged for Lawrence (real infra, not a text swap):**

- `src/middleware.ts:18` and `src/components/providers/convex-client-provider.tsx:29` - both define `PRIMARY_ORIGIN = "https://pulse.myindsound.com"` for Clerk's actual primary/satellite domain configuration (`studiopulse.tech` is registered with Clerk as a *satellite* of this primary; sign-in can only happen on the primary). Renaming this constant in code without first re-pointing Clerk's dashboard config (making `studiopulse.tech` the primary, or issuing it as its own primary) would break authentication in production. This is the same category of "I'll handle the real host cutover myself" as `PULSE_PUBLIC_HOST`, just for Clerk instead of Convex env - flagging it explicitly since it's the largest remaining `myindsound` literal in the live app and needs a coordinated Clerk migration, not a code edit.

## 3. Everything else found by grep

**Platform, changed:**

- `convex/betaAccess.ts:381` - `{ name: ag?.name ?? "Myind Sound" }`. **Judgment call, as asked:** this is the display-name fallback for the *agency* sending beta invites - the agency is Pulse's own operator record, not a studio tenant. Changed to `"ThaMyind"`.
- `convex/betaAccess.test.ts:15` - the test's `agency()` fixture seeds an agency named "Myind Sound" to exercise that exact fallback path. Changed to `"ThaMyind"` for consistency with the code it tests; no assertion depends on the literal string.
- `convex/lib/emailTemplates/betaInvite.ts:38` - `args.fromName ?? "Lawrence at Myind Sound"`, the default sender identity on the actual beta-invite email. Same shape as the agency fallback above (Lawrence, as the platform operator, named alongside the retiring brand) -> `"Lawrence at ThaMyind"`.
- `convex/lib/emailTemplates/invite.test.ts:8,14` - `inviterName: "Lawrence at Myind Sound"` test fixture on the (separate, generic) teammate-invite template. This field holds whichever studio-side person sent the invite, not Pulse's identity, so it's arbitrary filler rather than a real assertion about the platform - but it explicitly pairs the real Lawrence with the exact retiring brand string, so I changed it to `"Lawrence at ThaMyind"` for genuine consistency rather than leaving a stray old-brand echo. `"Skyline Records"` (the fictional studio name in the same test) is untouched.
- `src/components/payments/invoice-sheet.tsx:46` - **initially changed, then reverted.** I first read this as platform (it's a static "Pulse Studio / Myind Sound" header on the real in-app invoice viewer, not wired to `invoice` data at all - every studio's invoice shows this literally, which is arguably an unrelated pre-existing bug worth its own ticket). Reverted after re-reading this task's own exclusion list, which names "sample invoices" explicitly as something to leave alone. Left as `"Myind Sound"`, matching the prior pass's decision too.
- `marketing/remotion/src/promo/scenesSpec.ts:112` - "glowing in Myind Sound yellow" (an internal shot-spec color reference to the brand gold used throughout Pulse's own UI). The prior pass left this alone as "not an attribution string." I read it differently this round given the broader brief ("anything [the platform] says about itself"): it's naming Pulse's own accent color by the pre-rename brand it came from, in a spec for a *Pulse* promo video. Changed to `"ThaMyind yellow"`. Flagging the disagreement with the prior pass's call in case Lawrence prefers it reverted.
- Email addresses, all "platform speaking" (from-address / support address / VAPID contact), all -> `@thamyind.com`: `convex/agent.ts:874`, `convex/clientEmail.ts:103` (`from:` on client-facing transactional email), `convex/contact.ts:33` (contact-form recipient fallback), `convex/lib/email.ts:15` (Resend `from` fallback), `convex/pushSend.ts:28` (`mailto:` VAPID subject). Domain `thamyind.com` has live MX records (`mail.thamyind.com`), confirmed by DNS lookup, so this isn't inventing an unreachable address - but Lawrence will still need Resend/webpush to actually be configured to send from it before deploy, same as the `PULSE_PUBLIC_HOST` note above.
- `STRIPE-CONNECT-SETUP.md:6` - "Lawrence / Myind Sound" (who does the Stripe dashboard setup) -> "Lawrence / ThaMyind".

**Sub-account, left alone:**

- `convex/demoRefresh.ts:19,24` (`PITCH_SLUGS = ["myind-sound"]` + comment), `convex/seed.ts`, `convex/seedDemoFinance.ts`, `convex/seedDemoFurniture.ts`, `convex/seedDemoYear.ts`, `convex/seedGuard.test.ts` - all reference the real demo/seed org by name or slug. Untouched per the explicit instruction not to rename `myind-sound` or touch `seed.ts`, extended to the sibling seed scripts that exist only to populate that same org.
- `src/app/(app)/dashboard/page.tsx:13`, `src/components/settings/data-panel.tsx:37,55,101` - "rebuild the Myind Sound demo workspace" copy/comments, same demo-org category.
- `src/components/settings/workspace-panel.tsx:152`, `branding-panel.tsx:366` - "Myind Sound" as a form-field placeholder example for a studio's own name/workspace field. Explicitly named in this task's exclusion list ("form placeholders").
- `src/components/payments/invoice-sheet.tsx:46` - see judgment call above; left alone.
- `src/components/marketing/dashboard-sim.tsx:396`, `mobile-sim.tsx:62` - "Myind Sound" as the example tenant name inside marketing-page dashboard/mobile mockups (illustrating what a studio's own workspace looks like). Marketing mock-ups, explicitly excluded.
- `src/components/marketing/logo-marquee.tsx:66` - "Myind Sound" listed as one of several client-studio logos under "Studios that trust ThaMyind" - a real customer of the platform, same bucket as Slang City Studios and Velvet Room Audio, not a maker credit.
- `src/lib/checkin-sign.test.ts:5,10,14`, `src/lib/parking-sign.test.ts:7` - test fixtures exercising a studio's own sign/QR-code branding (name, tagline, logo) with "Myind Sound" playing the role of "a studio," same as the real tenant would. Left alone; the domain literal in `checkin-sign.test.ts:5` was already `studiopulse.tech`.
- `convex/lib/emailTemplates/layout.test.ts:23,31` - `studioName: "Myind Sound"` fixtures for the generic branded-studio-email layout (the test's own title: "frames the STUDIO's name in the header and Pulse only in the footer"). Left alone; only the domain literals in the same file were changed (see section 2).
- `convex/portalUpgrades.test.ts:99,102` - `slug: "myindsound"` (no hyphen) is an arbitrary opaque test value for a booking-slug lookup, unrelated to the real `myind-sound` tenant or any brand meaning. Left as noise, not a brand trace.
- `README.md` - "populate the `pulse-demo` workspace with Myind Recording Co." (dev-setup instructions describing the seed studio's name). Left alone, same category as `seed.ts`.
- `convex/lib/sms.ts:20`, `scripts/ghl-sms.py:8` - comments naming the real GHL/LeadConnector location ("Myind Sound location") these features actually send SMS through. Real infrastructure fact, not branding; renaming the comment wouldn't change the real GHL account name and would make the comment inaccurate.
- `scripts/twilio-a2p-finish.py`, `scripts/twilio-a2p-resubmit.py`, `scripts/twilio-bundle-detail.py` - one-off scripts that already ran against Twilio's live API to register a real, approved A2P campaign under the domain and legal-entity name on file at filing time. Editing the text now wouldn't change what's actually registered with Twilio and would make the script a false record of what was submitted. Left entirely alone.
- `Grilled.md`, `LAUNCH-CHECKLIST.md` - internal engineering journals documenting real historical/current infra state (the live URL at time of writing, the real Clerk org id, the real verified Resend domain). Editing the text wouldn't change the underlying facts and would make the notes misleading. Left alone.
- `docs/superpowers/plans/**`, `docs/superpowers/specs/**`, other `docs/superpowers/reports/**` - historical planning/spec/report documents from past features, none of them shipped or user-facing. Consistent with the prior pass, which also left these untouched.
- `public/stripe-icon.png` - "Myind Sound x Pulse - 1" in embedded XMP/EXIF metadata (invisible, not rendered anywhere). Left alone; out of the scope of a text/code debrand and not visible to anyone.

**Out of scope entirely (different string, not this task's target):** "Myind Media LLC" and `info@myindmedia.org` (the actual registered legal entity in `src/components/marketing/legal-shell.tsx`, used by `src/app/privacy/page.tsx` and `src/app/terms/page.tsx`) do not match "myindsound" or "Myind Sound" and were not touched. This is a real, separately-registered LLC, distinct from the "Myind Sound" brand name this task retires; renaming it would be an actual legal-entity change, not a rebrand.

## Verification

- `npm test` - 169 files, 1444 tests, all passed.
- `npm run typecheck` - clean, no errors.
- `npm run lint` - 0 errors, 84 pre-existing warnings, none in any file this change touched.
- `git grep -in myindsound -- convex/marketing/posts.ts convex/lib/ghl.ts convex/lib/sms.ts src/app/opengraph-image.tsx` - only the one historical doc-comment in `posts.ts` remains; no literal in the User-Agent or OG-image lines.
- No em dashes introduced (checked the full diff).
