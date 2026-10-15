"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

/* A small marker on a calendar booking that has a proposed change waiting
   for approval (bookingFeatures.changeApproval). Every dot shares one
   subscription: Convex dedupes identical queries. */

export function PendingChangeDot({ sessionId }: { sessionId: string }) {
  const ids = useQuery(api.sessionChanges.pendingSessionIds, {});
  if (!ids || !ids.includes(sessionId as (typeof ids)[number])) return null;
  return (
    <span
      className="size-1.5 shrink-0 rounded-full bg-caution ring-2 ring-caution/25"
      title="Change waiting for approval"
      aria-label="Change waiting for approval"
      role="img"
    />
  );
}
