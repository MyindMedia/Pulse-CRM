"use client";

import { useState } from "react";
import { OnboardingNudge } from "@/components/onboarding/onboarding-nudge";
import { GetPaidBanner } from "@/components/payments/get-paid-banner";
import { CustomizableDashboard } from "@/components/dashboard/customizable-dashboard";
import { PageHeader } from "@/components/ui/page";
import { longDate } from "@/lib/format";

/* No "load demo data" offer lives here.

   It used to: an empty roster surfaced a one-click button that wiped 18
   tables and refilled the studio as Myind Sound. On a real customer's
   dashboard that is an invitation to destroy their own workspace, and a new
   studio's roster is empty by definition - so the offer appeared to exactly
   the people it would hurt.

   Demo data is an agency decision. It lives in the agency console
   (DemoModeToggle), which tracks every seeded row so it can be withdrawn
   again without touching what the studio built. */

export default function DashboardPage() {
  const [lastRefreshed] = useState(() => Date.now());

  return (
    <div className="space-y-7">
      <OnboardingNudge />
      <GetPaidBanner />
      <PageHeader
        overline="Studio"
        title="Dashboard"
        description={`What's happening right now and everything moving through the studio - ${longDate(lastRefreshed)}.`}
      />

      {/* Every dashboard tile lives in the customizable grid - drag to
          reorder, remove, or add widgets from the tray (persists per user). */}
      <CustomizableDashboard />
    </div>
  );
}
