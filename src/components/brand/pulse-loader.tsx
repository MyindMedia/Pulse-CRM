"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Full-screen Pulse loader. Used by app-shell route-transition
 * `loading.tsx` files. The logo lives at the center under a slow
 * gold pulse-ring; underneath, three dots cycle to indicate work.
 *
 * Designed to feel calm + on-brand, not "spinner anxious". The
 * underlying pulse-ring / logo-breathe / dot-bounce keyframes are
 * defined in src/app/globals.css. */
export function PulseLoader({
  message,
  fullscreen = true,
  className,
}: {
  message?: string;
  fullscreen?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative grid place-items-center bg-ink",
        fullscreen ? "min-h-dvh w-full" : "py-16",
        className,
      )}
    >
      {/* Soft gold radial behind the logo */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 45%, rgba(253,185,19,0.10), transparent 70%)",
        }}
      />
      <div className="relative flex flex-col items-center gap-6">
        {/* Concentric pulse rings behind the logo. The second ring is
            offset by half a cycle for layered emanation. */}
        <div className="relative grid size-32 place-items-center">
          <span
            aria-hidden
            className="pulse-ring absolute inset-0 rounded-full"
            style={{ boxShadow: "0 0 0 0 rgba(253,185,19,0.45)" }}
          />
          <span
            aria-hidden
            className="pulse-ring-2 absolute inset-0 rounded-full"
            style={{ boxShadow: "0 0 0 0 rgba(253,185,19,0.25)" }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/pulse-logo.png"
            alt="Pulse"
            className="logo-breathe relative z-10 size-24 w-auto select-none"
            style={{ filter: "drop-shadow(0 6px 20px rgba(253,185,19,0.25))" }}
            draggable={false}
          />
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <span className="overline text-ash">
            {message ?? "Tuning the room"}
          </span>
          <span className="flex items-center gap-1">
            <span className="dot-bounce" />
            <span className="dot-bounce" style={{ animationDelay: "120ms" }} />
            <span className="dot-bounce" style={{ animationDelay: "240ms" }} />
          </span>
        </div>
      </div>
    </div>
  );
}
