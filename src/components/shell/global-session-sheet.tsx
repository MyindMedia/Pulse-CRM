"use client";

import { Suspense, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";

/* Loaded the first time a booking is opened (or deep-linked), not on every
   cold load of every page; then kept mounted so closing animates. */
const SessionSheet = dynamic(() => import("@/components/calendar/session-sheet").then((m) => m.SessionSheet), { ssr: false });
import { SESSION_PARAM } from "@/lib/entity-href";
import { useOpenSession } from "@/lib/use-open-session";

/** One booking sheet for the whole app: `?session=<id>` on any route opens it
 *  in place. The calendar keeps its own sheet (it reads the same param), so
 *  this one stands down there and a booking never opens twice. */
function GlobalSessionSheetInner() {
  const pathname = usePathname();
  const sessionId = useSearchParams().get(SESSION_PARAM);
  const openSession = useOpenSession();
  const [armed, setArmed] = useState(false);
  if (sessionId && !armed) setArmed(true);
  if (pathname === "/calendar" || pathname.startsWith("/calendar/")) return null;
  if (!armed) return null;
  return <SessionSheet sessionId={sessionId} onClose={() => openSession(null)} />;
}

export function GlobalSessionSheet() {
  return (
    <Suspense fallback={null}>
      <GlobalSessionSheetInner />
    </Suspense>
  );
}
