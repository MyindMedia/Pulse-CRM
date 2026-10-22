import { Star } from "lucide-react";
import type { GooglePlace } from "@convex/lib/places";

/* Google rating and featured reviews, as Google returns them
   (openspec/changes/google-reviews-studio-seo).

   Google's attribution rules: content from Google is set apart from Pulse's
   own (its own bordered block), carries a "Google Maps" attribution, and
   each review credits its author with avatar, name and profile link. The
   reviews are shown in Google's order with nothing filtered out. */

function Stars({ value, size = "size-3.5" }: { value: number; size?: string }) {
  const rounded = Math.round(value);
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`${size} ${n <= rounded ? "fill-gold text-gold" : "text-steel/40"}`} />
      ))}
    </span>
  );
}

function Attribution() {
  return <span className="font-meta text-[0.625rem] uppercase tracking-[0.12em] text-steel/80">Google Maps</span>;
}

/** "4.7 ★★★★★ 128 Google reviews", linking to the listing on Google. */
export function GoogleRatingBadge({
  place,
  className,
  asLink = true,
}: {
  place: GooglePlace;
  className?: string;
  /** False inside a card that is already a link. */
  asLink?: boolean;
}) {
  if (place.rating === null || place.count === 0) return null;
  const label = `${place.rating.toFixed(1)} out of 5 from ${place.count} ${place.count === 1 ? "review" : "reviews"} on Google Maps`;
  const body = (
    <>
      <span className="font-meta text-bone">{place.rating.toFixed(1)}</span>
      <Stars value={place.rating} size="size-3" />
      <span className="text-steel">
        {place.count} {place.count === 1 ? "review" : "reviews"}
      </span>
      <Attribution />
    </>
  );
  const cls = `inline-flex flex-wrap items-center gap-1.5 rounded-md border border-graphite/60 bg-coal/50 px-2 py-1 text-xs ${className ?? ""}`;
  return asLink && place.reviewsUrl ? (
    <a href={place.reviewsUrl} target="_blank" rel="noopener noreferrer" aria-label={label} className={`${cls} hover:border-gold/50`}>
      {body}
    </a>
  ) : (
    <span aria-label={label} className={cls}>
      {body}
    </span>
  );
}

/** The "From Google" block: rating, Google's featured reviews, "See all". */
export function GoogleReviewsSection({ place, className }: { place: GooglePlace; className?: string }) {
  if (place.rating === null || place.count === 0) return null;
  return (
    <section aria-labelledby="google-reviews-h" className={`rounded-lg border border-graphite/60 bg-coal/40 p-5 ${className ?? ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="google-reviews-h" className="font-grotesk text-lg font-semibold tracking-tight text-bone">
          From Google
        </h2>
        <span className="flex items-center gap-2 text-xs text-steel">
          <Stars value={place.rating} />
          <span className="font-meta text-bone">{place.rating.toFixed(1)}</span>
          <span className="text-steel/70">
            · {place.count} {place.count === 1 ? "review" : "reviews"}
          </span>
        </span>
      </div>

      {place.reviews.length > 0 && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {place.reviews.map((r, i) => (
            <li key={i} className="flex min-w-0 flex-col gap-2 rounded-md border border-graphite/40 bg-ink/40 p-4">
              <div className="flex items-center gap-2.5">
                {r.authorPhotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.authorPhotoUrl} alt="" referrerPolicy="no-referrer" className="size-8 shrink-0 rounded-full object-cover" loading="lazy" />
                ) : (
                  <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-graphite/60 text-xs text-bone">
                    {r.authorName.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0">
                  {r.authorUrl ? (
                    <a href={r.authorUrl} target="_blank" rel="noopener noreferrer" className="block truncate text-sm text-bone hover:text-gold">
                      {r.authorName}
                    </a>
                  ) : (
                    <span className="block truncate text-sm text-bone">{r.authorName}</span>
                  )}
                  <span className="flex items-center gap-1.5 text-[0.6875rem] text-steel/70">
                    <Stars value={r.rating} size="size-3" />
                    <span className="sr-only">{r.rating} out of 5</span>
                    {r.when}
                  </span>
                </span>
              </div>
              {r.text && <p className="line-clamp-6 text-sm leading-relaxed text-mist/85">{r.text}</p>}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Attribution />
        {place.reviewsUrl && (
          <a href={place.reviewsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-gold underline-offset-2 hover:underline">
            See all {place.count} on Google
          </a>
        )}
      </div>
    </section>
  );
}
