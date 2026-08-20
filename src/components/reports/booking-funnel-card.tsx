"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";

/* What the booking page converted, end to end.

   The headline is the point of the whole feature: the studio can finally be
   told what its page earned against what it was shown. Everything under it is
   the supporting detail. */

const STAGES = [
  { key: "page", label: "Saw the page" },
  { key: "room", label: "Opened a room" },
  { key: "checkout", label: "Reached the deposit" },
  { key: "booked", label: "Booked" },
] as const;

export function BookingFunnelCard({ days = 30 }: { days?: number }) {
  const f = useQuery(api.bookingFunnel.funnel, { days });

  if (!f) {
    return (
      <Card>
        <CardContent className="pt-5">
          <p className="text-sm text-steel">Loading the booking funnel…</p>
        </CardContent>
      </Card>
    );
  }

  const top = Math.max(f.counts.page, 1);

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gold/12 text-gold">
            <Filter className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="font-grotesk text-sm font-semibold text-bone">Booking funnel</p>
            <p className="text-xs text-steel">Last {f.windowDays} days</p>
          </div>
          <span className="ml-auto shrink-0 font-mono text-sm tabular-nums text-gold">
            {f.conversionRate}%
          </span>
        </div>

        <p className="text-sm leading-relaxed text-bone">{f.headline}</p>

        <div className="space-y-1.5">
          {STAGES.map((s, i) => {
            const n = f.counts[s.key];
            const pct = Math.round((n / top) * 100);
            const prev = i === 0 ? null : f.counts[STAGES[i - 1].key];
            const dropped = prev !== null ? prev - n : null;
            return (
              <div key={s.key}>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-steel">{s.label}</span>
                  <span className="font-mono tabular-nums text-bone">{n}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-graphite/40">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-500",
                      s.key === "booked" ? "bg-gold" : "bg-gold/35",
                    )}
                    style={{ width: `${Math.max(pct, n > 0 ? 3 : 0)}%` }}
                  />
                </div>
                {dropped !== null && dropped > 0 && (
                  <p className="mt-0.5 text-[0.625rem] text-steel/60">
                    {dropped} dropped here
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {f.sources.length > 0 && (
          <div className="border-t border-graphite/50 pt-3">
            <p className="font-meta text-[0.625rem] uppercase tracking-[0.08em] text-steel/60">
              Where they came from
            </p>
            <ul className="mt-1.5 space-y-1">
              {f.sources.slice(0, 5).map((s) => (
                <li key={s.source} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="truncate capitalize text-steel">{s.source}</span>
                  <span className="shrink-0 font-mono tabular-nums text-steel/80">
                    {s.visitors} → {s.booked}
                    {s.revenueCents > 0 && (
                      <span className="ml-2 text-bone">
                        ${(s.revenueCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
