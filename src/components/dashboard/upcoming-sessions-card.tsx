"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ArrowRight, CalendarCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { meta, SESSION_STATUS } from "@/lib/labels";
import { timeOfDay } from "@/lib/format";

/**
 * Upcoming sessions in the dashboard-3 list interface: bordered header with
 * a description, hairline-divided rows, status badges. Same data + links the
 * dashboard always carried.
 */
export function UpcomingSessionsCard({ className }: { className?: string }) {
  const upcoming = useQuery(api.sessions.upcoming, { limit: 6 });

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between border-b border-hairline-2/50 pb-4">
        <div className="space-y-1">
          <CardTitle>Upcoming sessions</CardTitle>
          <CardDescription>Confirmed and tentative work on the books.</CardDescription>
        </div>
        <Link href="/calendar" className="inline-flex items-center gap-1 text-xs font-medium text-gold hover:underline">
          Calendar <ArrowRight className="size-3" />
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {upcoming === undefined ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title="Nothing on the books"
            description="Confirmed sessions will show up here."
            className="border-0 bg-transparent"
          />
        ) : (
          <ul className="divide-y divide-hairline-2/40">
            {upcoming.map((s) => {
              const st = meta(SESSION_STATUS, s.status);
              return (
                <li key={s._id}>
                  <Link
                    href="/calendar"
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-coal-2"
                  >
                    <div className="grid size-10 shrink-0 place-items-center rounded-md border border-graphite/50 bg-obsidian text-center">
                      <span className="font-grotesk text-sm font-bold leading-none text-bone">
                        {new Date(s.startTime).getDate()}
                      </span>
                      <span className="font-meta text-[0.5625rem] uppercase text-steel/70">
                        {new Date(s.startTime).toLocaleDateString("en-US", { month: "short" })}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-bone">{s.title}</p>
                      <p className="truncate text-xs text-steel/70">
                        {s.artistName} · {timeOfDay(s.startTime)}
                        {s.roomName ? ` · ${s.roomName}` : ""}
                      </p>
                    </div>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
