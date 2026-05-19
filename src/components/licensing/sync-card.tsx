"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { ArrowRight, Building2, CheckCircle2, UserCog, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { meta, SYNC_STAGE } from "@/lib/labels";
import { money, relativeTime } from "@/lib/format";
import { nextSyncStage, type SyncOpportunity, type SyncStage } from "./types";

/** A single sync opportunity card with inline stage-advance controls. */
export function SyncCard({ opp }: { opp: SyncOpportunity }) {
  const moveStage = useMutation(api.licensing.moveSyncStage);
  const [pending, setPending] = useState(false);

  const stage = meta(SYNC_STAGE, opp.stage);
  const next = nextSyncStage(opp.stage);
  const terminal = opp.stage === "placed" || opp.stage === "passed";

  async function move(to: SyncStage) {
    if (pending) return;
    setPending(true);
    try {
      await moveStage({ id: opp._id, stage: to });
      toast.success(`Moved to ${meta(SYNC_STAGE, to).label}.`);
    } catch {
      toast.error("Could not move that placement.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-md border border-hairline bg-coal-2 p-3 transition-colors hover:border-hairline-2">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-display text-sm font-semibold text-bone">
          {opp.songTitle}
        </p>
        {opp.feeCents !== undefined && (
          <span className="shrink-0 font-mono text-xs font-medium text-gold">
            {money(opp.feeCents, { compact: true })}
          </span>
        )}
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

      {!terminal && (
        <div className="mt-2.5 flex items-center gap-1.5 border-t border-hairline pt-2.5">
          {next && (
            <Button
              size="sm"
              variant="secondary"
              className="flex-1"
              disabled={pending}
              onClick={() => move(next)}
            >
              {meta(SYNC_STAGE, next).label}
              <ArrowRight className="size-3.5" />
            </Button>
          )}
          <Tooltip label="Mark passed">
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={pending}
              onClick={() => move("passed")}
              aria-label="Mark passed"
            >
              <XCircle className="size-4" />
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
