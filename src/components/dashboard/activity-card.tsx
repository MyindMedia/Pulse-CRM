"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  Activity as ActivityIcon,
  CalendarPlus,
  CircleCheck,
  CircleDollarSign,
  CircleX,
  Clock3,
  Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { ACCENT_TONE, titleCase } from "@/lib/labels";

function iconFor(kind: string) {
  if (kind.startsWith("staff.")) return Clock3;
  if (kind.startsWith("booking") || kind.startsWith("session")) return CalendarPlus;
  if (kind === "invoice.paid" || kind === "payment.received") return CircleDollarSign;
  if (kind === "session.completed") return CircleCheck;
  if (kind.endsWith(".cancelled") || kind.endsWith(".forfeited")) return CircleX;
  return ActivityIcon;
}

const TONE_STYLE: Record<string, string> = {
  gold: "text-gold bg-gold/10",
  positive: "text-positive bg-positive/10",
  critical: "text-critical bg-critical/10",
  info: "text-info bg-info/10",
};

/**
 * The studio event stream in the dashboard-3 activity interface: icon
 * bubbles toned by the event's accent, hairline-divided rows, kind + age
 * metadata. Same feed the dashboard always carried.
 */
export function ActivityCard({ className }: { className?: string }) {
  const activity = useQuery(api.activity.recent, { limit: 12 });

  return (
    <Card className={cn("gap-0", className)}>
      <CardContent className="p-0">
        {activity === undefined ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : activity.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No activity yet"
            description="Studio events will stream in here."
            className="border-0 bg-transparent"
          />
        ) : (
          <ul className="max-h-[22rem] divide-y divide-hairline-2/40 overflow-y-auto">
            {activity.map((a) => {
              const Icon = iconFor(a.kind);
              const tone = TONE_STYLE[ACCENT_TONE[a.accent ?? "info"]] ?? TONE_STYLE.info;
              return (
                <li key={a._id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", tone)}>
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-bone">{a.summary}</p>
                    <p className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                      {titleCase(a.kind)} · {relativeTime(a._creationTime)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
