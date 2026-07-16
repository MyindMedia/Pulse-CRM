"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  CalendarDays,
  CircleCheck,
  CircleDollarSign,
  CircleParking,
  Coffee,
  DoorOpen,
  Eye,
  FileText,
  HardDrive,
  LayoutPanelTop,
  Package,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { timeOfDay, shortDate } from "@/lib/format";
import { parkingSignHtml } from "@/lib/parking-sign";
import { openSignWindow } from "@/lib/sign-window";
import { PrepChip } from "@/components/dashboard/arrival-prep-card";
import { cn } from "@/lib/utils";

/* The Pre-session brief - the page the T-15 device alert opens. Everything
   staff need to prep from the BOOKING itself: who is coming, when, where,
   with the arrival checklist (incl. the one-button parking sign), the
   wrap-up list for the close, and the studio-refresh list for turnover.
   The studio can make checking every step REQUIRED (accountability mode);
   every check is attributed - who, when - on the trail below each section. */

const ARRIVAL: { key: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "details", label: "Details reviewed", icon: Eye },
  { key: "parking", label: "Parking sign", icon: CircleParking },
  { key: "room", label: "Room ready", icon: DoorOpen },
  { key: "welcome", label: "Welcome set", icon: Coffee },
];
const WRAP = [
  { key: "files", label: "Files saved", icon: HardDrive },
  { key: "billing", label: "Balance settled", icon: CircleDollarSign },
  { key: "gear", label: "Gear checked in", icon: Package },
  { key: "notes", label: "Notes logged", icon: FileText },
];
const REFRESH = [
  { key: "reset", label: "Room reset", icon: DoorOpen },
  { key: "refresh", label: "Refreshed", icon: Sparkles },
  { key: "zero", label: "Console zeroed", icon: SlidersHorizontal },
  { key: "stage", label: "Staged for next", icon: LayoutPanelTop },
];

function StepSection({
  title,
  subtitle,
  steps,
  done,
  attribution,
  onToggle,
  onAction,
  anchor,
}: {
  title: string;
  subtitle?: string;
  steps: typeof ARRIVAL;
  done: Set<string>;
  attribution: { step: string; by: string; at: number }[];
  onToggle: (step: string, next: boolean) => void;
  onAction?: Partial<Record<string, () => void>>;
  anchor?: string;
}) {
  const complete = steps.every((s) => done.has(s.key));
  return (
    <Card id={anchor}>
      <CardHeader className="flex-row items-center justify-between border-b border-hairline-2/50 py-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 font-meta text-[0.625rem]",
            complete
              ? "border-positive/40 bg-positive/10 text-positive"
              : "border-graphite/50 text-steel/70",
          )}
        >
          {steps.filter((s) => done.has(s.key)).length}/{steps.length}
        </span>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {subtitle && <p className="text-xs text-steel/70">{subtitle}</p>}
        <div className="flex flex-wrap gap-1.5">
          {steps.map(({ key, label, icon }) => (
            <PrepChip
              key={key}
              done={done.has(key)}
              icon={icon}
              label={label}
              onClick={() => {
                onAction?.[key]?.();
                onToggle(key, onAction?.[key] ? true : !done.has(key));
              }}
            />
          ))}
        </div>
        {attribution.filter((a) => steps.some((s) => s.key === a.step)).length > 0 && (
          <ul className="space-y-0.5">
            {attribution
              .filter((a) => steps.some((s) => s.key === a.step))
              .sort((a, b) => a.at - b.at)
              .map((a) => (
                <li key={a.step} className="font-meta text-[0.625rem] text-steel/60">
                  {steps.find((s) => s.key === a.step)?.label} - {a.by},{" "}
                  {timeOfDay(a.at)}
                </li>
              ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function BriefPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const id = sessionId as Id<"sessions">;
  const brief = useQuery(api.arrivalPrep.brief, { sessionId: id });
  const org = useQuery(api.orgs.current);
  const setStep = useMutation(api.arrivalPrep.setStep);
  const [now] = React.useState(() => Date.now());

  if (brief === undefined) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (brief === null) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Session not found"
        description="This booking does not exist or belongs to another studio."
        action={
          <Button asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        }
      />
    );
  }

  const done = new Set(brief.done);
  const allSteps = [...ARRIVAL, ...WRAP, ...REFRESH];
  const preComplete = ARRIVAL.every((s) => done.has(s.key));
  const allComplete = allSteps.every((s) => done.has(s.key));
  const beforeStart = now < brief.startTime;
  const mins = Math.round((brief.startTime - now) / 60_000);

  function toggle(step: string, next: boolean) {
    void setStep({ sessionId: id, step: step as never, done: next }).catch(() => {});
  }

  function printParking() {
    openSignWindow(parkingSignHtml(org ?? { name: "Pulse Studio" }, brief!.artistName));
  }

  const policySatisfied = beforeStart ? preComplete : allComplete;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="space-y-2">
        <p className="overline">Pre-session brief</p>
        <h1 className="font-grotesk text-3xl font-bold text-bone">{brief.artistName}</h1>
        <p className="text-sm text-steel">{brief.title}</p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Badge tone="gold">
            {shortDate(brief.startTime)} · {timeOfDay(brief.startTime)} - {timeOfDay(brief.endTime)}
          </Badge>
          {brief.roomName && <Badge tone="info">{brief.roomName}</Badge>}
          {brief.engineerName && <Badge tone="neutral">Engineer: {brief.engineerName}</Badge>}
          <Badge tone="neutral">{brief.serviceType}</Badge>
          {beforeStart && mins <= 60 && (
            <Badge tone={mins <= 15 ? "critical" : "caution"}>starts in {mins} min</Badge>
          )}
        </div>
        {brief.notes && (
          <p className="rounded-md border border-graphite/50 bg-coal-2 px-3 py-2 text-xs text-steel">
            {brief.notes}
          </p>
        )}
      </div>

      {/* Accountability banner */}
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm",
          policySatisfied
            ? "border-positive/40 bg-positive/10 text-positive"
            : brief.requireAll
              ? "border-gold/45 bg-gold/10 text-gold"
              : "border-graphite/50 bg-coal-2 text-steel",
        )}
      >
        {policySatisfied ? (
          <ShieldCheck className="size-4 shrink-0" />
        ) : brief.requireAll ? (
          <TriangleAlert className="size-4 shrink-0" />
        ) : (
          <CircleCheck className="size-4 shrink-0" />
        )}
        {policySatisfied
          ? beforeStart
            ? "Brief complete - the studio is ready for this session."
            : "All steps complete - session fully closed out."
          : brief.requireAll
            ? `This studio requires every step checked ${beforeStart ? "before the session starts" : "to close the session out"}.`
            : "Checklist is optional guidance - check steps as you go."}
      </div>

      <Button className="w-full sm:w-auto" onClick={printParking}>
        <CircleParking className="size-4" />
        Print parking sign for {brief.artistName}
      </Button>

      <StepSection
        title="Arrival prep"
        subtitle="Before the client walks in."
        steps={ARRIVAL}
        done={done}
        attribution={brief.attribution}
        onToggle={toggle}
        onAction={{ parking: printParking }}
      />
      <StepSection
        anchor="wrap"
        title="Session wrap-up"
        subtitle="Closing out the session."
        steps={WRAP}
        done={done}
        attribution={brief.attribution}
        onToggle={toggle}
      />
      <StepSection
        title="Studio refresh"
        subtitle={
          brief.next
            ? `Turnover: ${brief.next.artistName} takes the room at ${timeOfDay(brief.next.startTime)}.`
            : "Reset the space for whatever comes next."
        }
        steps={REFRESH}
        done={done}
        attribution={brief.attribution}
        onToggle={toggle}
      />

      <div className="flex items-center gap-3">
        <Button variant="outline" asChild>
          <Link href={`/calendar?session=${brief._id}`}>View on calendar</Link>
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
