"use client";

import { INVOICE_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { InvoiceStatus } from "./types";

/** "All" plus every invoice status, in pipeline order. */
const ORDER: InvoiceStatus[] = ["draft", "sent", "viewed", "overdue", "paid", "void"];

export type StatusFilterValue = InvoiceStatus | "all";

/** Segmented control for filtering the invoice table by status. */
export function StatusFilter({
  value,
  onChange,
  counts,
}: {
  value: StatusFilterValue;
  onChange: (next: StatusFilterValue) => void;
  counts?: Partial<Record<StatusFilterValue, number>>;
}) {
  const options: { key: StatusFilterValue; label: string }[] = [
    { key: "all", label: "All" },
    ...ORDER.map((k) => ({ key: k as StatusFilterValue, label: INVOICE_STATUS[k].label })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-graphite/50 bg-obsidian p-1">
      {options.map((opt) => {
        const active = opt.key === value;
        const count = counts?.[opt.key];
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-gold text-gold-ink"
                : "text-steel hover:bg-coal-2 hover:text-bone",
            )}
          >
            {opt.label}
            {count !== undefined && (
              <span
                className={cn(
                  "font-meta text-[0.625rem]",
                  active ? "text-gold-ink/70" : "text-steel/70",
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
