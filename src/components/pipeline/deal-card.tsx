"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Clock, GripVertical } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { money, percent } from "@/lib/format";
import { titleCase } from "@/lib/labels";
import { daysSince, serviceTint, type Opportunity } from "./constants";

/** A single draggable opportunity card. */
export function DealCard({
  opp,
  onOpen,
  overlay,
}: {
  opp: Opportunity;
  onOpen?: (id: string) => void;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: opp._id,
    data: { stage: opp.stage },
    disabled: overlay,
  });

  const tint = serviceTint(opp.serviceType);
  const age = daysSince(opp.updatedAt);
  const stale = age >= 14;

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={{
        transform: overlay ? undefined : CSS.Translate.toString(transform),
        transition: overlay ? undefined : transition,
      }}
      className={cn(
        "group relative overflow-hidden rounded-md border border-hairline bg-coal-2",
        "transition-colors",
        isDragging && !overlay && "opacity-40",
        overlay && "rotate-1 border-hairline-2 shadow-pop",
      )}
    >
      {/* Service-type color rail */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: tint }}
      />

      <button
        type="button"
        onClick={() => onOpen?.(opp._id)}
        className="block w-full cursor-pointer pl-3.5 pr-2 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-gold/30"
      >
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 truncate font-display text-sm font-semibold text-bone">
            {opp.title}
          </p>
          <span
            className="mt-0.5 shrink-0 cursor-grab text-ash-dim opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            aria-label="Drag deal"
          >
            <GripVertical className="size-4" />
          </span>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <Avatar name={opp.artistName} size="xs" />
          <span className="min-w-0 flex-1 truncate text-xs text-ash">{opp.artistName}</span>
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span className="font-mono text-sm font-semibold tracking-tight text-gold-bright">
            {money(opp.valueCents, { compact: true })}
          </span>
          <span className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
            {percent(opp.probability)} · {titleCase(opp.serviceType)}
          </span>
        </div>

        <div
          className={cn(
            "mt-1.5 flex items-center gap-1 text-[0.625rem]",
            stale ? "text-caution" : "text-ash-dim",
          )}
        >
          <Clock className="size-3" />
          <span>
            {age === 0 ? "Updated today" : `${age}d since update`}
            {stale ? " - going stale" : ""}
          </span>
        </div>
      </button>
    </div>
  );
}
