"use client";

import { History } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/format";
import { titleCase, ACCENT_TONE } from "@/lib/labels";
import type { ActivityRow } from "./types";

/** Resolve an activity accent to a CSS color token. */
function dotColor(accent?: ActivityRow["accent"]): string {
  const tone = ACCENT_TONE[accent ?? "info"] ?? "info";
  return `var(--color-${tone})`;
}

/** Chronological activity feed for a single invoice. */
export function InvoiceActivity({ rows }: { rows: ActivityRow[] | undefined }) {
  if (rows === undefined) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <span className="grid size-9 place-items-center rounded-md bg-coal-2 text-ash-dim">
          <History className="size-4" />
        </span>
        <p className="text-xs text-ash-dim">No activity logged yet.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-0">
      {rows.map((row, i) => (
        <li key={row._id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className="mt-1.5 size-1.5 shrink-0 rounded-full"
              style={{ background: dotColor(row.accent) }}
            />
            {i < rows.length - 1 && <span className="my-0.5 w-px flex-1 bg-hairline" />}
          </div>
          <div className="min-w-0 flex-1 pb-3">
            <p className="text-sm leading-snug text-bone">{row.summary}</p>
            <p className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
              {titleCase(row.kind)} · {relativeTime(row._creationTime)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
