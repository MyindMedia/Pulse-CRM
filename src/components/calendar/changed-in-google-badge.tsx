"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";

function when(ts?: number): string {
  return ts ? new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
}

/**
 * "Changed in Google" flag for a booking. Mount it in the booking sheet:
 * `<ChangedInGoogleBadge sessionId={session._id} changedAt={session.googleChangedAt} />`.
 * Shows only while a Google edit is waiting for a decision, and says what
 * Google changed (a new time, or a deletion). The approve/decline buttons live
 * with the change-approval UI.
 */
export function ChangedInGoogleBadge({ sessionId, changedAt }: { sessionId: Id<"sessions">; changedAt?: number }) {
  const pending = useQuery(api.googleCalendarSync.pendingChangeForSession, changedAt ? { sessionId } : "skip");
  if (!changedAt || !pending) return null;
  const detail =
    pending.proposed.status === "cancelled"
      ? "Deleted in Google"
      : pending.proposed.startTime
        ? `Moved in Google to ${when(pending.proposed.startTime)}`
        : "Changed in Google";
  return (
    <Badge tone="caution" dot title={detail}>
      Changed in Google
    </Badge>
  );
}
