"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/* Cursor-follow chip - the dylanbrouwer "PLAY SHOWREEL" / "SHOW WORK" pattern.
 * Wrap any block in <CursorZone label="...">; while a fine pointer is inside,
 * a mono chip trails the cursor with a soft lerp. Touch devices and reduced
 * motion never see the chip, so the wrapper is purely additive. */
export function CursorZone({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const chip = React.useRef<HTMLDivElement>(null);
  const target = React.useRef({ x: 0, y: 0 });
  const pos = React.useRef({ x: 0, y: 0 });
  const raf = React.useRef(0);
  const [active, setActive] = React.useState(false);

  // Function declaration (hoisted) so the rAF loop can re-schedule itself.
  function loop() {
    pos.current.x += (target.current.x - pos.current.x) * 0.22;
    pos.current.y += (target.current.y - pos.current.y) * 0.22;
    if (chip.current) {
      chip.current.style.transform = `translate3d(${pos.current.x + 18}px, ${pos.current.y + 16}px, 0)`;
    }
    raf.current = requestAnimationFrame(loop);
  }

  React.useEffect(() => () => cancelAnimationFrame(raf.current), []);

  function usable() {
    return (
      window.matchMedia("(pointer: fine)").matches &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  return (
    <div
      className={className}
      onMouseEnter={(e) => {
        if (!usable()) return;
        target.current = { x: e.clientX, y: e.clientY };
        pos.current = { x: e.clientX, y: e.clientY };
        setActive(true);
        cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(loop);
      }}
      onMouseMove={(e) => {
        target.current = { x: e.clientX, y: e.clientY };
      }}
      onMouseLeave={() => {
        setActive(false);
        cancelAnimationFrame(raf.current);
      }}
    >
      {children}
      <div
        ref={chip}
        aria-hidden
        className={cn(
          "chrome-meta pointer-events-none fixed left-0 top-0 z-[80] flex items-center gap-1.5 whitespace-nowrap bg-obsidian px-2.5 py-1.5 text-[0.625rem] text-bone shadow-elev-2 transition-opacity duration-150",
          active ? "opacity-100" : "opacity-0",
        )}
      >
        <span className="size-1.5 rounded-full bg-gold" />
        {label}
      </div>
    </div>
  );
}
