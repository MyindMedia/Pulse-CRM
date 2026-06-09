"use client";

import { useParams } from "next/navigation";
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
import { MembershipPlans } from "@/components/book/membership-plans";

const STEPS = [
  { icon: MousePointerClick, label: "Pick a room", note: "Browse rooms and gear." },
  { icon: CalendarRange, label: "Choose a time", note: "See live availability." },
  { icon: CreditCard, label: "Pay to hold", note: "A deposit locks it in." },
];

const DEFAULT_HEADLINE = "Book studio time";

export default function StudioSlugFrontPage() {
  const { slug } = useParams<{ slug: string }>();
  const front = useQuery(api.booking.studioFront, { slug });

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

  return (
    <div
      className="space-y-12"
      style={{ "--studio-accent": accent } as React.CSSProperties}
    >
      {/* Hero */}
      <section className="space-y-6">
        {/* Studio mark + name */}
        <motion.div
          initial="hidden"
          animate="show"
          variants={staggerChildren(0.08)}
          className="space-y-6"
        >
          <motion.div variants={fadeUp} className="flex items-center gap-3">
            <span
              className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-graphite/60 bg-coal-2"
              style={{ boxShadow: `0 0 0 1px color-mix(in srgb, ${accent} 30%, transparent)` }}
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
              <span className="block text-xs text-steel/70">Studio booking</span>
            </span>
          </motion.div>

          <div className="max-w-2xl space-y-4">
            <motion.h1
              variants={fadeUp}
              className="font-grotesk text-4xl font-semibold tracking-tight text-bone sm:text-5xl"
            >
              {front ? (
                headline
              ) : (
                <span className="skeleton inline-block h-12 w-80 max-w-full rounded-md align-middle" />
              )}
            </motion.h1>
            <motion.p variants={fadeUp} className="text-base text-steel">
              {front ? (
                front.org.intro?.trim() ||
                front.org.tagline ||
                "Tracking rooms, vintage gear and an engineer who knows the desk. Pick a room and lock in your time."
              ) : (
                <span className="skeleton inline-block h-5 w-96 max-w-full rounded-md align-middle" />
              )}
            </motion.p>
            <motion.p
              variants={fadeUp}
              className="text-sm font-medium"
              style={{ color: front ? accent : undefined }}
            >
              Book studio time in three steps.
            </motion.p>
          </div>
        </motion.div>

        {/* Hero image */}
        {front?.org.heroUrl && (
          <motion.div
            initial="hidden"
            animate="show"
            variants={fadeUp}
            className="relative overflow-hidden rounded-lg border border-graphite/50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={front.org.heroUrl}
              alt={`${front.org.name} studio`}
              className="aspect-[21/9] w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/20 to-transparent" />
            <div
              className="absolute inset-x-0 bottom-0 h-1"
              style={{ backgroundColor: accent }}
              aria-hidden
            />
          </motion.div>
        )}

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

      {/* Rooms */}
      <section className="space-y-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-grotesk text-lg font-semibold tracking-tight text-bone">
            Bookable rooms
          </h2>
          {front && (
            <span className="text-xs text-steel/70">
              {front.rooms.length} {front.rooms.length === 1 ? "room" : "rooms"}{" "}
              available
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
              <RoomCard key={room._id} room={room} slug={slug} />
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

      {/* Memberships (hidden until the studio publishes a subscribable package) */}
      <MembershipPlans slug={slug} accent={accent} />
    </div>
  );
}
