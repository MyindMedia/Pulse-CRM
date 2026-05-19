"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { relativeTime } from "@/lib/format";
import { ACCENT_TONE, titleCase } from "@/lib/labels";
import { cn } from "@/lib/utils";

const DOT_COLOR: Record<string, string> = {
  gold: "var(--color-gold)",
  positive: "var(--color-positive)",
  critical: "var(--color-critical)",
  info: "var(--color-info)",
};

/** Chronological activity feed for a single artist. */
export function ActivityTimeline({ artistId }: { artistId: Id<"artists"> }) {
  const rows = useQuery(api.activity.forEntity, {
    entityType: "artist",
    entityId: artistId,
  });

  if (rows === undefined) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No activity yet"
        description="Sessions, invoices and notes for this artist will stream in here."
      />
    );
  }

  return (
    <ol className="relative space-y-1 pl-1">
      {rows.map((row, i) => {
        const tone = ACCENT_TONE[row.accent ?? "info"] ?? "info";
        const last = i === rows.length - 1;
        return (
          <li key={`${row._creationTime}-${i}`} className="relative flex gap-3 pb-4">
            {/* Connector line */}
            {!last && (
              <span
                aria-hidden
                className="absolute left-[0.3125rem] top-4 h-full w-px bg-hairline"
              />
            )}
            <span
              aria-hidden
              className={cn("relative mt-1 size-2.5 shrink-0 rounded-full ring-4 ring-coal")}
              style={{ backgroundColor: DOT_COLOR[tone] ?? DOT_COLOR.info }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-bone">{row.summary}</p>
              <p className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
                {titleCase(row.kind)} · {relativeTime(row._creationTime)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
