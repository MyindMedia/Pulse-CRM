"use client";

import { useQuery } from "convex/react";
import { CalendarCheck01 } from "@untitledui/icons";
import { api } from "@convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { longDate, money, timeOfDay } from "@/lib/format";
import { useCapabilities } from "@/lib/use-capabilities";
import { RequestDecision } from "./request-decision";

/* Pending booking requests, for owners and managers, at the top of the
   approval inbox. Each card has the client, room, time, engineer and gear,
   and Approve / Decline. Renders nothing for anyone who cannot decide, and
   nothing when there is nothing waiting (a studio with the switches off
   never sees it). */
export function BookingRequestsSection() {
  const { can, loaded } = useCapabilities();
  const mayDecide = loaded && can("schedule.manage");
  const rows = useQuery(api.bookingRequests.pending, mayDecide ? {} : "skip");
  if (!mayDecide || !rows || rows.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="overline">Booking requests</h2>
        <Badge tone="caution">{rows.length}</Badge>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((r) => (
          <div key={r._id} className="space-y-3 rounded-lg border border-graphite/50 bg-coal p-4 shadow-elev-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="caution">Request</Badge>
                  {r.pricingHidden && <Badge tone="neutral">No prices shown</Badge>}
                </div>
                <p className="mt-1 truncate font-grotesk text-sm font-semibold text-bone">{r.clientName}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-steel">
                  <CalendarCheck01 className="size-3.5 shrink-0" />
                  {longDate(r.startTime)} · {timeOfDay(r.startTime)} - {timeOfDay(r.endTime)}
                </p>
              </div>
              {r.rateCents !== undefined && (
                <span className="shrink-0 font-meta text-sm text-bone">{money(r.rateCents)}</span>
              )}
            </div>
            <dl className="space-y-1 text-xs">
              <Line label="Room" value={r.roomName ?? "Unassigned"} />
              {r.engineerName && (
                <Line
                  label="Engineer"
                  value={`${r.engineerName}${r.engineerRequestStatus === "confirmed" ? " (can take it)" : r.engineerRequestStatus === "pending" ? " (asked)" : ""}`}
                />
              )}
              {r.gear.length > 0 && <Line label="Gear" value={r.gear.join(", ")} />}
              {r.serviceAddOns.length > 0 && <Line label="Add-ons" value={r.serviceAddOns.join(", ")} />}
              {r.gearRequestNote && <Line label="Gear request" value={r.gearRequestNote} />}
              {r.notes && <Line label="Notes" value={r.notes} />}
              {(r.clientEmail || r.clientPhone) && (
                <Line label="Contact" value={[r.clientEmail, r.clientPhone].filter(Boolean).join(" · ")} />
              )}
            </dl>
            <RequestDecision
              sessionId={r._id}
              requestStatus="pending"
              amountPaidCents={r.amountPaidCents}
              compact
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-steel/70">{label}</dt>
      <dd className="min-w-0 break-words text-bone">{value}</dd>
    </div>
  );
}
