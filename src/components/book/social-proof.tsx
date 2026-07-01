"use client";

import * as React from "react";
import { Quote, Star, UserRound } from "lucide-react";

/* Shapes mirror api.booking.studioFront / api.booking.room social-proof fields. */
export type Testimonial = {
  author: string;
  role?: string;
  quote: string;
  rating?: number;
};
export type PublicReview = {
  rating: number;
  text: string | null;
  authorName: string | null;
  at: number;
};
export type ReviewStats = { count: number; average: number };
export type EngineerProfile = {
  id: string;
  name: string;
  role: string;
  bio: string | null;
  credits: string[];
  photoUrl: string | null;
};

function Stars({ value, className }: { value: number; className?: string }) {
  const rounded = Math.round(value);
  return (
    <span className={`inline-flex items-center gap-0.5 ${className ?? ""}`} aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`size-3.5 ${n <= rounded ? "fill-gold text-gold" : "text-steel/40"}`}
        />
      ))}
    </span>
  );
}

/**
 * The conversion layer for the public booking page: an aggregate rating,
 * curated testimonials, and the most recent published reviews. Renders nothing
 * until there is at least one piece of proof, so an empty studio page stays
 * clean rather than showing a hollow "0 reviews" block.
 */
export function SocialProof({
  testimonials,
  reviews,
  reviewStats,
  accent,
  className,
}: {
  testimonials: Testimonial[];
  reviews: PublicReview[];
  reviewStats: ReviewStats;
  accent?: string;
  className?: string;
}) {
  const hasReviews = reviewStats.count > 0;
  const hasTestimonials = testimonials.length > 0;
  if (!hasReviews && !hasTestimonials) return null;

  return (
    <section className={`space-y-5 ${className ?? ""}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-grotesk text-lg font-semibold tracking-tight text-bone">
          What clients say
        </h2>
        {hasReviews && (
          <span className="flex items-center gap-2 text-xs text-steel">
            <Stars value={reviewStats.average} />
            <span className="font-meta text-bone">{reviewStats.average.toFixed(1)}</span>
            <span className="text-steel/70">
              · {reviewStats.count} {reviewStats.count === 1 ? "review" : "reviews"}
            </span>
          </span>
        )}
      </div>

      {hasTestimonials && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {testimonials.map((t, i) => (
            <figure
              key={i}
              className="flex h-full flex-col rounded-lg border border-graphite/50 bg-coal p-5"
            >
              <Quote
                className="size-5 shrink-0"
                style={{ color: accent ?? "var(--color-gold)" }}
                aria-hidden
              />
              <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-mist/90">
                {t.quote}
              </blockquote>
              <figcaption className="mt-4 flex items-center justify-between gap-2 border-t border-graphite/50 pt-3">
                <span className="min-w-0">
                  <span className="block truncate font-grotesk text-sm font-medium text-bone">
                    {t.author}
                  </span>
                  {t.role && (
                    <span className="block truncate text-xs text-steel/70">{t.role}</span>
                  )}
                </span>
                {t.rating ? <Stars value={t.rating} /> : null}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {reviews.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {reviews
            .filter((r) => r.text && r.text.trim())
            .slice(0, 4)
            .map((r, i) => (
              <div
                key={i}
                className="rounded-lg border border-graphite/50 bg-coal-2 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-bone">
                    {r.authorName?.trim() || "Verified client"}
                  </span>
                  <Stars value={r.rating} />
                </div>
                <p className="mt-2 text-sm text-steel">{r.text}</p>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

/**
 * "Meet the engineers" - the studio's engineers who have a published bio or
 * notable credits. Proof-of-work at the top of the funnel, so the client
 * arrives at room selection already trusting the people behind the desk.
 */
export function EngineerRoster({
  engineers,
  className,
}: {
  engineers: EngineerProfile[];
  className?: string;
}) {
  if (engineers.length === 0) return null;
  return (
    <section className={`space-y-5 ${className ?? ""}`}>
      <h2 className="font-grotesk text-lg font-semibold tracking-tight text-bone">
        Meet your engineers
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {engineers.map((e) => (
          <div
            key={e.id}
            className="flex h-full flex-col rounded-lg border border-graphite/50 bg-coal p-5"
          >
            <div className="flex items-center gap-3">
              {e.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={e.photoUrl}
                  alt=""
                  className="size-12 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-coal-3 text-steel">
                  <UserRound className="size-5" />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate font-grotesk text-sm font-semibold text-bone">
                  {e.name}
                </p>
                <p className="truncate text-xs capitalize text-steel/70">
                  {e.role.replace(/_/g, " ")}
                </p>
              </div>
            </div>
            {e.bio && <p className="mt-3 text-sm leading-relaxed text-steel">{e.bio}</p>}
            {e.credits.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {e.credits.slice(0, 6).map((c, i) => (
                  <span
                    key={i}
                    className="rounded-full border border-graphite/50 bg-coal-2 px-2 py-0.5 text-[0.6875rem] text-mist/80"
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
