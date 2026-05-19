"use client";

import { cn } from "@/lib/utils";
import { ARTIST_STATUSES } from "@/components/roster/constants";

export type StatusFilterValue = "all" | (typeof ARTIST_STATUSES)[number]["value"];

const OPTIONS: { value: StatusFilterValue; label: string }[] = [
  { value: "all", label: "All" },
  ...ARTIST_STATUSES.map((s) => ({ value: s.value as StatusFilterValue, label: s.label })),
];

/** Segmented status filter for the roster list. */
export function StatusFilter({
  value,
  onChange,
  counts,
}: {
  value: StatusFilterValue;
  onChange: (next: StatusFilterValue) => void;
  counts?: Partial<Record<StatusFilterValue, number>>;
}) {
  return (
    <div
      role="tablist"
      aria-label="Filter roster by status"
      className="inline-flex items-center gap-1 rounded-md border border-hairline bg-ink-2 p-1"
    >
      {OPTIONS.map((opt) => {
        const selected = opt.value === value;
        const count = counts?.[opt.value];
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-medium",
              "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gold/30",
              selected ? "bg-coal-3 text-bone" : "text-ash hover:text-bone",
            )}
          >
            {opt.label}
            {count !== undefined && (
              <span
                className={cn(
                  "font-mono text-[0.625rem]",
                  selected ? "text-gold" : "text-ash-dim",
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
