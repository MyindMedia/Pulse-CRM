"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CountUp } from "@/components/shell/app-motion";
import { money } from "@/lib/format";

/* "Recovered by Pulse" - the renewal-proof number. Every dollar Pulse actively
   claws back (forfeited deposits, late-cancel + no-show fees, waitlist backfills,
   reminder-driven collections) rolls up here so the subscription visibly pays
   for itself. Gold-accented; finance-gated at the dashboard level. */
export function RecoveredByPulse() {
  const data = useQuery(api.recovery.summary);

  return (
    <Card className="border-gold-dim/50 bg-gold/[0.04]">
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-md bg-gold/15 text-gold">
            <ShieldCheck className="size-4" />
          </span>
          <CardTitle>Recovered by Pulse</CardTitle>
        </div>
        <Badge tone="gold">ROI</Badge>
      </CardHeader>
      <CardContent>
        {data === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : data.totalCents === 0 ? (
          <div className="py-8 text-center">
            <p className="font-grotesk text-lg font-semibold text-bone">$0 so far</p>
            <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-steel">
              As Pulse recovers deposits, fees and no-shows for you, it will add up here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="overline">All-time recovered</p>
              <p className="mt-1 font-grotesk text-4xl font-bold tracking-tight text-gold">
                <CountUp to={data.totalCents} format={(n) => money(n)} />
              </p>
              <p className="mt-1 text-sm text-steel">
                {money(data.thisMonthCents)} this month · {money(data.last30Cents)} last 30 days
              </p>
            </div>

            {data.byKind.length > 0 && (
              <ul className="space-y-1.5 border-t border-hairline pt-3">
                {data.byKind.map((k) => (
                  <li key={k.kind} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-steel">{k.label}</span>
                    <span className="shrink-0 font-grotesk font-semibold tabular-nums text-bone">
                      {money(k.amountCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-[0.6875rem] text-steel/70">
              {data.count} recovery {data.count === 1 ? "event" : "events"} logged. This is money Pulse
              saved that would otherwise have walked out the door.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
