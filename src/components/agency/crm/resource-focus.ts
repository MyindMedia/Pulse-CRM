"use client";

import * as React from "react";

/* Focus goes back to the button that opened an action once its last dialog
   closes (eval U-18). A dialog chain (fields, then confirm, then the answer)
   otherwise leaves focus on <body>: each dialog hands focus back to whatever
   was focused when it opened, and that was the previous dialog, now gone. */

/** Put focus on `target` when it would otherwise be lost. Never steals focus
 *  the person has already moved somewhere real. */
export function refocus(target: HTMLElement | null | undefined): boolean {
  if (!target || !target.isConnected) return false;
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected && active !== target) {
    // Focus is somewhere real (not body). Only take it back from inside a dialog that is closing.
    if (!active.closest('[role="dialog"][data-state="closed"], [role="alertdialog"][data-state="closed"]')) return false;
  }
  target.focus();
  return true;
}

/** When `open` goes from true to false, return focus to `target` over the next
 *  frames (a closing dialog restores focus on its own schedule, after its exit
 *  animation). */
export function useReturnFocus(open: boolean, target: React.RefObject<HTMLElement | null>) {
  const was = React.useRef(open);
  React.useEffect(() => {
    const closed = was.current && !open;
    was.current = open;
    if (!closed || typeof window === "undefined") return;
    let frames = 0;
    let id = 0;
    const tick = () => {
      refocus(target.current);
      frames += 1;
      if (frames < 45) id = window.requestAnimationFrame(tick);
    };
    id = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(id);
  }, [open, target]);
}

/** For a Dialog this component owns, as its onCloseAutoFocus: send focus to
 *  `target` instead of the element that was focused when the dialog opened.
 *  Call it from the event handler, so the ref is only read then. */
export function focusOnClose(e: Event, target: React.RefObject<HTMLElement | null>) {
  const el = target.current;
  if (el && el.isConnected) {
    e.preventDefault();
    el.focus();
  }
}
