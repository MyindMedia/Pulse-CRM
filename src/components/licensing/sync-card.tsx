"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Building2, CheckCircle2, GripVertical, UserCog, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { meta, SYNC_STAGE } from "@/lib/labels";
import { money, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SyncOpportunity } from "./types";

/** A draggable sync card. Drag the grip to restage; click the body to drill in. */
export function SyncCard({
  opp,
  onOpen,
  overlay,
}: {
  opp: SyncOpportunity;
  onOpen?: (id: string) => void;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: opp._id,
    data: { stage: opp.stage },
    disabled: overlay,
  });

  const stage = meta(SYNC_STAGE, opp.stage);
  const terminal = opp.stage === "placed" || opp.stage === "passed";

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={{
        transform: overlay ? undefined : CSS.Translate.toString(transform),
        transition: overlay ? undefined : transition,
      }}
      className={cn(
        "group relative rounded-md border border-hairline bg-coal-2 transition-colors hover:border-hairline-2",
        isDragging && !overlay && "opacity-40",
        overlay && "rotate-1 border-hairline-2 shadow-pop",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen?.(opp._id)}
        className="block w-full cursor-pointer px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-gold/30"
      >
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 truncate font-display text-sm font-semibold text-bone">
            {opp.songTitle}
          </p>
          {opp.feeCents !== undefined && (
            <span className="shrink-0 font-mono text-xs font-medium text-gold">
              {money(opp.feeCents, { compact: true })}
            </span>
          )}
          <span
            className="mt-0.5 shrink-0 cursor-grab text-ash-dim opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            aria-label="Drag to restage"
          >
            <GripVertical className="size-4" />
          </span>
        </div>

        <div className="mt-1.5 space-y-0.5 text-xs text-ash">
          <p className="flex items-center gap-1.5">
            <UserCog className="size-3 text-ash-dim" />
            <span className="truncate">{opp.supervisorName}</span>
          </p>
          <p className="flex items-center gap-1.5">
            <Building2 className="size-3 text-ash-dim" />
            <span className="truncate">{opp.outlet}</span>
          </p>
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
            {relativeTime(opp.updatedAt)}
          </span>
          {terminal && (
            <Badge tone={stage.tone}>
              {opp.stage === "placed" ? (
                <CheckCircle2 className="size-3" />
              ) : (
                <XCircle className="size-3" />
              )}
              {stage.label}
            </Badge>
          )}
        </div>
      </button>
    </div>
  );
}
