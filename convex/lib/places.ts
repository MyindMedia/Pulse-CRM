/* ============================================================
   Google Listing helpers (openspec/changes/google-reviews-studio-seo).
   Pure: no Convex, no fetch. Shared by the Convex settings actions and
   the Next.js server that renders the public pages.

   Google Places terms: the place ID is the only thing Pulse may store.
   Everything parsed here is shown and thrown away.
   ============================================================ */

export const PLACES_BASE = "https://places.googleapis.com/v1";

/** Cards need the badge only; profiles and booking pages add reviews. */
export const PLACE_BADGE_FIELDS = "id,rating,userRatingCount,googleMapsUri";
export const PLACE_FULL_FIELDS =
  "id,displayName,formattedAddress,rating,userRatingCount,googleMapsUri,googleMapsLinks.reviewsUri,reviews";
export const PLACE_SEARCH_FIELDS = "places.id,places.displayName,places.formattedAddress";

const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,300}$/;

export function isPlaceId(id: string): boolean {
  return PLACE_ID_RE.test(id);
}

/** The "leave a review" link Google documents for a place ID. */
export function writeReviewUrl(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

export type PlaceCandidate = { placeId: string; name: string; address: string };

export type GoogleReview = {
  rating: number;
  text: string;
  when: string;
  authorName: string;
  authorUrl: string | null;
  authorPhotoUrl: string | null;
};

export type GooglePlace = {
  placeId: string;
  name: string | null;
  address: string | null;
  rating: number | null;
  count: number;
  mapsUrl: string | null;
  reviewsUrl: string | null;
  reviews: GoogleReview[];
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function httpsUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    return new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
}

export function parseSearch(json: unknown): PlaceCandidate[] {
  const places = (json as { places?: unknown[] } | null)?.places;
  if (!Array.isArray(places)) return [];
  const out: PlaceCandidate[] = [];
  for (const p of places) {
    const r = p as { id?: unknown; displayName?: { text?: unknown }; formattedAddress?: unknown };
    const placeId = str(r.id);
    if (!placeId || !isPlaceId(placeId)) continue;
    out.push({ placeId, name: str(r.displayName?.text) ?? "Unnamed place", address: str(r.formattedAddress) ?? "" });
  }
  return out.slice(0, 5);
}

export function parsePlace(json: unknown, placeId: string): GooglePlace | null {
  if (!json || typeof json !== "object") return null;
  const r = json as Record<string, unknown>;
  const rating = typeof r.rating === "number" && r.rating >= 1 && r.rating <= 5 ? Math.round(r.rating * 10) / 10 : null;
  const count = typeof r.userRatingCount === "number" && r.userRatingCount > 0 ? Math.floor(r.userRatingCount) : 0;
  const reviews: GoogleReview[] = [];
  if (Array.isArray(r.reviews)) {
    for (const raw of r.reviews) {
      const v = raw as {
        rating?: unknown;
        text?: { text?: unknown };
        originalText?: { text?: unknown };
        relativePublishTimeDescription?: unknown;
        authorAttribution?: { displayName?: unknown; uri?: unknown; photoUri?: unknown };
      };
      const stars = typeof v.rating === "number" ? Math.round(v.rating) : 0;
      if (stars < 1 || stars > 5) continue;
      reviews.push({
        rating: stars,
        text: str(v.text?.text) ?? str(v.originalText?.text) ?? "",
        when: str(v.relativePublishTimeDescription) ?? "",
        authorName: str(v.authorAttribution?.displayName) ?? "Google user",
        authorUrl: httpsUrl(v.authorAttribution?.uri),
        authorPhotoUrl: httpsUrl(v.authorAttribution?.photoUri),
      });
    }
  }
  const links = r.googleMapsLinks as { reviewsUri?: unknown } | undefined;
  return {
    placeId,
    name: str((r.displayName as { text?: unknown } | undefined)?.text),
    address: str(r.formattedAddress),
    rating,
    count,
    mapsUrl: httpsUrl(r.googleMapsUri),
    reviewsUrl: httpsUrl(links?.reviewsUri) ?? httpsUrl(r.googleMapsUri),
    // Google returns up to five, in its own order. Shown as returned: Pulse
    // never picks which Google reviews a visitor sees.
    reviews: reviews.slice(0, 5),
  };
}

/** "Los Angeles" + "CA" -> "los-angeles-ca". The City Page URL key. */
export function citySlug(city: string, region?: string | null): string {
  return [city, region ?? ""]
    .join(" ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A City Page exists only once this many Listed Studios share the city. */
export const CITY_PAGE_MIN_STUDIOS = 2;
