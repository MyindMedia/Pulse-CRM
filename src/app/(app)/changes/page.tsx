"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { History } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { CapabilityGuard } from "@/components/shell/capability-guard";

/* The change log: who changed what, and when.
 *
 * Every signed-in change to patch, inventory, check-ins, checklists, bookings,
 * clients, the team and the rest lands here, recorded by the server as it
 * happens (convex/lib/changeAudit.ts). Owners and managers only. A manager
 * whose owner has hidden money sees that a figure changed and who changed it,
 * never the figure. */

const AREAS = [
  { value: "", label: "Everything" },
  { value: "patch", label: "Patch" },
  { value: "inventory", label: "Inventory" },
  { value: "checkins", label: "Check-ins" },
  { value: "checklists", label: "Checklists" },
  { value: "bookings", label: "Bookings and rooms" },
  { value: "clients", label: "Clients" },
  { value: "team", label: "Team and time" },
  { value: "money", label: "Money" },
  { value: "other", label: "Everything else" },
];

const DAYS = [
  { value: 1, label: "Today" },
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
  { value: 365, label: "Last year" },
];

const NOUN: Record<string, string> = {
  sessions: "booking", artists: "client", rooms: "room", bookableServices: "service",
  equipment: "gear", softwareLicenses: "software", visitors: "visitor check-in",
  sessionChecklists: "session checklist", arrivalPrep: "arrival prep", members: "teammate",
  shifts: "shift", timeEntries: "clock entry", timeOff: "time off", availability: "availability",
  patchSpaces: "patch space", deviceInstances: "patch device", ports: "port", connections: "cable",
  patchAnnotations: "patch note", patchGroups: "patch group", invoices: "invoice", payments: "payment",
  expenses: "expense", payouts: "payout", packageProducts: "package", packageCredits: "package credit",
  feeTemplates: "fee", membershipPlans: "membership plan", clientMessages: "client message",
  opportunities: "deal", songs: "song", deliverables: "deliverable", splitSheets: "split sheet",
  licenses: "licence",
};

const VERB = { insert: "added", update: "changed", delete: "removed" } as const;

function words(field: string): string {
  return field
    .replace(/Cents$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/Id$/, "")
    .toLowerCase()
    .trim();
}

function shown(value: unknown, field: string): string {
  if (value === null || value === undefined) return "empty";
  if (typeof value === "number" && field.endsWith("Cents")) {
    return (value / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  }
  if (typeof value === "number" && (field.endsWith("At") || field.endsWith("Time") || field === "date")) {
    return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  return String(value);
}

export default function ChangeLogPage() {
  return (
    <CapabilityGuard cap="audit.read" title="The change log is for owners and managers">
      <ChangeLogView />
    </CapabilityGuard>
  );
}

function ChangeLogView() {
  const [area, setArea] = React.useState("");
  const [days, setDays] = React.useState(7);
  const rows = useQuery(api.changeAudit.list, { area: area || undefined, days });

  return (
    <div className="space-y-6">
      <PageHeader
        overline="Reports"
        title="Change log"
        description="Who changed what, and when. Patch, inventory, check-ins, checklists, bookings, clients and the team, recorded as it happens."
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="changes-area">Area</label>
        <select
          id="changes-area"
          value={area}
          onChange={(e) => setArea(e.target.value)}
          className="h-9 rounded-md border border-graphite/60 bg-coal px-3 text-sm text-bone focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
        >
          {AREAS.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="changes-days">Period</label>
        <select
          id="changes-days"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="h-9 rounded-md border border-graphite/60 bg-coal px-3 text-sm text-bone focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
        >
          {DAYS.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
        {rows && <span className="text-xs text-steel/70">{rows.length} {rows.length === 1 ? "change" : "changes"}</span>}
      </div>

      <Card>
        <CardContent className="pt-5">
          {rows === undefined ? (
            <SkeletonRows rows={6} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={History}
              title="No changes in this period"
              description="Edits made by anyone on the team show up here with their name and the time."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>When</TH>
                    <TH>Who</TH>
                    <TH>What</TH>
                    <TH>Changes</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((row) => (
                    <TR key={row._id}>
                      <TD className="whitespace-nowrap text-xs text-steel tabular-nums">
                        {new Date(row.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </TD>
                      <TD className="whitespace-nowrap text-sm text-bone">{row.actorName}</TD>
                      <TD className="text-sm text-steel">
                        <span className="text-bone">{VERB[row.op]}</span>{" "}
                        {NOUN[row.tableName] ?? words(row.tableName)}
                        {row.label ? <span className="text-bone"> {row.label}</span> : null}
                        <Badge tone="neutral" className="ml-2 align-middle">{AREAS.find((a) => a.value === row.area)?.label ?? "Other"}</Badge>
                      </TD>
                      <TD className="text-xs text-steel">
                        {row.op !== "update" ? (
                          "-"
                        ) : (
                          <ul className="space-y-0.5">
                            {row.fields.map((field) => {
                              const before = (row.before as Record<string, unknown> | null)?.[field];
                              const after = (row.after as Record<string, unknown> | null)?.[field];
                              const hasValues = row.before !== null || row.after !== null;
                              return (
                                <li key={field}>
                                  <span className="text-bone">{words(field)}</span>
                                  {hasValues && (before !== undefined || after !== undefined)
                                    ? `: ${shown(before, field)} -> ${shown(after, field)}`
                                    : null}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
