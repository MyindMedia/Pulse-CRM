"use client";

import { useState } from "react";
import { Check, User } from "lucide-react";
import { Checkbox } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import { offsetLabel, type CampaignTask } from "./types";

/**
 * The 12-step rollout timeline for a campaign. Each task is a row with an
 * offset marker, a checkbox bound to toggleTask, and the task label.
 */
export function RolloutTimeline({
  tasks,
  onToggle,
}: {
  tasks: CampaignTask[];
  onToggle: (index: number) => Promise<void>;
}) {
  const [pending, setPending] = useState<number | null>(null);

  async function handle(index: number) {
    if (pending !== null) return;
    setPending(index);
    try {
      await onToggle(index);
    } finally {
      setPending(null);
    }
  }

  return (
    <ol className="relative space-y-0">
      {/* spine */}
      <span
        aria-hidden
        className="absolute bottom-4 left-[1.0625rem] top-4 w-px bg-hairline"
      />
      {tasks.map((task, index) => {
        const checkboxId = `rollout-task-${index}`;
        return (
          <li
            key={index}
            className="relative flex items-start gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-coal-2"
          >
            <span
              className={cn(
                "relative z-10 mt-0.5 grid size-[1.375rem] shrink-0 place-items-center rounded-full border text-[0.5rem]",
                task.done
                  ? "border-gold bg-gold text-gold-ink"
                  : "border-graphite/60 bg-obsidian text-steel/70",
              )}
            >
              {task.done ? (
                <Check className="size-3" strokeWidth={3} />
              ) : (
                <span className="size-1.5 rounded-full bg-current" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded-sm border border-graphite/60 bg-obsidian px-1.5 py-0.5 font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                  {offsetLabel(task.offsetDays)}
                </span>
                {task.owner && (
                  <span className="inline-flex items-center gap-1 font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                    <User className="size-3" />
                    {task.owner}
                  </span>
                )}
              </div>
              <label
                htmlFor={checkboxId}
                className={cn(
                  "mt-1 block cursor-pointer text-sm leading-snug",
                  task.done ? "text-steel/70 line-through" : "text-bone",
                )}
              >
                {task.label}
              </label>
            </div>

            <Checkbox
              id={checkboxId}
              checked={task.done}
              disabled={pending === index}
              onCheckedChange={() => handle(index)}
              className="mt-0.5"
            />
          </li>
        );
      })}
    </ol>
  );
}
