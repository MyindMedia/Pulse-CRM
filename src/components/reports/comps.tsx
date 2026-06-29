"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { money, shortDate } from "@/lib/format";
import { ReportCard, ReportStat } from "./report-shell";

function reasonLabel(r: string) {
  return r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CompsReport() {
  const data = useQuery(api.reports.compSummary);
  const empty = data !== undefined && data.rows.length === 0;

  return (
    <ReportCard
      title="Comps & discounts"
      description="Every comped or discounted session and the revenue you gave away - list value minus what you charged - broken down by reason and client."
      loading={data === undefined}
      empty={empty}
      emptyTitle="No comps or discounts"
      emptyDescription="When you comp or discount a session, it shows here with the foregone revenue."
    >
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-4">
            <ReportStat label="Foregone revenue" value={money(data.totalForegoneCents, { compact: true })} tone="gold" />
            <ReportStat label="Comped" value={String(data.compedCount)} tone="caution" />
            <ReportStat label="Discounted" value={String(data.discountedCount)} tone="caution" />
            <ReportStat
              label="Of billable value"
              value={`${Math.round(data.leakageShare * 100)}%`}
              tone={data.leakageShare >= 0.2 ? "critical" : undefined}
            />
          </div>

          {data.byReason.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.byReason.map((r) => (
                <span
                  key={r.reason}
                  className="inline-flex items-center gap-1.5 rounded-full border border-graphite/50 bg-coal-2 px-2.5 py-1 text-xs text-steel"
                >
                  {reasonLabel(r.reason)}
                  <span className="font-meta text-bone">{money(r.foregoneCents, { compact: true })}</span>
                  <span className="text-steel/60">· {r.count}</span>
                </span>
              ))}
            </div>
          )}

          <Table>
            <THead>
              <TR>
                <TH>Session</TH>
                <TH>Client</TH>
                <TH>Type</TH>
                <TH>Reason</TH>
                <TH className="text-right">List</TH>
                <TH className="text-right">Charged</TH>
                <TH className="text-right">Foregone</TH>
                <TH className="text-right">When</TH>
              </TR>
            </THead>
            <TBody>
              {data.rows.map((r) => (
                <TR key={r.sessionId}>
                  <TD className="font-medium">{r.title}</TD>
                  <TD className="text-steel">{r.artistName}</TD>
                  <TD>
                    <Badge tone="caution" className="capitalize">{r.compType}</Badge>
                  </TD>
                  <TD className="text-steel/80">{reasonLabel(r.reason)}</TD>
                  <TD className="text-right font-meta tabular-nums text-steel/70">{money(r.listValueCents)}</TD>
                  <TD className="text-right font-meta tabular-nums text-steel">{money(r.chargedCents)}</TD>
                  <TD className="text-right font-meta tabular-nums font-medium text-gold-bright">{money(r.foregoneCents)}</TD>
                  <TD className="text-right tabular-nums text-steel/70">{shortDate(r.startTime)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </ReportCard>
  );
}
