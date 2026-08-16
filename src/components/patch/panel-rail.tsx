"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * What a folded side panel leaves behind.
 *
 * A panel that collapses to nothing is a panel the user cannot find again,
 * so the column keeps a 36px stub carrying the name it had and the arrow
 * that brings it back. It costs almost no canvas and removes the "where did
 * my inventory go" question entirely.
 */
export function PanelRail({
  side,
  label,
  shortcut,
  onExpand,
}: {
  side: "left" | "right";
  label: string;
  shortcut?: string;
  onExpand: () => void;
}) {
  const Chevron = side === "left" ? ChevronRight : ChevronLeft;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col items-center gap-3 bg-coal-2/40 py-2",
        side === "left" ? "border-r" : "border-l",
        "border-hairline",
      )}
    >
      <Tooltip
        label={`Show ${label.toLowerCase()}`}
        shortcut={shortcut}
        side={side === "left" ? "right" : "left"}
      >
        <button
          type="button"
          onClick={onExpand}
          aria-label={`Show ${label.toLowerCase()}`}
          aria-expanded={false}
          className="grid size-7 shrink-0 place-items-center rounded-chrome border border-transparent text-steel/70 transition-colors hover:border-hairline-2 hover:bg-coal/60 hover:text-bone"
        >
          <Chevron className="size-4" />
        </button>
      </Tooltip>

      {/* Reads bottom-to-top, the way a spine does. */}
      <span
        aria-hidden
        className="select-none font-meta text-[10px] uppercase tracking-[0.18em] text-steel/60 [writing-mode:vertical-rl] rotate-180"
      >
        {label}
      </span>
    </div>
  );
}

/** The button that folds an expanded panel away. Lives in the panel header. */
export function PanelCollapseButton({
  side,
  label,
  shortcut,
  onCollapse,
  className,
}: {
  side: "left" | "right";
  label: string;
  shortcut?: string;
  onCollapse: () => void;
  className?: string;
}) {
  const Chevron = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <Tooltip label={`Hide ${label.toLowerCase()}`} shortcut={shortcut}>
      <button
        type="button"
        onClick={onCollapse}
        aria-label={`Hide ${label.toLowerCase()}`}
        aria-expanded
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-chrome border border-transparent text-steel/60",
          "transition-colors hover:border-hairline-2 hover:bg-coal/60 hover:text-bone",
          className,
        )}
      >
        <Chevron className="size-3.5" />
      </button>
    </Tooltip>
  );
}
