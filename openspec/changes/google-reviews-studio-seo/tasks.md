## 1. Backend
- [ ] 1.1 Schema: orgs `googlePlaceId`, `googlePlaceConnectedAt`, `googleReviewsShown`
- [ ] 1.2 `convex/lib/places.ts`: request builders, response parsers, write-review URL, city slug
- [ ] 1.3 `convex/googlePlaces.ts`: `status` query, `search` + `details` actions (branding.edit), `connect`, `disconnect`, `setShown` mutations with activity log
- [ ] 1.4 Directory: listing carries `googlePlaceId` only when shown; `sitemapEntries`, `city` queries
- [ ] 1.5 Tests

## 2. Public pages
- [ ] 2.1 Server-only Google fetch helper with revalidate and attribution data
- [ ] 2.2 `/studios` server-rendered, client filters hydrate from it, rating badges
- [ ] 2.3 `/studios/<slug>` profile with JSON-LD
- [ ] 2.4 `/studios/in/<city>` city pages with JSON-LD
- [ ] 2.5 Booking page: server metadata layout, Google badge + "From Google" section
- [ ] 2.6 Dynamic sitemap, llms.txt studios section

## 3. Settings
- [ ] 3.1 Integrations: Google reviews card (search, connect, show switch, disconnect)
- [ ] 3.2 Growth: review link read-only while connected

## 4. Ship
- [ ] 4.1 Typecheck, full tests, build
- [ ] 4.2 Pentest gate, PR, merge, Convex deploy, live checks
