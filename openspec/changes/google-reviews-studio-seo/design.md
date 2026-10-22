## Context

Places API (New) policy: the place ID is the only Places content that may be stored indefinitely; everything else must be fetched, and Places content shown without a Google map carries Google attribution and each review's author attribution. Google's review-snippet structured-data rules forbid marking up ratings sourced from another site.

## Decisions

1. **Store only the place ID.** `orgs.googlePlaceId` plus connect time and the show switch. Name, address, rating and reviews are fetched live: in Settings through an authenticated Convex action, on public pages by the Next.js server.
2. **Public fetch happens on the Next.js server, not a public Convex action.** A public action that calls Google would let anyone run up the Google bill. The server fetch uses a server-only key and the rendered page is revalidated, so traffic does not fan out to Google per view. Revalidate window: 6 hours for profiles and cards. The database never holds Google content; the CDN holds a rendered page for at most that window.
3. **Two field masks.** Cards need rating, count and Maps link only. Profiles and booking pages add reviews.
4. **Review link derived from the place ID** (`https://search.google.com/local/writereview?placeid=…`), replacing the pasted URL when connected. The Growth tab shows it read-only while connected.
5. **Structured data**: `LocalBusiness` per profile with city and region (`addressLocality`, `addressRegion`), rooms as `makesOffer`, `aggregateRating` from Pulse's own published reviews only. `ItemList` on `/studios` and city pages. No private contact fields.
6. **City pages** at `/studios/in/<city-region slug>`, generated only when 2+ listed studios share it; fewer than 2 returns 404 and is left out of the sitemap so Google never indexes a thin page.
7. **Booking pages stay client-rendered** (live calendar), but a server `layout.tsx` adds title, description, canonical and Open Graph.
8. **No key, no feature.** Without `GOOGLE_PLACES_API_KEY` the Integrations card says Google reviews are not available yet, and public pages render without the Google section.
