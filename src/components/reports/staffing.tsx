"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";

const DAY = 86_400_000;
function startOfWeek(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** Scheduled hours per staff member this week (from the shifts table). */
export function StaffingReport() {
  const [from] = React.useState(() => startOfWeek(Date.now()));
  const rows = useQuery(api.shifts.staffingSummary, { from, to: from + 7 * DAY });
  const maxHours = Math.max(1, ...(rows ?? []).map((r) => r.hours));
  const totalHours = (rows ?? []).reduce((s, r) => s + r.hours, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-gold" />
          Staffing this week
        </CardTitle>
        <CardDescription>
          Scheduled hours per team member · {Math.round(totalHours)} total hrs
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows === undefined ? (
          <SkeletonRows rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No shifts scheduled this week"
            description="Build the roster on the Schedule page - hours will roll up here."
          />
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.memberId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-bone">
                    {r.name}
                    {r.role && <span className="ml-1.5 text-xs text-ash-dim">{r.role}</span>}
                  </span>
                  <span className="font-mono text-ash">
                    {r.hours}h
                    <span className="ml-2 text-ash-dim">
                      {r.shifts} shift{r.shifts === 1 ? "" : "s"}
                      {r.sessions > 0 && ` · ${r.sessions} session`}
                    </span>
                  </span>
                </div>
                <Progress value={r.hours} max={maxHours} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
