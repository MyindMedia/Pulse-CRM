"use client";

import Link from "next/link";
import { CalendarClock, CheckSquare, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { STAGE_LABEL } from "./constants";

export type ProjectCardData = {
  _id: string;
  name: string;
  stage: string;
  dueDate: number | null;
  overdue: boolean;
  ownerName: string | null;
  openTaskCount: number;
  taskCount: number;
  overdueTaskCount: number;
  linkCount: number;
  nextTask: { title: string; dueDate: number | null } | null;
};

/** A job-board style card: name, stage, due date, owner, open work. */
export function ProjectCard({
  project: p,
  showStage = false,
  className,
}: {
  project: ProjectCardData;
  showStage?: boolean;
  className?: string;
}) {
  const late = p.overdue || p.overdueTaskCount > 0;
  return (
    <Link
      href={`/projects/${p._id}`}
      className={cn(
        "block space-y-2 rounded-lg border bg-coal/60 p-3 outline-none transition-colors",
        "hover:border-gold-dim focus-visible:ring-2 focus-visible:ring-gold/30",
        late ? "border-critical/40" : "border-graphite/60",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-grotesk text-sm font-semibold leading-snug text-bone">{p.name}</p>
        {showStage && <Badge tone="gold">{STAGE_LABEL[p.stage] ?? p.stage}</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-steel">
        {p.dueDate !== null && (
          <span className={cn("inline-flex items-center gap-1", p.overdue && "text-critical")}>
            <CalendarClock className="size-3.5" />
            {p.overdue ? "Overdue " : "Due "}
            {shortDate(p.dueDate)}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <CheckSquare className="size-3.5" />
          {p.openTaskCount} open
          {p.overdueTaskCount > 0 && <span className="text-critical">, {p.overdueTaskCount} late</span>}
        </span>
        {p.linkCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <Link2 className="size-3.5" />
            {p.linkCount}
          </span>
        )}
      </div>
      {p.nextTask && <p className="truncate text-xs text-steel/80">Next: {p.nextTask.title}</p>}
      {p.ownerName && <p className="text-xs text-steel/70">{p.ownerName}</p>}
    </Link>
  );
}
