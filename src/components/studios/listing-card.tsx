import Link from "next/link";
import { MapPin, DoorOpen } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import type { GooglePlace } from "@convex/lib/places";
import { money } from "@/lib/format";
import { GoogleRatingBadge } from "@/components/google/google-reviews";

export type StudioListing = Omit<NonNullable<FunctionReturnType<typeof api.directory.listing>>, "hasCityPage">;

/** One studio in a server-rendered list (City Pages). */
export function ListingCard({ l, google }: { l: StudioListing; google?: GooglePlace }) {
  return (
    <Link
      href={`/studios/${l.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-lg border border-graphite/50 bg-coal-2 transition-colors hover:border-gold/50"
    >
      {l.heroUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={l.heroUrl} alt="" className="h-32 w-full object-cover" loading="lazy" />
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h2 className="truncate font-grotesk text-sm font-semibold text-bone group-hover:text-gold">{l.name}</h2>
        {(l.city || l.region) && (
          <p className="flex items-center gap-1 text-xs text-steel">
            <MapPin className="size-3" />
            {[l.city, l.region].filter(Boolean).join(", ")}
          </p>
        )}
        {google && <GoogleRatingBadge place={google} asLink={false} className="self-start" />}
        {l.blurb && <p className="line-clamp-2 text-xs leading-relaxed text-steel/80">{l.blurb}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-steel">
          <span className="flex items-center gap-1.5">
            <DoorOpen className="size-3.5 text-steel/60" />
            {l.roomCount} room{l.roomCount === 1 ? "" : "s"}
          </span>
          {l.fromHourlyCents !== null && (
            <span>
              from <span className="text-bone">{money(l.fromHourlyCents)}</span>/hr
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
