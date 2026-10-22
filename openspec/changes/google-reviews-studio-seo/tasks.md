## 1. Backend
- [x] 1.1 Schema: orgs `googlePlaceId`, `googlePlaceConnectedAt`, `googleReviewsShown`
- [x] 1.2 `convex/lib/places.ts`: request builders, response parsers, write-review URL, city slug
- [x] 1.3 `convex/googlePlaces.ts`: `status` query, `search` + `details` actions (branding.edit), `connect`, `disconnect`, `setShown` mutations with activity log
- [x] 1.4 Directory: listing carries `googlePlaceId` only when shown; `sitemapEntries`, `city` queries
- [x] 1.5 Tests

## 2. Public pages
- [x] 2.1 Server-only Google fetch helper with revalidate and attribution data
- [x] 2.2 `/studios` server-rendered, client filters hydrate from it, rating badges
- [x] 2.3 `/studios/<slug>` profile with JSON-LD
- [x] 2.4 `/studios/in/<city>` city pages with JSON-LD
- [x] 2.5 Booking page: server metadata layout, Google badge + "From Google" section
- [x] 2.6 Dynamic sitemap, llms.txt studios section

## 3. Settings
- [x] 3.1 Integrations: Google reviews card (search, connect, show switch, disconnect)
- [x] 3.2 Growth: review link read-only while connected

## 4. Ship
- [x] 4.1 Typecheck, full tests, build
- [ ] 4.2 Pentest gate, PR, merge, Convex deploy, live checks
