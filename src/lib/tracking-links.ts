/* Attribution params that have to survive every hop of the public booking
   flow.

   A tracked social link does not always land on the page that consumes it. A
   post with no room picks `/book/<slug>` (convex/marketing/posts.ts,
   buildTrackedLink), so `?src=` and `?code=` arrive one level ABOVE the room
   page that reads them. Every link that goes deeper therefore has to carry
   them forward, or they are gone at the first click: the visitor books at
   full price despite the post advertising a discount, and the booking is
   written with no postId, so the post that actually drove it reports zero
   bookings and zero revenue.

   These four are exactly the params the funnel already reads off the live URL
   (src/lib/use-booking-funnel.ts) and that createBooking resolves server-side.
   Keeping the list here, in one place, is what stops the next link added to
   the booking flow from quietly dropping half of them again. */
export const TRACKING_PARAM_KEYS = ["ref", "src", "code", "utm_source"] as const;

export type TrackingParamKey = (typeof TRACKING_PARAM_KEYS)[number];

export type TrackingParams = Partial<Record<TrackingParamKey, string>>;

/** Pick the tracking params out of a query string. Blank and missing values
 *  are dropped, so an empty `?ref=` never becomes a stray `?ref=` on the next
 *  link. */
export function readTrackingParams(search: URLSearchParams | string): TrackingParams {
  const q = typeof search === "string" ? new URLSearchParams(search) : search;
  const out: TrackingParams = {};
  for (const key of TRACKING_PARAM_KEYS) {
    const value = q.get(key)?.trim();
    if (value) out[key] = value;
  }
  return out;
}

/** Append whatever tracking params are set onto an app-relative path.
 *
 *  Any query string already on the path is kept, and a param the path sets
 *  itself wins over the carried one: an explicit link beats an inherited
 *  tag. Values are percent-encoded by URLSearchParams. Paths here are plain
 *  app routes with no fragment. */
export function withTracking(path: string, params: TrackingParams): string {
  const [base, existing = ""] = path.split("?");
  const q = new URLSearchParams(existing);
  for (const key of TRACKING_PARAM_KEYS) {
    const value = params[key];
    if (value && !q.has(key)) q.set(key, value);
  }
  const query = q.toString();
  return query ? `${base}?${query}` : base;
}
