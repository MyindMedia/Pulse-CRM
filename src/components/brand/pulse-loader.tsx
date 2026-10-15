import * as React from "react";
import { cn } from "@/lib/utils";
import { loaderCss, centrelinePaths } from "./pulse-loader-css";
import {
  LOGO_BOUNDS as B,
  LOGO_GOLD,
  OUTLINE_LOOPS,
  REVEAL_WIDTH,
} from "./pulse-logo-data";

/* The Pulse loading animation: the traced Pulse logo on a loop, the same
 * mark as the iOS launch screen (pulse-native LaunchScreen.swift). The line
 * draws itself in along the logo's centreline, beats lub-dub with a soft gold
 * glow, wipes out, and draws again, so a long load keeps reading as alive.
 *
 * Always Pulse gold (#FDCE01, the logo's own gold, not the brand-following
 * token), whatever the studio is themed as. Pure SVG + CSS, no JS timers.
 * Reduced motion: the finished logo with a gentle opacity breathe.
 *
 * `variant="page"` fills the viewport with the wordmark. `variant="compact"`
 * is a bare mark for panels. */

const PATHS = centrelinePaths();
const ASPECT = B.width / B.height;

export function PulseLogoMark({
  size = 196,
  className,
}: {
  /** Width of the mark in CSS px; height follows the logo's own proportions. */
  size?: number;
  className?: string;
}) {
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const maskId = `plm${uid}`;
  return (
    <>
      <style href="pulse-loader" precedence="default">
        {loaderCss()}
      </style>
      <div
        aria-hidden
        className={cn("pl-mark", className)}
        style={
          {
            width: size,
            height: size / ASPECT,
            ["--pl-k" as string]: size / 196,
          } as React.CSSProperties
        }
      >
        <svg
          viewBox={`${B.x} ${B.y} ${B.width} ${B.height}`}
          width="100%"
          height="100%"
          style={{ display: "block", overflow: "visible" }}
          focusable="false"
        >
          <defs>
            <mask
              id={maskId}
              maskUnits="userSpaceOnUse"
              x={B.x - 40}
              y={B.y - 40}
              width={B.width + 80}
              height={B.height + 80}
            >
              <g
                fill="none"
                stroke="#fff"
                strokeWidth={REVEAL_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {PATHS.map((p, i) => (
                  <path
                    key={i}
                    className={`pl-t${i}`}
                    d={p.d}
                    pathLength={1}
                    strokeDasharray="1 2"
                    strokeDashoffset={0}
                  />
                ))}
              </g>
            </mask>
          </defs>
          <path
            d={OUTLINE_LOOPS.join("")}
            fill={LOGO_GOLD}
            fillRule="nonzero"
            mask={`url(#${maskId})`}
          />
        </svg>
      </div>
    </>
  );
}

export function PulseLoader({
  message,
  variant = "page",
  size,
  className,
}: {
  /** Accessible name. Shown under the mark in compact, not on the page variant
   * (which always reads PULSE / STUDIO OS, like the iOS launch screen). */
  message?: string;
  variant?: "page" | "compact";
  size?: number;
  className?: string;
}) {
  const compact = variant === "compact";
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={message ?? "Loading"}
      className={cn(
        "relative grid w-full place-items-center",
        compact ? "py-10" : "min-h-dvh bg-ink",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-[18px]">
        <PulseLogoMark size={size ?? (compact ? 72 : 196)} />
        {compact ? (
          message ? (
            <p className="pl-word font-meta text-[11px] uppercase tracking-[0.2em] text-steel/70">
              {message}
            </p>
          ) : null
        ) : (
          <>
            <p className="pl-word font-grotesk text-[34px] font-semibold uppercase leading-none tracking-[2px] text-bone">
              Pulse
            </p>
            <p className="pl-word font-meta text-[11px] uppercase tracking-[3px] text-steel/90">
              Studio OS
            </p>
          </>
        )}
      </div>
    </div>
  );
}
