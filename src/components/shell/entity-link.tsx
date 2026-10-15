"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode, MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { entityHref, sessionHref } from "@/lib/entity-href";
import { useOpenSession } from "@/lib/use-open-session";

/** Shared focus ring for every drill-down link, so a keyboard user sees where
 *  they are on any list. */
export const DRILL_FOCUS =
  "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-gold/40";

/** Opens a booking's sheet in place, on whatever page this sits on. A real
 *  <a> (middle click and "open in new tab" land on the same page with the
 *  sheet open) that takes over a plain click so the page never navigates. */
export function SessionLink({
  sessionId,
  children,
  className,
  title,
  stopPropagation = false,
}: {
  sessionId: string;
  children: ReactNode;
  className?: string;
  title?: string;
  /** For a link inside a clickable card: keep the card's own click out. */
  stopPropagation?: boolean;
}) {
  const pathname = usePathname();
  const openSession = useOpenSession();
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (stopPropagation) event.stopPropagation();
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openSession(sessionId);
  }
  return (
    <a
      href={sessionHref(sessionId, { pathname })}
      onClick={onClick}
      title={title}
      data-drill="session"
      className={cn(DRILL_FOCUS, className)}
    >
      {children}
    </a>
  );
}

/** Links any entity to its detail (see `entityHref`). A session goes through
 *  SessionLink; anything with no destination renders its children as is. */
export function EntityLink({
  type,
  id,
  children,
  className,
  title,
  stopPropagation = false,
}: {
  type: string;
  id: string | null | undefined;
  children: ReactNode;
  className?: string;
  title?: string;
  stopPropagation?: boolean;
}) {
  if (id && (type === "session" || type === "booking")) {
    return (
      <SessionLink sessionId={id} className={className} title={title} stopPropagation={stopPropagation}>
        {children}
      </SessionLink>
    );
  }
  const href = entityHref(type, id ?? undefined);
  if (!href) return <span className={className}>{children}</span>;
  return (
    <Link
      href={href}
      title={title}
      data-drill={type}
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      className={cn(DRILL_FOCUS, className)}
    >
      {children}
    </Link>
  );
}
