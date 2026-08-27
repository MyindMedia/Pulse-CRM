"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { fadeUp } from "@/lib/motion";
import { withTracking, type TrackingParams } from "@/lib/tracking-links";

/* A service card: what the studio does, at what price.

   No room is named. A studio with two rooms and five products was asking
   clients to pick "Live Room / Work Space" when what they wanted was a
   podcast - the room is the studio's business, and Pulse resolves it. */

export type ServiceCardData = {
  _id: string;
  name: string;
  blurb: string | null;
  pricingMode: "hourly" | "flat";
  priceCents: number;
  minimumHours: number | null;
  blockHours: number | null;
  heroUrl: string | null;
};

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function ServiceCard({
  service,
  slug,
  tracking,
}: {
  service: ServiceCardData;
  slug: string;
  /** Attribution params off the studio-front URL, threaded onto the service
   *  link the same way the room card threads them. A services-first studio
   *  is the only route a tracked post's visitor takes, so dropping them here
   *  loses the attribution outright. */
  tracking?: TrackingParams;
}) {
  const flat = service.pricingMode === "flat";
  const terms = flat
    ? `${service.blockHours ?? 1}-hour session`
    : service.minimumHours
      ? `${service.minimumHours}-hour minimum`
      : "Book by the hour";

  return (
    <motion.div variants={fadeUp}>
      <Link
        href={withTracking(`/book/${slug}/s/${service._id}`, tracking ?? {})}
        className="group flex h-full flex-col overflow-hidden rounded-lg border border-graphite/50 bg-coal transition-all hover:-translate-y-0.5 hover:border-gold-dim"
      >
        {service.heroUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={service.heroUrl}
            alt={service.name}
            className="aspect-[16/10] w-full object-cover"
          />
        )}
        <div className="flex flex-1 flex-col gap-3 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-grotesk text-lg font-semibold tracking-tight text-bone">
              {service.name}
            </h3>
            <p className="shrink-0 font-meta text-lg text-gold">
              {money(service.priceCents)}
              {!flat && <span className="text-xs text-steel">/hr</span>}
            </p>
          </div>
          <p className="font-meta text-[0.65rem] uppercase tracking-[0.06em] text-steel/70">
            {terms}
          </p>
          {service.blurb && (
            <p className="text-sm leading-relaxed text-steel">{service.blurb}</p>
          )}
          <span className="mt-auto inline-flex items-center gap-1.5 pt-1 font-meta text-xs uppercase tracking-[0.06em] text-gold transition-colors group-hover:text-gold-bright">
            Book this
            <ArrowRight className="size-3.5" />
          </span>
        </div>
      </Link>
    </motion.div>
  );
}
