"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id, Doc } from "@convex/_generated/dataModel";
import { ClipboardList, ListChecks, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Checklist = Doc<"sessionChecklists"> | null;

function progress(cl: Checklist): { done: number; total: number } {
  if (!cl) return { done: 0, total: 0 };
  return {
    done: cl.items.filter((i) => i.done).length,
    total: cl.items.length,
  };
}

function Section({
  cl,
  title,
  icon: Icon,
  emptyHint,
}: {
  cl: Checklist;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  emptyHint: string;
}) {
  const toggle = useMutation(api.checklists.toggleItem);
  const { done, total } = progress(cl);
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const complete = total > 0 && done === total;

  async function onToggle(index: number) {
    if (!cl) return;
    try {
      await toggle({ id: cl._id, index });
    } catch {
      toast.error("Could not update the item.");
    }
  }

  if (!cl) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-ash">
            <Icon className="size-3.5 text-gold-dim" />
            {title}
          </p>
        </div>
        <p className="rounded-md border border-dashed border-hairline-2 py-4 text-center text-[0.6875rem] text-ash-dim">
          {emptyHint}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-ash">
          <Icon className="size-3.5 text-gold-dim" />
          {title}
        </p>
        <span
          className={cn(
            "font-mono text-[0.625rem] uppercase tracking-wide",
            complete ? "text-positive" : "text-ash-dim",
          )}
        >
          {done}/{total} {complete && "✓"}
        </span>
      </div>
      {/* Progress bar */}
      <div className="h-1 w-full overflow-hidden rounded-full bg-coal-2">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            complete ? "bg-positive" : "bg-gold",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <ul className="space-y-1 rounded-md border border-hairline bg-coal-2 p-2">
        {cl.items.map((item, idx) => (
          <li key={idx}>
            <button
              type="button"
              onClick={() => onToggle(idx)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors",
                "hover:bg-coal-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold/40",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid size-4 shrink-0 place-items-center rounded-sm border transition-colors",
                  item.done
                    ? "border-positive bg-positive/15 text-positive"
                    : "border-hairline-2 bg-ink-2",
                )}
              >
                {item.done && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span
                className={cn(
                  "flex-1 text-xs leading-relaxed",
                  item.done ? "text-ash-dim line-through" : "text-bone",
                )}
              >
                {item.label}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChecklistsPanel({ sessionId }: { sessionId: Id<"sessions"> }) {
  const checklists = useQuery(api.checklists.forSession, { sessionId });

  if (checklists === undefined) {
    return <div className="skeleton h-32 rounded-md" />;
  }

  return (
    <div className="space-y-4">
      <Section
        cl={checklists.pre}
        title="Pre-session checklist"
        icon={ClipboardList}
        emptyHint="No pre-session checklist (cancelled or completed already)."
      />
      <Section
        cl={checklists.post}
        title="Post-session checklist"
        icon={ListChecks}
        emptyHint="No post-session checklist set up for this session."
      />
    </div>
  );
}
