"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { SONG_STAGE } from "@/lib/labels";
import { cn } from "@/lib/utils";

const STAGE_ORDER = [
  "writing",
  "demo",
  "tracking",
  "editing",
  "mixing",
  "mastering",
  "delivered",
  "released",
] as const;

type Stage = (typeof STAGE_ORDER)[number];

/** Horizontal pipeline stepper — click any stage to move the song to it. */
export function StageStepper({
  songId,
  current,
}: {
  songId: Id<"songs">;
  current: string;
}) {
  const advance = useMutation(api.songs.advanceStage);
  const [pending, setPending] = useState<Stage | null>(null);

  const currentIndex = STAGE_ORDER.indexOf(current as Stage);

  async function move(stage: Stage) {
    if (stage === current || pending) return;
    setPending(stage);
    try {
      await advance({ id: songId, stage });
      toast.success(`Moved to ${SONG_STAGE[stage].label.toLowerCase()}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the stage.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="no-scrollbar overflow-x-auto">
      <ol className="flex min-w-max items-center gap-1">
        {STAGE_ORDER.map((stage, i) => {
          const isCurrent = i === currentIndex;
          const isDone = i < currentIndex;
          const isPending = pending === stage;
          return (
            <li key={stage} className="flex items-center">
              <button
                type="button"
                onClick={() => move(stage)}
                disabled={pending !== null}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "group flex items-center gap-2 rounded-md border px-3 py-2 transition-colors disabled:opacity-60",
                  isCurrent
                    ? "border-gold-dim bg-gold/10"
                    : isDone
                      ? "border-hairline-2 bg-coal-2 hover:border-gold-dim/60"
                      : "border-hairline bg-coal hover:border-hairline-2",
                )}
              >
                <span
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-full font-mono text-[0.625rem] font-bold",
                    isCurrent
                      ? "bg-gold text-gold-ink"
                      : isDone
                        ? "bg-positive/20 text-positive"
                        : "bg-coal-3 text-ash-dim",
                  )}
                >
                  {isDone ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                </span>
                <span
                  className={cn(
                    "whitespace-nowrap font-mono text-[0.6875rem] uppercase tracking-wide",
                    isCurrent
                      ? "font-semibold text-gold-bright"
                      : isDone
                        ? "text-ash"
                        : "text-ash-dim group-hover:text-ash",
                  )}
                >
                  {isPending ? "Saving…" : SONG_STAGE[stage].label}
                </span>
              </button>
              {i < STAGE_ORDER.length - 1 && (
                <span
                  className={cn(
                    "mx-0.5 h-px w-3 shrink-0",
                    i < currentIndex ? "bg-positive/40" : "bg-hairline",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
