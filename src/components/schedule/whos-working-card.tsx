"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { CalendarClock, DoorOpen, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";

function fmt(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "");
}

/** Dashboard widget: who's on shift now + who's up next today. */
export function WhosWorkingCard() {
  const working = useQuery(api.shifts.whosWorking, {});

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-sm">
          <CalendarClock className="size-4 text-gold" />
          On shift
        </CardTitle>
        <Link href="/schedule" className="inline-flex items-center gap-1 text-xs text-steel hover:text-bone">
          Schedule <ArrowRight className="size-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3 pt-1">
        {working === undefined ? (
          <p className="text-sm text-steel/70">Checking…</p>
        ) : (
          <>
            <div>
              <p className="mb-1.5 font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">Now</p>
              {working.now.length === 0 ? (
                <p className="text-sm text-steel/70">No one clocked in.</p>
              ) : (
                <ul className="space-y-1.5">
                  {working.now.map((s) => (
                    <li key={s._id} className="flex items-center gap-2 text-sm text-bone">
                      <span className="size-1.5 shrink-0 rounded-full bg-positive" />
                      <Avatar name={s.memberName} src={s.memberPhotoUrl} size="xs" className="rounded-full" />
                      <span className="truncate">{s.memberName}</span>
                      {s.roomName && (
                        <span className="inline-flex items-center gap-0.5 truncate text-xs text-steel/70">
                          <DoorOpen className="size-3" />{s.roomName}
                        </span>
                      )}
                      <span className="ml-auto shrink-0 font-meta text-[0.6875rem] text-steel/70">→ {fmt(s.endTime)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {working.upcoming.length > 0 && (
              <div className="border-t border-graphite/50 pt-2.5">
                <p className="mb-1.5 font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">Next today</p>
                <ul className="space-y-1">
                  {working.upcoming.slice(0, 4).map((s) => (
                    <li key={s._id} className="flex items-center gap-2 text-xs text-steel">
                      <span className="font-meta text-steel/70">{fmt(s.startTime)}</span>
                      <Avatar name={s.memberName} src={s.memberPhotoUrl} size="xs" className="rounded-full" />
                      <span className="truncate">{s.memberName}</span>
                      {s.roomName && <span className="truncate text-steel/70">· {s.roomName}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
