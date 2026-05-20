"use client";

import { Check, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InvoiceStatus } from "./types";

/** The happy-path lifecycle, in order. */
const STEPS: { key: InvoiceStatus; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "viewed", label: "Viewed" },
  { key: "paid", label: "Paid" },
];

/** How far down the lifecycle a given status sits. Overdue == sent stage. */
function reachedIndex(status: InvoiceStatus): number {
  switch (status) {
    case "draft":
      return 0;
    case "sent":
    case "overdue":
      return 1;
    case "viewed":
      return 2;
    case "paid":
      return 3;
    case "void":
      return -1;
  }
}

/** Vertical lifecycle tracker - reached steps glow, the rest stay dim. */
export function StatusTimeline({ status }: { status: InvoiceStatus }) {
  if (status === "void") {
    return (
      <div className="flex items-center gap-2.5 rounded-md border border-hairline bg-coal-2 px-3 py-2.5">
        <span className="grid size-6 place-items-center rounded-full bg-coal-3 text-ash-dim">
          <Ban className="size-3.5" />
        </span>
        <span className="text-sm font-medium text-ash">This invoice has been voided</span>
      </div>
    );
  }

  const reached = reachedIndex(status);

  return (
    <ol className="space-y-0">
      {STEPS.map((step, i) => {
        const done = i <= reached;
        const current = i === reached;
        const last = i === STEPS.length - 1;
        return (
          <li key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border text-[0.625rem] font-bold transition-colors",
                  done
                    ? "border-gold bg-gold text-gold-ink"
                    : "border-hairline-2 bg-coal-2 text-ash-dim",
                  current && "ring-2 ring-gold/30",
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              {!last && (
                <span
                  className={cn(
                    "my-0.5 w-px flex-1",
                    i < reached ? "bg-gold/50" : "bg-hairline",
                  )}
                />
              )}
            </div>
            <div className={cn("pb-4", last && "pb-0")}>
              <p
                className={cn(
                  "text-sm font-medium leading-6",
                  done ? "text-bone" : "text-ash-dim",
                )}
              >
                {step.label}
              </p>
              {current && (
                <p className="text-[0.6875rem] text-gold">Current stage</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
