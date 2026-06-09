"use client";

import * as React from "react";
import { Timer } from "lucide-react";
import { cn } from "@/lib/utils";

/** Format a millisecond span as a compact countdown - "1h 12m", "4m 20s". */
function formatSpan(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/**
 * Live countdown to a hold's expiry. Ticks every second. Goes critical
 * inside the final 30 minutes and reads "Expired" once the window closes.
 */
export function HoldCountdown({
  expiresAt,
  className,
}: {
  expiresAt: number;
  className?: string;
}) {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remaining = expiresAt - now;
  const expired = remaining <= 0;
  const urgent = !expired && remaining < 30 * 60_000;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-meta text-[0.6875rem] tabular-nums",
        expired
          ? "text-critical"
          : urgent
            ? "text-caution"
            : "text-steel/70",
        className,
      )}
    >
      <Timer className="size-3" />
      {expired ? "Hold expired" : `${formatSpan(remaining)} left`}
    </span>
  );
}
