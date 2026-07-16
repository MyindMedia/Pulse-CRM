"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Check, CircleParking, Coffee, DoorOpen, Eye, UserCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { timeOfDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ParkingSignDialog } from "@/components/parking/parking-sign-dialog";
import { DeviceAlertsChip } from "./device-alerts-chip";

/* The front-desk prep board: the next client arrivals with a live checklist -
   review the session, print the parking sign (same one-button print as the
   visitors QR sign), room reset, welcome set. Checklist state lives in
   Convex (arrivalPrep) so every staffer sees the same prep live. */

const ARRIVAL_STATUSES = new Set(["tentative", "confirmed"]);
const WINDOW_MS = 24 * 3_600_000;

type Step = "details" | "parking" | "room" | "welcome";

function countdown(startTime: number, now: number): { label: string; soon: boolean } {
  const mins = Math.round((startTime - now) / 60_000);
  if (mins <= 0) return { label: "arriving now", soon: true };
  if (mins < 60) return { label: `in ${mins} min`, soon: mins <= 60 };
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return { label: `in ${h}h${m ? ` ${m}m` : ""}`, soon: false };
}

export function ArrivalPrepCard({ className }: { className?: string }) {
  const upcoming = useQuery(api.sessions.upcoming, { limit: 12 });
  const setStep = useMutation(api.arrivalPrep.setStep);
  const [parkingFor, setParkingFor] = React.useState<{ sessionId: Id<"sessions">; name: string } | null>(null);

  // A stable "now" per mount keeps the list from reshuffling mid-view.
  const [now] = React.useState(() => Date.now());

  const arrivals = React.useMemo(
    () =>
      (upcoming ?? [])
        .filter((s) => ARRIVAL_STATUSES.has(s.status) && s.startTime - now < WINDOW_MS)
        .slice(0, 4),
    [upcoming, now],
  );

  const prep = useQuery(
    api.arrivalPrep.forSessions,
    upcoming === undefined ? "skip" : { sessionIds: arrivals.map((s) => s._id) },
  );

  function doneSteps(sessionId: string): Set<string> {
    return new Set(prep?.[sessionId] ?? []);
  }

  async function mark(sessionId: Id<"sessions">, step: Step, done: boolean) {
    try {
      await setStep({ sessionId, step, done });
    } catch {
      // Reactive state simply stays put; nothing to unwind.
    }
  }



  const next = arrivals[0];
  const nextCountdown = next ? countdown(next.startTime, now) : null;

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between gap-2 border-b border-hairline-2/50 py-3">
        <CardDescription>Prep the studio before the client walks in.</CardDescription>
        <DeviceAlertsChip />
        {next && nextCountdown && (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-medium",
              nextCountdown.soon
                ? "border-gold/40 bg-gold/10 text-gold"
                : "border-graphite/50 text-steel",
            )}
          >
            {nextCountdown.soon && (
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-gold" />
              </span>
            )}
            {next.artistName} {nextCountdown.label}
          </span>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {upcoming === undefined ? (
          <div className="space-y-2 p-4">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : arrivals.length === 0 ? (
          <EmptyState
            icon={UserCheck}
            title="No arrivals coming up"
            description="When a session is on the books for the next 24 hours, its prep checklist appears here."
            className="border-0 bg-transparent"
          />
        ) : (
          <ul className="divide-y divide-hairline-2/40">
            {arrivals.map((s) => {
              const done = doneSteps(s._id);
              const ready = done.size >= 4;
              const cd = countdown(s.startTime, now);
              return (
                <li key={s._id} className="space-y-2 px-4 py-3">
                  {/* The whole header row opens the pre-session brief. */}
                  <Link
                    href={`/brief/${s._id}`}
                    className="flex items-center justify-between gap-3 rounded-md outline-none transition-colors hover:bg-coal-2 focus-visible:ring-2 focus-visible:ring-gold/30"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-bone">{s.artistName}</p>
                      <p className="truncate text-xs text-steel/70">
                        {timeOfDay(s.startTime)} · {cd.label}
                        {s.roomName ? ` · ${s.roomName}` : ""}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 font-meta text-[0.625rem]",
                        ready
                          ? "border-positive/40 bg-positive/10 text-positive"
                          : "border-graphite/50 text-steel/70",
                      )}
                    >
                      {ready ? "Ready" : `${done.size}/4 ready`}
                    </span>
                  </Link>
                  <div className="flex flex-wrap gap-1.5">
                    <PrepChip
                      done={done.has("details")}
                      icon={Eye}
                      label="Open brief"
                      asChild
                    >
                      <Link
                        href={`/brief/${s._id}`}
                        onClick={() => void mark(s._id, "details", true)}
                      />
                    </PrepChip>
                    <PrepChip
                      done={done.has("parking")}
                      icon={CircleParking}
                      label="Parking sign"
                      onClick={() => setParkingFor({ sessionId: s._id, name: s.artistName })}
                    />
                    <PrepChip
                      done={done.has("room")}
                      icon={DoorOpen}
                      label="Room ready"
                      onClick={() => void mark(s._id, "room", !done.has("room"))}
                    />
                    <PrepChip
                      done={done.has("welcome")}
                      icon={Coffee}
                      label="Welcome set"
                      onClick={() => void mark(s._id, "welcome", !done.has("welcome"))}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <ParkingSignDialog
        open={parkingFor !== null}
        onOpenChange={(o) => {
          if (!o) setParkingFor(null);
        }}
        initialName={parkingFor?.name ?? ""}
        onPrinted={() => {
          if (parkingFor) void mark(parkingFor.sessionId, "parking", true);
        }}
      />
    </Card>
  );
}

/** One checklist chip. Action chips (details/parking) run their action and
 *  stay checked; state chips toggle. Shared with the wrap-up board. */
export function PrepChip({
  done,
  icon: Icon,
  label,
  onClick,
  asChild,
  children,
}: {
  done: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  asChild?: boolean;
  children?: React.ReactElement<Record<string, unknown>>;
}) {
  const className = cn(
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6875rem] font-medium transition-colors",
    done
      ? "border-gold/45 bg-gold/10 text-gold"
      : "border-graphite/50 text-steel hover:border-graphite/70 hover:text-bone",
  );
  const content = (
    <>
      {done ? <Check className="size-3" strokeWidth={3} /> : <Icon className="size-3" />}
      {label}
    </>
  );
  if (asChild && children) {
    return React.cloneElement(children, { className, children: content });
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}
