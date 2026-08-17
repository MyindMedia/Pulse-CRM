"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A titled section the reader can fold away.
 *
 * Deliberately separate from `Section` in page.tsx: that module is imported
 * by server components, and giving it state would drag every one of them
 * into the client bundle to serve a disclosure triangle.
 *
 * Worth reaching for when a block is useful occasionally and long always -
 * a stock locker, an archive, a reference table. Those should not push the
 * thing you actually came for off the bottom of the screen.
 */
export function CollapsibleSection({
  title,
  trailing,
  children,
  className,
  defaultOpen = true,
  /** Shown beside the title while folded, so collapsing loses no facts. */
  summary,
}: {
  title: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  defaultOpen?: boolean;
  summary?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="group flex min-w-0 items-center gap-1.5 text-left"
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-steel transition-transform",
              open && "rotate-90",
            )}
          />
          <h2 className="overline transition-colors group-hover:text-bone">{title}</h2>
          {!open && summary && (
            <span className="truncate font-meta text-[10px] uppercase tracking-wide text-steel/70">
              {summary}
            </span>
          )}
        </button>
        {/* A control acting on hidden content is a trap, so it hides with it. */}
        {open && trailing}
      </div>
      {open && children}
    </section>
  );
}
