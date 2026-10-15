"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ArrowRight, ClockRefresh } from "@untitledui/icons";
import { Badge } from "@/components/ui/badge";
import { longDate, timeOfDay } from "@/lib/format";
import { SessionLink } from "@/components/shell/entity-link";
import { ChangeDecisionButtons } from "./pending-change-banner";

/* "Changes waiting for you" (bookingFeatures.changeApproval): every proposed
   change to a booking this person may approve or decline. Renders nothing
   when the list is empty, so studios with the switch off never see it. */

export function ChangesWaitingCard() {
  const changes = useQuery(api.sessionChanges.pendingForMe, {});
  if (!changes || changes.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="overline">Changes waiting for you</h2>
        <Badge tone="caution">{changes.length}</Badge>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {changes.map((c) => (
          <div key={c._id} className="min-w-0 space-y-3 rounded-lg border border-caution/40 bg-coal p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="inline-flex items-center gap-1.5 text-xs text-caution">
                  <ClockRefresh className="size-3.5 shrink-0" />
                  {c.origin === "google" ? "Changed in Google Calendar" : `${c.requesterName} asked`}
                </p>
                <p className="text-sm font-medium text-bone">{c.summary}</p>
                <p className="text-xs text-steel">
                  {c.sessionTitle} · {c.clientName} · {longDate(c.sessionStart)}, {timeOfDay(c.sessionStart)}
                </p>
                {c.reason && <p className="text-xs text-steel">&ldquo;{c.reason}&rdquo;</p>}
              </div>
              <SessionLink
                sessionId={c.sessionId}
                title={`Open ${c.sessionTitle}`}
                className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-gold hover:underline"
              >
                Open
                <ArrowRight className="size-3.5" />
              </SessionLink>
            </div>
            <ChangeDecisionButtons change={c} />
          </div>
        ))}
      </div>
    </section>
  );
}
