"use client";

/* Focus that survives a dialog or sheet closing (R3-I4). Radix puts focus back
   on the element that was focused before it opened; when that element is gone
   (a Resume button that became Pause, a row removed by a cancel) focus lands on
   <body>. These helpers move it to a real target after Radix has finished. */

export type FocusTarget = string | HTMLElement | null | undefined | (() => HTMLElement | null | undefined);

function resolve(t: FocusTarget): HTMLElement | null {
  if (!t) return null;
  if (typeof t === "string") return typeof document === "undefined" ? null : document.getElementById(t);
  if (typeof t === "function") return t() ?? null;
  return t;
}

/** The first target that exists and is still in the page. */
export function firstFocusable(targets: FocusTarget[]): HTMLElement | null {
  for (const t of targets) {
    const el = resolve(t);
    if (el && el.isConnected && !(el as HTMLButtonElement).disabled) return el;
  }
  return null;
}

/** Focus the first target that exists, after the closing dialog has returned
 *  focus (Radix does that on a zero-delay timer). */
export function focusSoon(...targets: FocusTarget[]): void {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    const el = firstFocusable(targets);
    if (el) el.focus();
  }, 40);
}
