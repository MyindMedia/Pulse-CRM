import * as React from "react";
import { cn } from "@/lib/utils";

/** Standard page header - overline, title, optional description + actions. */
export function PageHeader({
  overline,
  title,
  description,
  actions,
  className,
}: {
  overline?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="space-y-1">
        {overline && <p className="overline">{overline}</p>}
        <h1 className="font-display text-2xl font-bold tracking-tight text-bone">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-ash">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Labelled content section with optional trailing control. */
export function Section({
  title,
  trailing,
  children,
  className,
}: {
  title?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {(title || trailing) && (
        <div className="flex items-center justify-between gap-3">
          {title && <h2 className="overline">{title}</h2>}
          {trailing}
        </div>
      )}
      {children}
    </section>
  );
}
