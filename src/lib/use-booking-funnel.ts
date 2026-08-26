"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

/* Anonymous booking-funnel tracking.

   The key lives in sessionStorage, not a cookie and not localStorage: it dies
   with the tab, is never sent to a third party, and identifies nobody. It
   exists so the studio can be told how many people looked at its booking page
   versus how many booked, which is the one number the page could never report.

   Every failure path is a no-op. A blocked storage API, a private window, or a
   dropped request must never break a booking - measurement is not worth a
   lost session. */

const KEY = "pulse:visit";

export function visitorKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let k = window.sessionStorage.getItem(KEY);
    if (!k) {
      k =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID().replace(/-/g, "")
          : Math.random().toString(36).slice(2) + Date.now().toString(36);
      window.sessionStorage.setItem(KEY, k);
    }
    return k;
  } catch {
    // Private mode, or storage disabled. Track nothing rather than break.
    return null;
  }
}

type Step = "page" | "room" | "checkout";

/** Fire one funnel step once per mount. Safe to call on every render path. */
export function useTrackBookingStep(
  slug: string | undefined,
  step: Step,
  opts: { roomId?: Id<"rooms">; enabled?: boolean } = {},
) {
  const track = useMutation(api.bookingFunnel.track);
  const { roomId, enabled = true } = opts;
  const fired = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!enabled || !slug) return;
    const once = `${step}:${roomId ?? ""}`;
    if (fired.current === once) return;
    fired.current = once;

    const key = visitorKey();
    if (!key) return;

    const params = new URLSearchParams(window.location.search);
    void track({
      slug,
      visitorKey: key,
      step,
      roomId,
      ref: params.get("ref") ?? undefined,
      code: params.get("code") ?? undefined,
      utmSource: params.get("utm_source") ?? undefined,
      src: params.get("src") ?? undefined,
    }).catch(() => {
      // Measurement is best-effort. Never surface this to the visitor.
    });
  }, [slug, step, roomId, enabled, track]);
}
