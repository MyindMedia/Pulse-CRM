"use client";

import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SessionSheet } from "@/components/calendar/session-sheet";
import { SESSION_PARAM } from "@/lib/entity-href";
import { useOpenSession } from "@/lib/use-open-session";

/** One booking sheet for the whole app: `?session=<id>` on any route opens it
 *  in place. The calendar keeps its own sheet (it reads the same param), so
 *  this one stands down there and a booking never opens twice. */
function GlobalSessionSheetInner() {
  const pathname = usePathname();
  const sessionId = useSearchParams().get(SESSION_PARAM);
  const openSession = useOpenSession();
  if (pathname === "/calendar" || pathname.startsWith("/calendar/")) return null;
  return <SessionSheet sessionId={sessionId} onClose={() => openSession(null)} />;
}

export function GlobalSessionSheet() {
  return (
    <Suspense fallback={null}>
      <GlobalSessionSheetInner />
    </Suspense>
  );
}
