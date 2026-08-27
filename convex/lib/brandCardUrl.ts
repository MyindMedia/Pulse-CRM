/* ============================================================
   Brand-card image URL - one builder for both sides of the wire.

   convex/marketing/posts.ts (payloadContext, the URL GHL fetches
   server-side) and src/components/social/media-picker.tsx (the composer's
   live preview) both need this exact string, and they must never be
   allowed to disagree about its shape again.

   Every input that changes the rendered PNG - postId, kind, and the post's
   updatedAt - lives in the PATH, not the query string. Netlify's CDN keys
   its cache on path only and drops the query string entirely, which was
   the production bug this fixes: a `?kind=...&v=...` URL meant whichever
   kind was fetched first for a post won forever (a Rate Promo post whose
   Open Slot card happened to be fetched first published the wrong card to
   a real Facebook page), and the `v` cache-buster did nothing, so editing
   a post never refreshed its card. Proven against production: two `kind`
   values on the same fresh path returned byte-identical PNGs; a different
   post id correctly returned a different size, so the route's own
   rendering was never the problem.

   The route keeps its long `Cache-Control: immutable` header - correct and
   desirable once the key is right, and what makes the card cheap for GHL
   to fetch repeatedly. Putting postId/kind/updatedAt in the path is what
   makes that header safe: the CDN's own cache key now distinguishes every
   input that changes the image, so nothing needs revalidating. */

export type BrandCardKind = "rate_card" | "open_slot" | "promo";

/** Root-relative path for the brand-card route. `version` is opaque here -
 *  callers pass the post's `updatedAt` so the path changes whenever the
 *  post's content might have, but this function does not care whether it
 *  arrives as a number (Convex's `updatedAt` field) or a string. */
export function brandCardPath(postId: string, kind: BrandCardKind, version: number | string): string {
  return `/api/brand-card/${postId}/${kind}/${version}`;
}
