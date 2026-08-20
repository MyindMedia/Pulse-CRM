"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { MapPin, Search, CalendarCheck, DoorOpen, SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/format";

/* Find a Studio on Pulse.

   The front door for artists who have never heard of Pulse. Every listing
   links to that studio's own booking page, and Pulse takes nothing from what
   it sends. The commission is the reason the last two of these died. */

function openLabel(at: number | null): string {
  if (at === null) return "Booked out for a fortnight";
  const days = Math.round((at - Date.now()) / 86_400_000);
  if (days <= 0) return "Free today";
  if (days === 1) return "Free tomorrow";
  return `Free in ${days} days`;
}

export default function StudiosPage() {
  const [q, setQ] = React.useState("");
  const [city, setCity] = React.useState("");
  const [openOnly, setOpenOnly] = React.useState(false);

  const res = useQuery(api.directory.search, {
    q: q.trim() || undefined,
    city: city || undefined,
    openWithinDays: openOnly ? 7 : undefined,
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-12 sm:py-16">
      <header className="max-w-2xl">
        <p className="font-meta text-[0.6875rem] uppercase tracking-[0.16em] text-steel">
          Find a studio on Pulse
        </p>
        <h1 className="mt-3 font-grotesk text-3xl font-bold tracking-tight text-bone sm:text-4xl">
          Real rooms, real rates, real open dates.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-steel">
          Every studio here runs on Pulse, so the availability is the actual calendar and
          the booking goes straight to them. No commission, no middleman.
        </p>
      </header>

      <div className="mt-8 flex flex-wrap gap-2">
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel/60" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="City, room type, console, studio name"
            aria-label="Search studios"
            className="w-full rounded-md border border-graphite/60 bg-coal/40 py-2.5 pl-9 pr-3 text-sm text-bone outline-none placeholder:text-steel/50 focus:border-gold"
          />
        </label>
        <select
          value={city}
          onChange={(e) => setCity(e.target.value)}
          aria-label="Filter by city"
          className="rounded-md border border-graphite/60 bg-coal/40 px-3 py-2.5 text-sm text-bone outline-none focus:border-gold"
        >
          <option value="">Everywhere</option>
          {(res?.cities ?? []).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-graphite/60 bg-coal/40 px-3 py-2.5 text-sm text-steel">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
            className="accent-gold"
          />
          Free this week
        </label>
      </div>

      {res === undefined ? (
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full rounded-lg" />)}
        </div>
      ) : res.listings.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            icon={SearchX}
            title="No studios match that yet"
            description="Try a wider search, or check back as more studios list themselves."
          />
        </div>
      ) : (
        <>
          <p className="mt-8 font-meta text-[0.6875rem] uppercase tracking-[0.1em] text-steel/70">
            {res.total} studio{res.total === 1 ? "" : "s"}
          </p>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {res.listings.map((l) => (
              <li key={l.slug}>
                <Link
                  href={l.bookingPath}
                  className="group flex h-full flex-col overflow-hidden rounded-lg border border-graphite/50 bg-coal-2 transition-colors hover:border-gold/50"
                >
                  {l.heroUrl && (
                    <img
                      src={l.heroUrl}
                      alt=""
                      className="h-32 w-full object-cover"
                      loading="lazy"
                    />
                  )}
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <div className="flex items-start gap-3">
                      {l.logoUrl && (
                        <img
                          src={l.logoUrl}
                          alt=""
                          className="size-9 shrink-0 rounded-md object-contain"
                          loading="lazy"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-grotesk text-sm font-semibold text-bone group-hover:text-gold">
                          {l.name}
                        </p>
                        {(l.city || l.region) && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-steel">
                            <MapPin className="size-3" />
                            {[l.city, l.region].filter(Boolean).join(", ")}
                          </p>
                        )}
                      </div>
                    </div>

                    {l.blurb && (
                      <p className="line-clamp-2 text-xs leading-relaxed text-steel/80">{l.blurb}</p>
                    )}

                    <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs">
                      <span className="flex items-center gap-1.5 text-steel">
                        <DoorOpen className="size-3.5 text-steel/60" />
                        {l.roomCount} room{l.roomCount === 1 ? "" : "s"}
                      </span>
                      {l.fromHourlyCents !== null && (
                        <span className="text-steel">
                          from <span className="text-bone">{money(l.fromHourlyCents)}</span>/hr
                        </span>
                      )}
                      <span
                        className={`ml-auto flex items-center gap-1.5 ${
                          l.nextOpenAt === null ? "text-steel/60" : "text-gold"
                        }`}
                      >
                        <CalendarCheck className="size-3.5" />
                        {openLabel(l.nextOpenAt)}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-12 border-t border-graphite/50 pt-5 text-xs text-steel/60">
        Run a studio?{" "}
        <Link href="/" className="text-gold underline-offset-2 hover:underline">
          List it free on Pulse
        </Link>
        .
      </p>
    </main>
  );
}
