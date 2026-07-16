"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  CircleDollarSign,
  DoorOpen,
  FileText,
  HardDrive,
  Package,
  PackageCheck,
  Sparkles,
  SlidersHorizontal,
  LayoutPanelTop,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { timeOfDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PrepChip } from "./arrival-prep-card";
import { DeviceAlertsChip } from "./device-alerts-chip";

/* Session wrap-up + studio refresh: sessions ending (or just ended) carry a
   wrap checklist - files, billing, gear, notes - and, when another booking
   follows in the same room, the turnover checklist to reset and stage the
   space. Same live shared state (arrivalPrep) as the arrival board. */

type WrapStep = string;

function endLabel(endTime: number, now: number): string {
  const mins = Math.round((endTime - now) / 60_000);
  if (mins > 1) return `ends in ${mins} min`;
  if (mins >= -1) return "ending now";
  return `ended ${Math.abs(mins)} min ago`;
}

export function WrapUpCard({ className }: { className?: string }) {
  const wrapping = useQuery(api.arrivalPrep.wrapping);
  const setStep = useMutation(api.arrivalPrep.setStep);
  const [now] = React.useState(() => Date.now());

  const prep = useQuery(
    api.arrivalPrep.forSessions,
    wrapping === undefined ? "skip" : { sessionIds: wrapping.map((s) => s._id) },
  );

  async function mark(sessionId: Id<"sessions">, step: WrapStep, done: boolean) {
    try {
      await setStep({ sessionId, step, done });
    } catch {
      /* reactive state stays put */
    }
  }

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between border-b border-hairline-2/50 py-3">
        <CardDescription>Close out the session, reset the room.</CardDescription>
        <DeviceAlertsChip />
      </CardHeader>
      <CardContent className="p-0">
        {wrapping === undefined ? (
          <div className="space-y-2 p-4">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : wrapping.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Nothing wrapping up"
            description="Sessions ending within 45 minutes show their wrap-up and studio-refresh checklists here."
            className="border-0 bg-transparent"
          />
        ) : (
          <ul className="divide-y divide-hairline-2/40">
            {wrapping.map((s) => {
              const done = new Set(prep?.[s._id] ?? []);
              const wrapDone = ["files", "billing", "gear", "notes"].filter((k) => done.has(k)).length;
              const refreshDone = ["reset", "refresh", "zero", "stage"].filter((k) => done.has(k)).length;
              const itemsDone = s.rentedItems.filter((i) => done.has(i.key)).length;
              const totalSteps = 8 + s.rentedItems.length;
              const totalDone = wrapDone + refreshDone + itemsDone;
              return (
                <li key={s._id} className="space-y-2 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-bone">{s.artistName}</p>
                      <p className="truncate text-xs text-steel/70">
                        {endLabel(s.endTime, now)} · until {timeOfDay(s.endTime)}
                        {s.roomName ? ` · ${s.roomName}` : ""}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 font-meta text-[0.625rem]",
                        totalDone >= totalSteps
                          ? "border-positive/40 bg-positive/10 text-positive"
                          : "border-graphite/50 text-steel/70",
                      )}
                    >
                      {totalDone >= totalSteps ? "Done" : `${totalDone}/${totalSteps} done`}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <PrepChip done={done.has("files")} icon={HardDrive} label="Files saved" onClick={() => void mark(s._id, "files", !done.has("files"))} />
                    <PrepChip done={done.has("billing")} icon={CircleDollarSign} label="Balance settled" onClick={() => void mark(s._id, "billing", !done.has("billing"))} />
                    <PrepChip done={done.has("gear")} icon={Package} label="Gear checked in" onClick={() => void mark(s._id, "gear", !done.has("gear"))} />
                    <PrepChip done={done.has("notes")} icon={FileText} label="Notes logged" onClick={() => void mark(s._id, "notes", !done.has("notes"))} />
                  </div>
                  {s.rentedItems.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/60">
                        Rented gear back to storage
                      </span>
                      {s.rentedItems.map((item) => (
                        <PrepChip
                          key={item.key}
                          done={done.has(item.key)}
                          icon={PackageCheck}
                          label={`Return ${item.name}`}
                          onClick={() => void mark(s._id, item.key, !done.has(item.key))}
                        />
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/60">
                      {s.next ? `Refresh for ${s.next.artistName} at ${timeOfDay(s.next.startTime)}` : "Studio refresh"}
                    </span>
                    <PrepChip done={done.has("reset")} icon={DoorOpen} label="Room reset" onClick={() => void mark(s._id, "reset", !done.has("reset"))} />
                    <PrepChip done={done.has("refresh")} icon={Sparkles} label="Refreshed" onClick={() => void mark(s._id, "refresh", !done.has("refresh"))} />
                    <PrepChip done={done.has("zero")} icon={SlidersHorizontal} label="Console zeroed" onClick={() => void mark(s._id, "zero", !done.has("zero"))} />
                    <PrepChip done={done.has("stage")} icon={LayoutPanelTop} label="Staged for next" onClick={() => void mark(s._id, "stage", !done.has("stage"))} />
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
