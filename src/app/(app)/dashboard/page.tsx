"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { OnboardingNudge } from "@/components/onboarding/onboarding-nudge";
import { GetPaidBanner } from "@/components/payments/get-paid-banner";
import { CustomizableDashboard } from "@/components/dashboard/customizable-dashboard";
import { BookSessionDialog } from "@/components/calendar/book-session-dialog";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { useOptionalUser } from "@/lib/use-optional-clerk";
import { DashboardPeriodProvider, PeriodKeys } from "@/components/dashboard/hw/period";

/* No "load demo data" offer lives here.

   It used to: an empty roster surfaced a one-click button that wiped 18
   tables and refilled the studio as Myind Sound. On a real customer's
   dashboard that is an invitation to destroy their own workspace, and a new
   studio's roster is empty by definition - so the offer appeared to exactly
   the people it would hurt.

   Demo data is an agency decision. It lives in the agency console
   (DemoModeToggle), which tracks every seeded row so it can be withdrawn
   again without touching what the studio built. */

function greeting(hour: number) {
  if (hour < 5 || hour >= 17) return "Good evening";
  if (hour < 12) return "Good morning";
  return "Good afternoon";
}

export default function DashboardPage() {
  const { user } = useOptionalUser();
  const today = useQuery(api.today.today, {});
  const [booking, setBooking] = useState(false);
  const now = new Date();
  const first = user?.firstName?.trim();
  const count = today?.counts.sessionsToday;
  const date = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <DashboardPeriodProvider>
    <div className="space-y-6">
      <OnboardingNudge />
      <GetPaidBanner />
      {/* In the shell this lands in the top bar chassis (kit overview). */}
      <PageHeader
        overline="Studio"
        title={first ? `${greeting(now.getHours())}, ${first}` : greeting(now.getHours())}
        description={count === undefined ? date : `${date} · ${count} ${count === 1 ? "session" : "sessions"} today`}
        actions={
          <>
            <PeriodKeys />
            <Button onClick={() => setBooking(true)}>New booking</Button>
          </>
        }
      />

      {/* Every dashboard tile lives in the customizable grid - drag to
          reorder, remove, or add widgets from the tray (persists per user). */}
      <CustomizableDashboard />
      <BookSessionDialog open={booking} onOpenChange={setBooking} />
    </div>
    </DashboardPeriodProvider>
  );
}
