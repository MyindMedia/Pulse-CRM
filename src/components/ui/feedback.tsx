import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Empty state - icon, headline, supporting line, optional action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline-2 " +
          "bg-coal/40 px-6 py-14 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="grid size-12 place-items-center rounded-lg bg-coal-2 text-ash-dim">
          <Icon className="size-6" />
        </span>
      )}
      <div className="space-y-1">
        <p className="font-display text-base font-semibold text-bone">{title}</p>
        {description && <p className="mx-auto max-w-sm text-sm text-ash">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-ash-dim", className)} />;
}

/** Centered loading block for full-panel waits. */
export function LoadingPanel({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-ash-dim">
      <Spinner />
      {label}
    </div>
  );
}
