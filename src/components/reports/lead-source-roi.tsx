"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { HBars } from "@/components/charts";
import { money, percent } from "@/lib/format";
import { titleCase } from "@/lib/labels";
import { ReportCard, ReportStat } from "./report-shell";

export function LeadSourceRoiReport() {
  const data = useQuery(api.reports.leadSourceRoi);
  const empty = data !== undefined && data.rows.length === 0;

  const chart =
    data?.rows.map((r) => ({
      source: titleCase(r.source),
      value: Math.round((r.wonValueCents + r.lifetimeValueCents) / 100),
    })) ?? [];

  return (
    <ReportCard
      title="Lead-source ROI"
      description="Acquisition source vs leads, converted clients, booked value and conversion rate."
      loading={data === undefined}
      empty={empty}
      emptyTitle="No lead sources yet"
      emptyDescription="Tag clients with a source to see which channels pay off."
    >
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <ReportStat label="Total leads" value={String(data.totalLeads)} />
            <ReportStat label="Won value" value={money(data.totalWonValueCents, { compact: true })} tone="positive" />
            <ReportStat label="Lifetime value" value={money(data.totalLifetimeValueCents, { compact: true })} tone="gold" />
          </div>

          {chart.length > 0 && <HBars data={chart} labelKey="source" valueKey="value" />}

          <Table>
            <THead>
              <TR>
                <TH>Source</TH>
                <TH className="text-right">Leads</TH>
                <TH className="text-right">Converted</TH>
                <TH className="text-right">Won value</TH>
                <TH className="text-right">Lifetime value</TH>
                <TH className="text-right">Conversion</TH>
              </TR>
            </THead>
            <TBody>
              {data.rows.map((r) => (
                <TR key={r.source}>
                  <TD className="font-medium capitalize">{titleCase(r.source)}</TD>
                  <TD className="text-right tabular-nums text-steel">{r.leads}</TD>
                  <TD className="text-right tabular-nums text-steel">{r.converted}</TD>
                  <TD className="text-right font-meta tabular-nums text-positive">
                    {r.wonValueCents ? money(r.wonValueCents) : "-"}
                  </TD>
                  <TD className="text-right font-meta tabular-nums text-bone">{money(r.lifetimeValueCents)}</TD>
                  <TD className="text-right font-meta tabular-nums text-gold">{percent(r.conversionRate)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </ReportCard>
  );
}
