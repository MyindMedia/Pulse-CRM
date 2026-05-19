"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Megaphone } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { EmptyState } from "@/components/ui/feedback";
import { meta, SYNC_STAGE } from "@/lib/labels";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PitchSyncDialog } from "./pitch-sync-dialog";
import { SyncCard } from "./sync-card";
import { Handshake, Trophy } from "lucide-react";
import { SYNC_STAGE_ORDER, type SyncOpportunity, type SyncStage } from "./types";

/** Grouped-column board for sync opportunities, one column per stage. */
export function SyncBoard() {
  const board = useQuery(api.licensing.syncBoard) as SyncOpportunity[] | undefined;

  const grouped = useMemo(() => {
    const map: Record<SyncStage, SyncOpportunity[]> = {
      pitched: [],
      heard: [],
      shortlisted: [],
      negotiating: [],
      placed: [],
      passed: [],
    };
    if (board) {
      for (const opp of board) map[opp.stage]?.push(opp);
      for (const stage of SYNC_STAGE_ORDER) {
        map[stage].sort((a, b) => b.updatedAt - a.updatedAt);
      }
    }
    return map;
  }, [board]);

  const summary = useMemo(() => {
    if (!board) return null;
    const sum = (stages: SyncStage[]) =>
      board
        .filter((o) => stages.includes(o.stage))
        .reduce((acc, o) => acc + (o.feeCents ?? 0), 0);
    return {
      pitchedValue: sum(["pitched", "heard", "shortlisted"]),
      negotiatingValue: sum(["negotiating"]),
      placedRevenue: sum(["placed"]),
    };
  }, [board]);

  if (board === undefined) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-24 w-full rounded-lg" />
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {SYNC_STAGE_ORDER.map((s) => (
            <div key={s} className="skeleton h-64 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (board.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title="No syncs in flight"
        description="Pitch a song to a music supervisor and it lands on the board, ready to advance through to placed."
        action={<PitchSyncDialog />}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      {summary && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile
            label="Pitched value"
            value={money(summary.pitchedValue, { compact: true })}
            icon={Megaphone}
            hint="pitched, heard & shortlisted"
          />
          <StatTile
            label="In negotiation"
            value={money(summary.negotiatingValue, { compact: true })}
            icon={Handshake}
            hint="deals being closed"
          />
          <StatTile
            label="Placed revenue"
            value={money(summary.placedRevenue, { compact: true })}
            icon={Trophy}
            accent
            hint="syncs landed"
          />
        </div>
      )}

      {/* Stage columns */}
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {SYNC_STAGE_ORDER.map((stage) => {
          const cards = grouped[stage];
          const m = meta(SYNC_STAGE, stage);
          return (
            <div
              key={stage}
              className="flex min-w-0 flex-col rounded-lg border border-hairline bg-coal/60"
            >
              <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2.5">
                <span className="inline-flex items-center gap-2">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      m.tone === "gold" && "bg-gold",
                      m.tone === "positive" && "bg-positive",
                      m.tone === "caution" && "bg-caution",
                      m.tone === "critical" && "bg-critical",
                      m.tone === "info" && "bg-info",
                      m.tone === "neutral" && "bg-ash-dim",
                      m.tone === "solid" && "bg-gold",
                    )}
                  />
                  <span className="overline">{m.label}</span>
                </span>
                <span className="font-mono text-[0.625rem] text-ash-dim">{cards.length}</span>
              </div>
              <div className="flex flex-col gap-2 p-2">
                {cards.length === 0 ? (
                  <p className="px-1 py-6 text-center font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
                    Empty
                  </p>
                ) : (
                  cards.map((opp) => <SyncCard key={opp._id} opp={opp} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
