"use client";

import * as React from "react";
import { PublicTheme } from "@/components/shell/public-theme";
import { useParams, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  Building2,
  CalendarRange,
  CreditCard,
  Disc3,
  MousePointerClick,
  SearchX,
  ShieldCheck,
} from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { fadeUp, staggerChildren } from "@/lib/motion";
import { RoomCard } from "@/components/book/room-card";
import { ServiceCard } from "@/components/book/service-card";
import { MembershipPlans } from "@/components/book/membership-plans";
import { SocialProof, EngineerRoster } from "@/components/book/social-proof";
import { useTrackBookingStep } from "@/lib/use-booking-funnel";
import { readTrackingParams } from "@/lib/tracking-links";

const STEPS = [
  { icon: MousePointerClick, label: "Pick a room", note: "Browse rooms and gear." },
  { icon: CalendarRange, label: "Choose a time", note: "See live availability." },
  { icon: CreditCard, label: "Pay to hold", note: "A deposit locks it in." },
];

const DEFAULT_HEADLINE = "Book studio time";

/* useSearchParams() must sit under a Suspense boundary for static export. */
export default function StudioSlugFrontPage() {
  return (
    <React.Suspense fallback={null}>
      <StudioFrontView />
    </React.Suspense>
  );
}

function StudioFrontView() {
  const { slug } = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  // Attribution params are threaded onto every card link so they survive the
  // front -> room/service -> booking navigation. This page is where a tracked
  // social link for a post with NO room lands, which makes it the only place
  // ?src= and ?code= can be carried down to the page that reads them; a
  // referral share link (?ref=<artistId>) rides along the same way.
  const tracking = React.useMemo(
    () => readTrackingParams(searchParams),
    [searchParams],
  );
  const front = useQuery(api.booking.studioFront, { slug });
  // The server decides: "services" only when the studio switched to it AND has
  // services live, so the page can never render an empty catalogue.
  const servicesFirst = front?.catalog === "services";
  // Anonymous funnel: how many people saw this page, against how many booked.
  useTrackBookingStep(slug, "page");

  // Studio could not be resolved from the slug.
  if (front === null) {
    return (
      <div className="py-12">
        <EmptyState
          icon={SearchX}
          title="Studio not found"
          description="This booking link does not point to a live studio. Check the address, or ask the studio for an up-to-date link."
        />
      </div>
    );
  }

  const accent = front?.org.accentColor ?? "var(--color-gold)";
  const headline = front?.org.headline?.trim() || DEFAULT_HEADLINE;
  // Manual hero photo wins; otherwise the AI-generated brand hero; otherwise
  // a palette gradient. Either way the hero is a full-bleed BACKGROUND under
  // a dark fade, with the booking copy living on top of it.
  const heroImage = front?.org.heroUrl ?? front?.org.generatedHeroUrl ?? null;
  const palette =
    front?.org.palette && front.org.palette.length > 0
      ? front.org.palette
      : [front?.org.accentColor ?? "#fdb913"];

  return (
    <div
      className="space-y-12"
      style={{ "--studio-accent": accent } as React.CSSProperties}
    >
      <PublicTheme slug={slug} />
      {/* ── Cinematic hero: full-bleed background + dark faded hue ── */}
      <section className="relative left-1/2 w-screen -translate-x-1/2 -mt-8 lg:-mt-12 overflow-hidden">
        {/* Background layer */}
        <div className="absolute inset-0" aria-hidden>
          {heroImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={heroImage}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className="h-full w-full"
              style={{
                background: `linear-gradient(120deg, ${palette[0]}33 0%, transparent 55%), radial-gradient(80% 120% at 85% 0%, ${palette[1] ?? palette[0]}26, transparent 60%), radial-gradient(60% 100% at 10% 100%, ${palette[2] ?? palette[0]}1a, transparent 65%), #121212`,
              }}
            />
          )}
          {/* Dark faded hue: readability fade + brand tint + blend into page */}
          <div className="absolute inset-0 bg-gradient-to-b from-ink/75 via-ink/40 to-ink" />
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(90% 70% at 75% 15%, ${palette[0]}14, transparent 60%)`,
            }}
          />
        </div>

        {/* Hero content */}
        <motion.div
          initial="hidden"
          animate="show"
          variants={staggerChildren(0.08)}
          className="relative mx-auto flex min-h-[440px] w-full max-w-6xl flex-col justify-end px-4 pb-14 pt-24 sm:min-h-[520px] lg:px-8"
        >
          <motion.div variants={fadeUp} className="mb-5 flex items-center gap-3">
            <span
              className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-white/10 bg-ink/60 backdrop-blur"
              style={{ boxShadow: `0 0 0 1px color-mix(in srgb, ${accent} 35%, transparent)` }}
            >
              {front?.org.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={front.org.logoUrl}
                  alt={`${front.org.name} logo`}
                  className="h-full w-full object-contain"
                />
              ) : (
                <Disc3 className="size-6" style={{ color: accent }} />
              )}
            </span>
            <span className="min-w-0">
              <span
                className="block text-[0.6875rem] font-medium uppercase tracking-[0.18em]"
                style={{ color: accent }}
              >
                {front ? (
                  front.org.name
                ) : (
                  <span className="skeleton inline-block h-3 w-32 max-w-full rounded align-middle" />
                )}
              </span>
              <span className="block text-xs text-mist/60">
                {front?.org.tagline?.trim() || "Studio booking"}
              </span>
            </span>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            className="max-w-3xl font-grotesk text-4xl font-semibold tracking-tight text-bone sm:text-6xl"
          >
            {front ? (
              headline
            ) : (
              <span className="skeleton inline-block h-12 w-80 max-w-full rounded-md align-middle" />
            )}
          </motion.h1>

          <motion.p variants={fadeUp} className="mt-4 max-w-xl text-base text-mist/85">
            {front ? (
              front.org.intro?.trim() ||
              front.org.tagline ||
              "Tracking rooms, vintage gear and an engineer who knows the desk. Pick a room and lock in your time."
            ) : (
              <span className="skeleton inline-block h-5 w-96 max-w-full rounded-md align-middle" />
            )}
          </motion.p>

          <motion.div variants={fadeUp} className="mt-7 flex flex-wrap items-center gap-4">
            <a
              href="#rooms"
              className="inline-flex items-center gap-2 rounded-md bg-gold px-6 py-3 font-grotesk text-sm font-semibold text-gold-ink transition-all duration-200 hover:-translate-y-0.5 hover:bg-gold-bright"
            >
              Book a room
            </a>
            <span className="text-xs text-mist/60">
              Live availability · A deposit locks it in
            </span>
          </motion.div>
        </motion.div>

        {/* Accent base line */}
        <div
          className="absolute inset-x-0 bottom-0 h-px opacity-60"
          style={{ background: `linear-gradient(to right, transparent, ${accent}, transparent)` }}
          aria-hidden
        />
      </section>

      <section className="space-y-6">
        {/* Steps */}
        <motion.ol
          initial="hidden"
          animate="show"
          variants={staggerChildren(0.06)}
          className="grid gap-3 sm:grid-cols-3"
        >
          {STEPS.map((step, i) => (
            <motion.li
              key={step.label}
              variants={fadeUp}
              className="glass flex items-start gap-3 rounded-lg border border-graphite/50 p-4"
            >
              <span
                className="grid size-9 shrink-0 place-items-center rounded-md bg-coal-2"
                style={{ color: accent }}
              >
                <step.icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium text-bone">
                  <span className="font-meta text-xs text-steel/70">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {step.label}
                </p>
                <p className="text-xs text-steel/70">{step.note}</p>
              </div>
            </motion.li>
          ))}
        </motion.ol>
      </section>

      {/* What is on offer: services for a studio that sells what it DOES,
          rooms for one whose spaces are its products. The switch is the
          studio's (orgs.bookingCatalog) and the server only reports
          "services" when there are services to show. */}
      <section id="rooms" className="scroll-mt-24 space-y-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-grotesk text-lg font-semibold tracking-tight text-bone">
            {servicesFirst ? "What do you want to do?" : "Bookable rooms"}
          </h2>
          {front && (
            <span className="text-xs text-steel/70">
              {servicesFirst
                ? `${front.services.length} ${front.services.length === 1 ? "service" : "services"}`
                : `${front.rooms.length} ${front.rooms.length === 1 ? "room" : "rooms"} available`}
            </span>
          )}
        </div>

        {!front ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-lg border border-graphite/50"
              >
                <Skeleton className="aspect-[16/10] w-full rounded-none" />
                <div className="space-y-3 p-5">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : servicesFirst ? (
          <motion.div
            initial="hidden"
            animate="show"
            variants={staggerChildren(0.06)}
            className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
          >
            {front.services.map((service) => (
              <ServiceCard key={service._id} service={service} slug={slug} tracking={tracking} />
            ))}
          </motion.div>
        ) : front.rooms.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No rooms open right now"
            description="This studio has not published any bookable rooms yet. Check back soon."
          />
        ) : (
          <motion.div
            initial="hidden"
            animate="show"
            variants={staggerChildren(0.06)}
            className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
          >
            {front.rooms.map((room) => (
              <RoomCard key={room._id} room={room} slug={slug} tracking={tracking} />
            ))}
          </motion.div>
        )}

        {/* Deposit policy */}
        {front && (
          <div
            className="flex items-start gap-2.5 rounded-md border border-graphite/50 bg-coal-2 px-4 py-3"
            style={{
              borderColor: `color-mix(in srgb, ${accent} 28%, transparent)`,
            }}
          >
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0"
              style={{ color: accent }}
            />
            <p className="text-xs text-steel">
              {front.org.depositPolicy?.trim() ||
                "A deposit holds your slot and is credited toward the final invoice. You will see the exact amount before you pay."}
            </p>
          </div>
        )}
      </section>

      {/* Meet the engineers - proof-of-work before room selection */}
      {front && <EngineerRoster engineers={front.engineers} />}

      {/* Social proof: aggregate rating, testimonials, recent reviews */}
      {front && (
        <SocialProof
          testimonials={front.testimonials}
          reviews={front.reviews}
          reviewStats={front.reviewStats}
          accent={accent}
        />
      )}

      {/* Memberships (hidden until the studio publishes a subscribable package) */}
      <MembershipPlans slug={slug} accent={accent} />
    </div>
  );
}
