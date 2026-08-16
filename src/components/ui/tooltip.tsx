"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

export const TooltipProvider = TooltipPrimitive.Provider;

/** Render "cmd+shift+z" as ⌘⇧Z. Falls back to the raw text on anything odd. */
export function prettyKeys(shortcut: string): string {
  const map: Record<string, string> = {
    cmd: "⌘",
    meta: "⌘",
    ctrl: "⌃",
    control: "⌃",
    shift: "⇧",
    alt: "⌥",
    option: "⌥",
    enter: "↵",
    esc: "Esc",
    escape: "Esc",
    backspace: "⌫",
    delete: "⌦",
    space: "Space",
    up: "↑",
    down: "↓",
    left: "←",
    right: "→",
    plus: "+",
    minus: "−",
    drag: "drag",
    click: "click",
  };
  const parts = shortcut.split("+").map((raw) => {
    const key = raw.trim().toLowerCase();
    return map[key] ?? (key.length === 1 ? key.toUpperCase() : raw.trim());
  });

  // Modifier glyphs sit flush against the key they modify, the way a Mac
  // menu prints them. Word-shaped parts need a space or they run together
  // into things like "Spacedrag".
  return parts.reduce((out, part, i) => {
    if (i === 0) return part;
    const needsGap = part.length > 1 || parts[i - 1].length > 1;
    return out + (needsGap ? " " : "") + part;
  }, "");
}

/**
 * Self-contained tooltip - wraps trigger + content in one component.
 *
 * `hint` is a second line for the "why", and `shortcut` renders the key
 * combination as a chip. Any control whose meaning is carried only by an
 * icon should have one of these, because an icon nobody can name is a
 * control nobody uses.
 */
export function Tooltip({
  children,
  label,
  hint,
  shortcut,
  side = "top",
  className,
}: {
  children: React.ReactNode;
  label: React.ReactNode;
  hint?: React.ReactNode;
  /** e.g. "cmd+z", "shift+f". Rendered as a chip beside the label. */
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            "anim-rise z-50 max-w-64 rounded-md border border-graphite/60 bg-coal-3 px-2.5 py-1.5 " +
              "text-xs font-medium text-bone shadow-pop",
            className,
          )}
        >
          <span className="flex items-center gap-2">
            <span className="min-w-0">{label}</span>
            {shortcut && (
              <kbd className="shrink-0 rounded-[4px] border border-graphite/70 bg-coal px-1 py-px font-meta text-[10px] font-semibold text-steel">
                {prettyKeys(shortcut)}
              </kbd>
            )}
          </span>
          {hint && (
            <span className="mt-0.5 block text-[11px] font-normal leading-snug text-steel">
              {hint}
            </span>
          )}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
