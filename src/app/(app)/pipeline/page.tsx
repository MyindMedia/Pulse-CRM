"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ChevronDown,
  ChevronRight,
  KanbanSquare,
  Layers,
  Percent,
  Plus,
  Trophy,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { CountUp } from "@/components/shell/app-motion";
import { StatTile } from "@/components/ui/stat-tile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { money, percent } from "@/lib/format";
import { meta, PIPELINE_STAGE } from "@/lib/labels";
import { KanbanColumn } from "@/components/pipeline/kanban-column";
import { PipelineLegend } from "@/components/pipeline/legend";
import { DealCard } from "@/components/pipeline/deal-card";
import { DealSheet } from "@/components/pipeline/deal-sheet";
import { AddOpportunityDialog } from "@/components/pipeline/add-opportunity-dialog";
import {
  KANBAN_STAGES,
  type KanbanStage,
  type Opportunity,
} from "@/components/pipeline/constants";

export default function PipelinePage() {
  const board = useQuery(api.opportunities.board);
  const metrics = useQuery(api.opportunities.metrics);
  const moveStage = useMutation(api.opportunities.moveStage);

  /** Local overrides keyed by opp id - drives optimistic kanban moves. */
  const [optimisticStage, setOptimisticStage] = useState<Record<string, KanbanStage>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  /** Merge server data with optimistic stage overrides. */
  const opps: Opportunity[] = useMemo(() => {
    if (!board) return [];
    return board.map((o) => ({
      ...o,
      stage: optimisticStage[o._id] ?? o.stage,
    }));
  }, [board, optimisticStage]);

  const columns = useMemo(() => {
    const map: Record<KanbanStage, Opportunity[]> = {
      inquiry: [],
      qualified: [],
      proposal: [],
      booked: [],
      in_progress: [],
      delivered: [],
      won: [],
    };
    for (const o of opps) {
      if (o.stage !== "lost" && map[o.stage as KanbanStage]) {
        map[o.stage as KanbanStage].push(o);
      }
    }
    return map;
  }, [opps]);

  const lostDeals = useMemo(() => opps.filter((o) => o.stage === "lost"), [opps]);
  const activeOpp = activeId ? opps.find((o) => o._id === activeId) ?? null : null;

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const oppId = String(active.id);
    const opp = opps.find((o) => o._id === oppId);
    if (!opp) return;

    // The droppable is either a column id or another card; resolve to a stage.
    const overData = over.data.current as { stage?: string } | undefined;
    const targetStage = (overData?.stage ?? String(over.id)) as KanbanStage;
    if (!KANBAN_STAGES.includes(targetStage)) return;
    if (targetStage === opp.stage) return;

    setOptimisticStage((prev) => ({ ...prev, [oppId]: targetStage }));
    try {
      await moveStage({ id: oppId as Id<"opportunities">, stage: targetStage });
    } catch {
      // Reactive query will correct the card; drop the override.
      setOptimisticStage((prev) => {
        const next = { ...prev };
        delete next[oppId];
        return next;
      });
      toast.error("Could not move the deal - reverted");
    }
  }

  const empty = board && board.length === 0;

  return (
    <div className="space-y-7">
      <PageHeader
        overline="Sales"
        title="Pipeline"
        description="Every deal in flight - drag a card to advance it through the studio's sales stages."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Add opportunity
          </Button>
        }
      />

      {/* Summary bar */}
      {!metrics ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <div className="rise-stagger grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Open deals" value={<CountUp to={metrics.openCount} />} icon={Layers} />
          <StatTile
            label="Pipeline value"
            value={<CountUp to={metrics.totalValue} format={(n) => money(n, { compact: true })} />}
            icon={Wallet}
            accent
          />
          <StatTile
            label="Weighted value"
            value={<CountUp to={metrics.weightedValue} format={(n) => money(n, { compact: true })} />}
            icon={Percent}
            hint="probability-adjusted"
          />
          <StatTile
            label="Win rate"
            value={<CountUp to={metrics.winRate} format={(n) => percent(n)} />}
            icon={Trophy}
          />
        </div>
      )}

      {/* Two colour systems run on this board. Say what they mean. */}
      <PipelineLegend />

      {/* Board */}
      {board === undefined ? (
        <div className="flex gap-4 overflow-hidden">
          {KANBAN_STAGES.map((s) => (
            <div key={s} className="w-72 min-w-72 shrink-0 space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-72 w-full" />
            </div>
          ))}
        </div>
      ) : empty ? (
        <EmptyState
          icon={KanbanSquare}
          title="No opportunities yet"
          description="Add your first deal to start tracking it through the studio pipeline."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              Add opportunity
            </Button>
          }
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div className="-mx-4 overflow-x-auto px-4 pb-2 lg:-mx-8 lg:px-8">
            <div className="rise-stagger flex min-w-0 gap-4">
              {KANBAN_STAGES.map((stage) => (
                <KanbanColumn
                  key={stage}
                  stage={stage}
                  deals={columns[stage]}
                  onOpenDeal={setOpenDealId}
                />
              ))}
            </div>
          </div>

          <DragOverlay>
            {activeOpp ? <DealCard opp={activeOpp} overlay /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Lost deals - collapsed archive strip */}
      {lostDeals.length > 0 && (
        <div className="rounded-lg border border-graphite/50 bg-coal">
          <button
            type="button"
            onClick={() => setLostOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-gold/30"
          >
            {lostOpen ? (
              <ChevronDown className="size-4 text-steel/70" />
            ) : (
              <ChevronRight className="size-4 text-steel/70" />
            )}
            <span className="font-grotesk text-sm font-semibold text-bone">Lost deals</span>
            <Badge tone={meta(PIPELINE_STAGE, "lost").tone}>{lostDeals.length}</Badge>
          </button>
          {lostOpen && (
            <div className="grid gap-2 border-t border-graphite/50 p-3 sm:grid-cols-2 lg:grid-cols-3">
              {lostDeals.map((d) => (
                <DealCard key={d._id} opp={d} onOpen={setOpenDealId} />
              ))}
            </div>
          )}
        </div>
      )}

      <AddOpportunityDialog open={addOpen} onOpenChange={setAddOpen} />
      <DealSheet oppId={openDealId} onClose={() => setOpenDealId(null)} />
    </div>
  );
}
