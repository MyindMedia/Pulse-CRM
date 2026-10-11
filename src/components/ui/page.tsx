"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { usePageHeaderSlots } from "@/components/shell/page-header-slot";

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
  const slots = usePageHeaderSlots();

  /* Inside the hardware shell the title, its caption and the page's keys
     live in the top bar chassis (kit section 6.1). They portal there, so the
     page keeps owning them: their state and context stay the page's. Until
     the top bar has mounted, nothing renders here and the nav label stands
     in. The overline is the nav section, which the sidebar already shows. */
  if (slots !== undefined) {
    return (
      <>
        {slots.title &&
          createPortal(
            <div className="min-w-0">
              <h1
                className="truncate font-sans text-[22px] font-extrabold leading-7 tracking-[-0.01em] text-bone lg:text-[26px] lg:leading-8"
                title={title}
              >
                {title}
              </h1>
              {description && (
                <p className="truncate font-sans text-[11px] leading-4 text-steel" title={description}>
                  {description}
                </p>
              )}
            </div>,
            slots.title,
          )}
        {actions && slots.actions && createPortal(actions, slots.actions)}
      </>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="rise-stagger space-y-1.5">
        {overline && <p className="overline">{overline}</p>}
        <h1 className="chrome-display text-[1.75rem] leading-[0.95] tracking-[-0.01em] text-bone sm:text-[2rem]">
          {title}
        </h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-steel">{description}</p>}
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
