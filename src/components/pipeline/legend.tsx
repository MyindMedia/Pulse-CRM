"use client";

import * as React from "react";
import { ChevronDown, Clock } from "lucide-react";
import {
  KANBAN_STAGES, STAGE_TINT, SERVICE_TINT, SERVICE_LABEL, STALE_AFTER_DAYS,
} from "./constants";
import { meta, PIPELINE_STAGE } from "@/lib/labels";
import { cn } from "@/lib/utils";

/* What the colours on this board mean.

   The board carries two colour systems at once, and without this a card is
   just a coloured stripe you have to guess at. Collapsed by default, because
   once you know it you never want to read it again, and the answer is one
   click away when somebody new joins the studio. */

export function PipelineLegend() {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="rounded-lg border border-graphite/50 bg-coal/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        <span className="flex items-center gap-1">
          {KANBAN_STAGES.slice(0, 6).map((s) => (
            <span
              key={s}
              className="size-2 rounded-full"
              style={{ background: STAGE_TINT[s] }}
              aria-hidden
            />
          ))}
        </span>
        <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
          What the colours mean
        </span>
        <ChevronDown
          className={cn(
            "ml-auto size-4 text-steel/60 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div className="grid gap-5 border-t border-graphite/50 px-4 py-4 sm:grid-cols-3">
          <div>
            <p className="font-meta text-[0.6rem] uppercase tracking-[0.1em] text-steel/60">
              Column colour · how far along
            </p>
            <p className="mt-1 text-[0.7rem] leading-relaxed text-steel/80">
              Cold grey to gold to green. The board warms up as a deal moves right.
            </p>
            <ul className="mt-2 space-y-1">
              {KANBAN_STAGES.filter((s) => s !== "won").map((s) => (
                <li key={s} className="flex items-center gap-2 text-xs text-steel">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: STAGE_TINT[s] }}
                    aria-hidden
                  />
                  {meta(PIPELINE_STAGE, s).label}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-meta text-[0.6rem] uppercase tracking-[0.1em] text-steel/60">
              Card stripe · what kind of work
            </p>
            <p className="mt-1 text-[0.7rem] leading-relaxed text-steel/80">
              The bar down the left of each card. It ranks nothing, it just tells you
              the service at a glance.
            </p>
            <ul className="mt-2 space-y-1">
              {Object.keys(SERVICE_TINT).map((k) => (
                <li key={k} className="flex items-center gap-2 text-xs text-steel">
                  <span
                    className="h-3.5 w-1 shrink-0 rounded-full"
                    style={{ background: SERVICE_TINT[k] }}
                    aria-hidden
                  />
                  {SERVICE_LABEL[k] ?? k}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-meta text-[0.6rem] uppercase tracking-[0.1em] text-steel/60">
              Timestamp · needs a nudge
            </p>
            <p className="mt-1 text-[0.7rem] leading-relaxed text-steel/80">
              The line at the bottom of a card is how long since anything happened on
              it.
            </p>
            <ul className="mt-2 space-y-1.5">
              <li className="flex items-center gap-2 text-xs">
                <Clock className="size-3 shrink-0 text-positive" aria-hidden />
                <span className="text-steel">
                  <span className="text-positive">Green</span> · moving
                </span>
              </li>
              <li className="flex items-center gap-2 text-xs">
                <Clock className="size-3 shrink-0 text-caution" aria-hidden />
                <span className="text-steel">
                  <span className="text-caution">Amber</span> · nothing for{" "}
                  {STALE_AFTER_DAYS} days, going stale
                </span>
              </li>
            </ul>
            <p className="mt-2.5 text-[0.7rem] leading-relaxed text-steel/60">
              Amber only ever means stale. No card stripe uses it, so the warning
              cannot be mistaken for a service.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
