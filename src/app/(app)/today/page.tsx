"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { CalendarCheck, Radio, UserCheck, Users } from "lucide-react";
import { PageHeader, Section } from "@/components/ui/page";
import { StatTile } from "@/components/ui/stat-tile";
import { CountUp } from "@/components/shell/app-motion";
import { Skeleton, SkeletonCards } from "@/components/ui/skeleton";
import { SessionSheet } from "@/components/calendar/session-sheet";
import { NowStrip } from "@/components/today/now-strip";
import { TodayTimeline } from "@/components/today/today-timeline";
import {
  ArrivalsPanel,
  BalancesPanel,
  StaffPanel,
  TomorrowPanel,
} from "@/components/today/side-panels";
import { longDate } from "@/lib/format";

/**
 * Today - the operator command center. The one screen a studio keeps open all
 * day: what's live in each room right now, the day's sessions in order, who's
 * arriving next, what money is owed today, who's on shift, and a peek at
 * tomorrow. Everything is computed server-side against the current moment.
 */
export default function TodayPage() {
  const data = useQuery(api.today.today, {});
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);

  // Server pins "now"; a mount-stable fallback avoids an impure render call
  // during the brief loading window.
  const [fallbackNow] = useState(() => Date.now());
  const now = data?.now ?? fallbackNow;

  return (
    <div className="space-y-7">
      <PageHeader
        overline="Studio"
        title="Today"
        description={`What's happening right now - ${longDate(now)}.`}
      />

      {/* At-a-glance counters */}
      {!data ? (
        <SkeletonCards cards={4} />
      ) : (
        <div className="rise-stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Sessions today"
            value={<CountUp to={data.counts.sessionsToday} />}
            icon={CalendarCheck}
            hint={data.counts.remaining ? `${data.counts.remaining} still to come` : "all wrapped"}
          />
          <StatTile
            label="Live now"
            value={<CountUp to={data.counts.live} />}
            icon={Radio}
            accent={data.counts.live > 0}
          />
          <StatTile
            label="Arrivals left"
            value={<CountUp to={data.counts.arrivals} />}
            icon={UserCheck}
          />
          <StatTile
            label="On shift"
            value={<CountUp to={data.counts.staffOnShift} />}
            icon={Users}
          />
        </div>
      )}

      {/* Now strip - rooms + busy-until */}
      {!data ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <Section title="Right now">
          <NowStrip rooms={data.rooms} now={now} />
        </Section>
      )}

      {/* Timeline + side rail */}
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Section title="Today's sessions">
          {!data ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <TodayTimeline
              sessions={data.sessions}
              now={now}
              onOpen={setOpenSessionId}
            />
          )}
        </Section>

        <div className="space-y-4">
          {!data ? (
            <Skeleton className="h-96 w-full" />
          ) : (
            <>
              <ArrivalsPanel
                arrivals={data.arrivals}
                onOpen={setOpenSessionId}
              />
              <BalancesPanel balances={data.balances} onOpen={setOpenSessionId} />
              <StaffPanel staff={data.staffOnShift} />
              <TomorrowPanel tomorrow={data.tomorrow} />
            </>
          )}
        </div>
      </div>

      <SessionSheet sessionId={openSessionId} onClose={() => setOpenSessionId(null)} />
    </div>
  );
}
