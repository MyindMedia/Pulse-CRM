"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { prettyKeys } from "@/components/ui/tooltip";

/* ============================================================
   Right-click menu for the patch canvas.

   Hand-rolled rather than pulled from a primitive library for
   one reason: every item here acts at the point you clicked -
   "add a note HERE", "place a device HERE" - so the menu has to
   carry the flow coordinate of the click, not just fire a
   callback. A generic menu would make that a side channel.
   ============================================================ */

export type MenuItem =
  | { kind: "item"; label: string; hint?: string; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect: () => void }
  | { kind: "separator" }
  | { kind: "label"; label: string };

export type MenuState = {
  /** Where to draw the menu, in client coordinates. */
  x: number;
  y: number;
  items: MenuItem[];
} | null;

const MENU_WIDTH = 216;

export function CanvasContextMenu({
  state,
  onClose,
}: {
  state: MenuState;
  onClose: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!state) return;
    function onDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    // Capture, so closing wins over anything the canvas does with the click.
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onClose);
    };
  }, [state, onClose]);

  if (!mounted || !state) return null;

  // Keep the whole menu on screen: a menu opened near the right edge or the
  // bottom of the window has to flip rather than run off it.
  const estimatedHeight = state.items.reduce(
    (total, item) => total + (item.kind === "separator" ? 7 : item.kind === "label" ? 22 : 30),
    10,
  );
  const left = Math.min(state.x, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(state.y, Math.max(8, window.innerHeight - estimatedHeight - 8));

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="anim-rise fixed z-[60] rounded-chrome border border-hairline-2 bg-coal-2/95 p-1 shadow-elev-3 backdrop-blur-sm"
      style={{ left, top, width: MENU_WIDTH }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {state.items.map((item, index) => {
        if (item.kind === "separator") {
          return <div key={index} className="my-1 h-px bg-hairline" />;
        }
        if (item.kind === "label") {
          return (
            <p key={index} className="px-2 py-1 font-meta text-[9px] uppercase tracking-wide text-steel/70">
              {item.label}
            </p>
          );
        }
        return (
          <button
            key={index}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            // The hint has nowhere to go on a menu row without doubling its
            // height, and a thirteen-item list of zone kinds twice as tall is
            // worse than a hint you have to hover for.
            title={item.hint}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-40",
              item.danger
                ? "text-critical hover:bg-critical/10"
                : "text-bone hover:bg-coal/70",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.shortcut && (
              <kbd className="shrink-0 rounded border border-hairline bg-coal px-1 font-meta text-[9px] text-steel">
                {prettyKeys(item.shortcut)}
              </kbd>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
