## Why

Owner request, 2026-10-21: Google reviews should be a team-enabled integration that connects the studio's Google listing and shows it on the public booking page and in Find a Studio; and Find a Studio must surface on Google and in AI assistant answers. Decisions in `Grilled.md` (Google reviews integration + Find a Studio SEO).

Today the Google review link is a pasted URL in Settings > Growth, nothing from Google shows publicly, and `/studios` and every booking page render in the browser, so crawlers see almost nothing. There are no per-studio or per-city pages and the sitemap lists `/studios` only.

## What Changes

- **Google reviews integration** (Settings > Integrations): search Google for the business, pick the listing, connect. Stores the place ID only. A separate "Show on your booking page and in Find a Studio" switch. Connecting fills the Google review link used by review thank-you texts. Disconnect clears both.
- **Public display**: Google rating + count badge on Find a Studio cards and the booking page; a "From Google" section with Google's featured reviews, author attribution and a "See all on Google" link on the booking page and the studio profile. Fetched from Google at render time, never stored.
- **Find a Studio SEO**: `/studios` server-rendered with the listings in the HTML; new `/studios/<slug>` studio profiles and `/studios/in/<city>` city pages (2+ studios); JSON-LD (`ItemList`, `LocalBusiness`, `BreadcrumbList`); dynamic sitemap; llms.txt lists cities and studios; booking pages get server-rendered title, description, canonical and Open Graph.

## Impact

`convex/schema.ts` (orgs: `googlePlaceId`, `googlePlaceConnectedAt`, `googleReviewsShown`), new `convex/googlePlaces.ts`, new `convex/lib/places.ts`, `convex/directory.ts` (public place ID when shown, sitemap entries, city grouping), `src/lib/google-places.ts` (server-only fetch), `src/app/studios/**`, `src/app/book/[slug]/layout.tsx`, `src/app/sitemap.ts`, `src/lib/llms.ts`, integrations panel, growth panel. New env: `GOOGLE_PLACES_API_KEY` (Convex and Netlify, server only).
