"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Bot, ArrowRight, ShieldCheck } from "lucide-react";
import { PageHeader, Section } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { relativeTime } from "@/lib/format";

export default function AgencyAutopilotPage() {
  const portfolio = useQuery(api.agencyOps.portfolio);

  return (
    <div className="space-y-8">
      <PageHeader
        overline="Agency"
        title="Ops Autopilot"
        description="Every studio's operational queue in one board - sorted by who needs attention first."
      />

      <Section title="Studios by attention">
        {portfolio === undefined ? (
          <SkeletonRows rows={4} />
        ) : portfolio.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="No subaccounts yet"
            description="Once you provision studios, the autopilot's daily scan will surface their open actions here."
          />
        ) : (
          <div className="space-y-2">
            {portfolio.map((s) => (
              <Card key={s.orgId}>
                <CardContent className="flex flex-wrap items-center gap-4 p-4">
                  <span className="grid size-10 place-items-center rounded-md border border-gold-dim/40 bg-gold/10 text-gold">
                    {s.openHigh > 0 ? <Bot className="size-5" /> : <ShieldCheck className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-sm font-semibold text-bone">{s.name}</p>
                    <p className="font-mono text-[0.625rem] uppercase text-ash-dim">
                      last scan {s.lastScanAt ? relativeTime(s.lastScanAt) : "never"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.openHigh > 0 && (
                      <Badge tone="critical">{s.openHigh} high</Badge>
                    )}
                    <Badge tone="neutral">{s.openTotal} open</Badge>
                  </div>
                  <Link
                    href={`/agency/${s.orgId}`}
                    className="flex h-8 items-center gap-1.5 rounded-md border border-hairline-2 bg-coal/60 px-3 text-xs font-medium text-ash transition-colors hover:border-gold-dim hover:text-bone"
                  >
                    Open <ArrowRight className="size-3.5" />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
