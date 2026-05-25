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
import { Handshake, Megaphone, Trophy } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { EmptyState } from "@/components/ui/feedback";
import { money } from "@/lib/format";
import { PitchSyncDialog } from "./pitch-sync-dialog";
import { SyncCard } from "./sync-card";
import { SyncColumn } from "./sync-column";
import { SyncSheet } from "./sync-sheet";
import { SYNC_STAGE_ORDER, type SyncOpportunity, type SyncStage } from "./types";

/** Drag-and-drop board for sync opportunities — drag cards between stages,
 *  click a card to drill into its details. */
export function SyncBoard() {
  const board = useQuery(api.licensing.syncBoard) as SyncOpportunity[] | undefined;
  const moveStage = useMutation(api.licensing.moveSyncStage);

  const [optimistic, setOptimistic] = useState<Record<string, SyncStage>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  /** Server data merged with optimistic drag overrides. */
  const opps: SyncOpportunity[] = useMemo(
    () => (board ?? []).map((o) => ({ ...o, stage: optimistic[o._id] ?? o.stage })),
    [board, optimistic],
  );

  const grouped = useMemo(() => {
    const map: Record<SyncStage, SyncOpportunity[]> = {
      pitched: [], heard: [], shortlisted: [], negotiating: [], placed: [], passed: [],
    };
    for (const o of opps) map[o.stage]?.push(o);
    for (const s of SYNC_STAGE_ORDER) map[s].sort((a, b) => b.updatedAt - a.updatedAt);
    return map;
  }, [opps]);

  const summary = useMemo(() => {
    const sum = (stages: SyncStage[]) =>
      opps.filter((o) => stages.includes(o.stage)).reduce((acc, o) => acc + (o.feeCents ?? 0), 0);
    return {
      pitchedValue: sum(["pitched", "heard", "shortlisted"]),
      negotiatingValue: sum(["negotiating"]),
      placedRevenue: sum(["placed"]),
    };
  }, [opps]);

  const activeOpp = activeId ? opps.find((o) => o._id === activeId) ?? null : null;
  const openOpp = openId ? opps.find((o) => o._id === openId) ?? null : null;

  async function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const id = String(active.id);
    const opp = opps.find((o) => o._id === id);
    if (!opp) return;
    const overData = over.data.current as { stage?: string } | undefined;
    const target = (overData?.stage ?? String(over.id)) as SyncStage;
    if (!SYNC_STAGE_ORDER.includes(target) || target === opp.stage) return;

    setOptimistic((p) => ({ ...p, [id]: target }));
    try {
      await moveStage({ id: id as Id<"syncOpportunities">, stage: target });
    } catch {
      setOptimistic((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
      toast.error("Could not move that placement — reverted.");
    }
  }

  if (board === undefined) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-24 w-full rounded-lg" />)}
        </div>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {SYNC_STAGE_ORDER.map((s) => <div key={s} className="skeleton h-64 w-full rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (board.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title="No syncs in flight"
        description="Pitch a song to a music supervisor and it lands on the board, ready to drag through to placed."
        action={<PitchSyncDialog />}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Pitched value" value={money(summary.pitchedValue, { compact: true })} icon={Megaphone} hint="pitched, heard & shortlisted" />
        <StatTile label="In negotiation" value={money(summary.negotiatingValue, { compact: true })} icon={Handshake} hint="deals being closed" />
        <StatTile label="Placed revenue" value={money(summary.placedRevenue, { compact: true })} icon={Trophy} accent hint="syncs landed" />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {SYNC_STAGE_ORDER.map((stage) => (
            <SyncColumn key={stage} stage={stage} cards={grouped[stage]} onOpen={setOpenId} />
          ))}
        </div>

        <DragOverlay>{activeOpp ? <SyncCard opp={activeOpp} overlay /> : null}</DragOverlay>
      </DndContext>

      <SyncSheet opp={openOpp} onClose={() => setOpenId(null)} />
    </div>
  );
}
