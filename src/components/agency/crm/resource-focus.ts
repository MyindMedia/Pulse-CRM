"use client";

import * as React from "react";

/* Focus goes back to whatever opened a dialog or sheet once it closes (eval
   U-10, U-18). A dialog chain (fields, then confirm, then the answer)
   otherwise leaves focus on <body>: each dialog hands focus back to whatever
   was focused when it opened, and that was the previous dialog, now gone.
   When the opener itself is gone (a write re-rendered the row, or swapped
   "Switch on" for "Switch off"), focus goes to the nearest "home": the open
   sheet's title, else the panel heading (FocusHome below). */

type Target = HTMLElement | null | undefined;
type TargetRef = React.RefObject<HTMLElement | null>;

/** The element focus falls back to when an opener has gone. A panel provides
 *  its heading; a sheet provides its title. */
export const FocusHome = React.createContext<TargetRef | null>(null);

export function useFocusHome(): TargetRef | null {
  return React.useContext(FocusHome);
}

const usable = (el: Target): el is HTMLElement => !!el && el.isConnected;

/** Put focus on `target` (or `fallback` when the target is gone) when focus
 *  would otherwise be lost. Never steals focus the person has already moved
 *  somewhere real. */
export function refocus(target: Target, fallback?: Target): boolean {
  const el = usable(target) ? target : usable(fallback) ? fallback : null;
  if (!el) return false;
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected && active !== el) {
    // Focus is somewhere real (not body). Only take it back from inside a dialog that is closing.
    if (!active.closest('[role="dialog"][data-state="closed"], [role="alertdialog"][data-state="closed"]')) return false;
  }
  el.focus();
  return true;
}

/** When `open` goes from true to false, return focus to `target` (or the
 *  fallback) over the next frames (a closing dialog restores focus on its own
 *  schedule, after its exit animation). */
export function useReturnFocus(open: boolean, target: TargetRef, fallback?: TargetRef | null) {
  const was = React.useRef(open);
  React.useEffect(() => {
    const closed = was.current && !open;
    was.current = open;
    if (!closed || typeof window === "undefined") return;
    let frames = 0;
    let id = 0;
    const tick = () => {
      refocus(target.current, fallback?.current);
      frames += 1;
      if (frames < 45) id = window.requestAnimationFrame(tick);
    };
    id = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(id);
  }, [open, target, fallback]);
}

/** For a Dialog or Sheet this component owns, as its onCloseAutoFocus: send
 *  focus to `target` (or `fallback` when the target is gone) instead of the
 *  element that was focused when it opened. Call it from the event handler,
 *  so refs are only read then. */
export function focusOnClose(e: Event, target: TargetRef | (() => Target), fallback?: TargetRef | null) {
  const t = typeof target === "function" ? target() : target.current;
  const el = usable(t) ? t : usable(fallback?.current) ? fallback!.current : null;
  if (!el) return;
  e.preventDefault();
  el.focus();
}

/** The element to return to for a list row: its open button, found again by
 *  row id because a re-read may have replaced the DOM node. */
export function rowOpener(scope: HTMLElement | null | undefined, rowId: string | null): HTMLElement | null {
  if (!scope || rowId === null) return null;
  const all = scope.querySelectorAll<HTMLElement>("[data-row-open]");
  for (const el of all) if (el.dataset.rowOpen === rowId) return el;
  return null;
}
