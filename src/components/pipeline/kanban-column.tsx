"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { meta, PIPELINE_STAGE } from "@/lib/labels";
import { DealCard } from "./deal-card";
import type { KanbanStage, Opportunity } from "./constants";

/** One pipeline stage — a droppable column holding sortable deal cards. */
export function KanbanColumn({
  stage,
  deals,
  onOpenDeal,
}: {
  stage: KanbanStage;
  deals: Opportunity[];
  onOpenDeal: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage, data: { stage } });
  const info = meta(PIPELINE_STAGE, stage);
  const total = deals.reduce((sum, d) => sum + d.valueCents, 0);

  return (
    <div className="flex w-72 min-w-72 shrink-0 flex-col">
      {/* Column header */}
      <div className="mb-2.5 flex items-center justify-between gap-2 px-0.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 rounded-full",
              info.tone === "gold" && "bg-gold",
              info.tone === "positive" && "bg-positive",
              info.tone === "info" && "bg-info",
              info.tone === "neutral" && "bg-ash-dim",
              info.tone === "caution" && "bg-caution",
              info.tone === "critical" && "bg-critical",
              info.tone === "solid" && "bg-bone",
            )}
          />
          <h3 className="font-display text-sm font-semibold text-bone">{info.label}</h3>
          <span className="font-mono text-[0.6875rem] text-ash-dim">{deals.length}</span>
        </div>
        <span className="font-mono text-[0.6875rem] font-medium text-ash">
          {money(total, { compact: true })}
        </span>
      </div>

      {/* Droppable body */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-32 flex-1 flex-col gap-2 rounded-lg border p-2 transition-colors",
          isOver ? "border-gold-dim bg-gold/[0.04]" : "border-hairline bg-ink-2/60",
        )}
      >
        <SortableContext
          items={deals.map((d) => d._id)}
          strategy={verticalListSortingStrategy}
        >
          {deals.map((deal) => (
            <DealCard key={deal._id} opp={deal} onOpen={onOpenDeal} />
          ))}
        </SortableContext>

        {deals.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-hairline-2 py-8">
            <span className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
              Drop deals here
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
