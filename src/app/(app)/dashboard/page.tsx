"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { OnboardingNudge } from "@/components/onboarding/onboarding-nudge";
import { GetPaidBanner } from "@/components/payments/get-paid-banner";
import { CustomizableDashboard } from "@/components/dashboard/customizable-dashboard";
import { Database } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { longDate } from "@/lib/format";

export default function DashboardPage() {
  const data = useQuery(api.dashboard.overview);
  const seed = useMutation(api.seed.run);
  const [seeding, setSeeding] = useState(false);
  const [lastRefreshed] = useState(() => Date.now());

  const empty = data && data.kpis.rosterSize === 0;

  return (
    <div className="space-y-7">
      <OnboardingNudge />
      <GetPaidBanner />
      <PageHeader
        overline="Studio"
        title="Dashboard"
        description={`What's happening right now and everything moving through the studio - ${longDate(lastRefreshed)}.`}
      />

      {empty && (
        <Card className="border-gold-dim/50 bg-gold/[0.04]">
          <CardContent className="flex flex-wrap items-center gap-4 pt-5">
            <span className="grid size-11 place-items-center rounded-lg bg-gold/15 text-gold">
              <Database className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-grotesk font-semibold text-bone">Load the demo studio</p>
              <p className="text-sm text-steel">
                Populate Pulse with Myind Sound - a full studio of artists, songs,
                sessions, invoices and deals so every screen is explorable.
              </p>
            </div>
            <Button
              onClick={async () => {
                setSeeding(true);
                try {
                  await seed({});
                } finally {
                  setSeeding(false);
                }
              }}
              disabled={seeding}
            >
              {seeding ? "Loading…" : "Load demo data"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Every dashboard tile lives in the customizable grid - drag to
          reorder, remove, or add widgets from the tray (persists per user). */}
      <CustomizableDashboard />
    </div>
  );
}
