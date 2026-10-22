import "server-only";
import {
  PLACES_BASE,
  PLACE_BADGE_FIELDS,
  PLACE_FULL_FIELDS,
  isPlaceId,
  parsePlace,
  type GooglePlace,
} from "@convex/lib/places";

/* Google rating and reviews for the public pages, fetched by the Next.js
   server (openspec/changes/google-reviews-studio-seo, decision 2).

   Never stored in the database. Each listing is fetched at most once per
   REVALIDATE window, so page traffic does not turn into Google traffic, and
   no public endpoint exists that would let a stranger spend the quota.
   Any failure renders the page without the Google section. */

const REVALIDATE_SECONDS = 6 * 3600;

export async function getGooglePlace(
  placeId: string | null | undefined,
  mode: "badge" | "full",
): Promise<GooglePlace | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key || !placeId || !isPlaceId(placeId)) return null;
  try {
    const res = await fetch(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}`, {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": mode === "full" ? PLACE_FULL_FIELDS : PLACE_BADGE_FIELDS },
      next: { revalidate: REVALIDATE_SECONDS, tags: [`google-place:${placeId}`] },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    const place = parsePlace(await res.json(), placeId);
    // A listing with no ratings yet has nothing worth a badge.
    return place && place.count > 0 && place.rating !== null ? place : null;
  } catch {
    return null;
  }
}

/** Badges for many listings at once (Find a Studio, City Pages). */
export async function getGoogleBadges(placeIds: Array<string | null>): Promise<Record<string, GooglePlace>> {
  const ids = [...new Set(placeIds.filter((id): id is string => Boolean(id)))];
  const places = await Promise.all(ids.map((id) => getGooglePlace(id, "badge")));
  const out: Record<string, GooglePlace> = {};
  places.forEach((p, i) => {
    if (p) out[ids[i]] = p;
  });
  return out;
}
