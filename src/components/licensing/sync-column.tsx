"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { meta, SYNC_STAGE } from "@/lib/labels";
import { SyncCard } from "./sync-card";
import type { SyncOpportunity, SyncStage } from "./types";

const DOT: Record<string, string> = {
  gold: "bg-gold",
  positive: "bg-positive",
  caution: "bg-caution",
  critical: "bg-critical",
  info: "bg-info",
  neutral: "bg-ash-dim",
  solid: "bg-gold",
};

/** One sync stage - a droppable column of sortable sync cards. */
export function SyncColumn({
  stage,
  cards,
  onOpen,
}: {
  stage: SyncStage;
  cards: SyncOpportunity[];
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage, data: { stage } });
  const m = meta(SYNC_STAGE, stage);

  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
        <span className="inline-flex items-center gap-2">
          <span className={cn("size-1.5 rounded-full", DOT[m.tone] ?? "bg-ash-dim")} />
          <span className="overline">{m.label}</span>
        </span>
        <span className="font-mono text-[0.625rem] text-ash-dim">{cards.length}</span>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-40 flex-1 flex-col gap-2 rounded-lg border p-2 transition-colors",
          isOver ? "border-gold-dim bg-gold/[0.04]" : "border-hairline bg-coal/60",
        )}
      >
        <SortableContext items={cards.map((c) => c._id)} strategy={verticalListSortingStrategy}>
          {cards.map((opp) => (
            <SyncCard key={opp._id} opp={opp} onOpen={onOpen} />
          ))}
        </SortableContext>

        {cards.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-hairline-2 py-8">
            <span className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
              Drop here
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
