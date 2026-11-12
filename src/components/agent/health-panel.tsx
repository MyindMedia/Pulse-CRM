"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Gauge } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const BAND_TONE = { strong: "positive", steady: "info", watch: "caution", "at risk": "critical" } as const;

/** The studio health score: six fixed parts, fixed weights (convex/agentHealth.ts).
 *  Sold on every plan, so it is shown on the dashboard as well as the Agent page. */
export function HealthPanel() {
  const health = useQuery(api.agentHealth.studioHealth, {});
  if (health === undefined) return null;
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-chrome bg-gold/12 text-gold"><Gauge className="size-6" /></span>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="font-grotesk text-3xl font-bold text-bone">{health.overall}</span>
                <span className="text-sm text-steel/70">/100</span>
                <Badge tone={BAND_TONE[health.band as keyof typeof BAND_TONE]}>{health.band}</Badge>
              </div>
              <p className="text-xs text-steel/70">Studio health</p>
            </div>
          </div>
          <div className="grid flex-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {health.components.map((c) => (
              <div key={c.key}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-steel">{c.label}</span>
                  <span className="font-meta text-steel/70">{c.score}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-coal-3">
                  <div className={cn("h-full rounded-full", c.score >= 70 ? "bg-positive" : c.score >= 45 ? "bg-gold" : "bg-critical")} style={{ width: `${c.score}%` }} />
                </div>
                <p className="mt-0.5 text-[0.625rem] text-steel/70">{c.signal}</p>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
