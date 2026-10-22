## Context

Places API (New) policy: the place ID is the only Places content that may be stored indefinitely; everything else must be fetched, and Places content shown without a Google map carries Google attribution and each review's author attribution. Google's review-snippet structured-data rules forbid marking up ratings sourced from another site.

## Decisions

1. **Store only the place ID.** `orgs.googlePlaceId` plus connect time and the show switch. Name, address, rating and reviews are fetched live: in Settings through an authenticated Convex action, on public pages by the Next.js server.
2. **Public fetch happens on the Next.js server, not a public Convex action.** A public action that calls Google would let anyone run up the Google bill. The server fetch uses a server-only key and the rendered page is revalidated, so traffic does not fan out to Google per view. Revalidate window: 6 hours for profiles and cards. The database never holds Google content; the CDN holds a rendered page for at most that window.
3. **Two field masks.** Cards need rating, count and Maps link only. Profiles and booking pages add reviews.
4. **Review link derived from the place ID** (`https://search.google.com/local/writereview?placeid=…`), replacing the pasted URL when connected. The Growth tab shows it read-only while connected.
5. **Structured data**: `LocalBusiness` per profile with city and region (`addressLocality`, `addressRegion`), rooms as `makesOffer` with hourly prices (omitted when the studio hides pricing), a `ReserveAction` pointing at the booking page, and `BreadcrumbList`. `ItemList` on `/studios` and City Pages. No private contact fields. **No `aggregateRating`:** Google's ratings may not be marked up (third-party), and Pulse's published reviews are the 4 and 5 star ones, so an average of them would overstate the rating. Google also ignores self-serving review markup on `LocalBusiness`.
6. **City pages** at `/studios/in/<city-region slug>`, generated only when 2+ listed studios share it; fewer than 2 returns 404 and is left out of the sitemap so Google never indexes a thin page.
7. **Booking pages stay client-rendered** (live calendar), but a server `layout.tsx` adds title, description, canonical and Open Graph.
8. **No key, no feature.** Without `GOOGLE_PLACES_API_KEY` the Integrations card says Google reviews are not available yet, and public pages render without the Google section.

## Decisions made while building

- **Profiles link from Find a Studio cards.** Cards now open `/studios/<slug>` (the Studio Profile) instead of the booking page, so search engines follow a link to a page about the studio; the profile's main button goes to the booking page.
- **Booking page canonical.** The server layout under `/book/<slug>` sets the canonical to `/book/<slug>` for the room, service and checkout pages under it too, so Google indexes the studio's booking front, not each step.
- **Linking confirms the place with Google first** (a details call), so a typo'd or invented place ID is refused before anything is saved. Pulse cannot prove the studio owns the listing without Google sign-in (phase 2); the Google section always shows the listing's own name, and linking is logged in the studio's activity.
- **City Pages live at `/studios/in/<city>`**, so a studio slug can never collide with a city.
- **The Growth tab's pasted review link** is locked while a Google Listing is linked; unlinking restores the pasted one if the studio had set its own.
