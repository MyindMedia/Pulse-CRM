import * as React from "react";
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Headline metric tile - value, label, optional delta vs prior period. */
export function StatTile({
  label,
  value,
  icon: Icon,
  delta,
  hint,
  accent,
  className,
}: {
  label: string;
  value: string;
  icon?: LucideIcon;
  delta?: number;
  hint?: string;
  accent?: boolean;
  className?: string;
}) {
  const showDelta = delta !== undefined && Number.isFinite(delta) && delta !== 0;
  const up = (delta ?? 0) > 0;
  return (
    <div
      className={cn(
        "sheen group rounded-xl p-4 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-elev-3",
        accent ? "material-thin border-gold-dim/50 bg-gold/[0.05]" : "material-thin",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <p className="overline">{label}</p>
        {Icon && (
          <span
            className={cn(
              "grid size-7 place-items-center rounded-md",
              accent ? "bg-gold/15 text-gold" : "bg-coal-2 text-ash-dim",
            )}
          >
            <Icon className="size-3.5" />
          </span>
        )}
      </div>
      <p className="mt-2 font-display text-2xl font-bold tracking-tight text-bone">{value}</p>
      <div className="mt-1 flex items-center gap-1.5">
        {showDelta && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-mono text-[0.6875rem] font-medium",
              up ? "text-positive" : "text-critical",
            )}
          >
            {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {Math.abs(Math.round((delta ?? 0) * 100))}%
          </span>
        )}
        {hint && <span className="text-[0.6875rem] text-ash-dim">{hint}</span>}
      </div>
    </div>
  );
}
