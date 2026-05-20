import { cn } from "@/lib/utils";
import { clamp } from "@/lib/utils";

/** Slim progress meter - release campaigns, revision budgets, agent quotas. */
export function Progress({
  value,
  max = 1,
  tone = "gold",
  className,
}: {
  value: number;
  max?: number;
  tone?: "gold" | "positive" | "caution" | "critical" | "info";
  className?: string;
}) {
  const pct = clamp((value / max) * 100, 0, 100);
  const fill = {
    gold: "bg-gold",
    positive: "bg-positive",
    caution: "bg-caution",
    critical: "bg-critical",
    info: "bg-info",
  }[tone];
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-coal-3", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", fill)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
