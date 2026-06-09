"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { money } from "@/lib/format";
import { ReportCard, ReportStat } from "./report-shell";

export function UnpaidAgingReport() {
  const data = useQuery(api.reports.unpaidAging);
  const empty = data !== undefined && data.rows.length === 0;

  return (
    <ReportCard
      title="Unpaid-balance aging"
      description="Outstanding balance per client, bucketed by how long the session has been owed."
      loading={data === undefined}
      empty={empty}
      emptyTitle="All balances current"
      emptyDescription="No client has an outstanding balance on a past session."
    >
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            <ReportStat label="0-30 days" value={money(data.totals.b0, { compact: true })} />
            <ReportStat label="31-60 days" value={money(data.totals.b30, { compact: true })} tone="caution" />
            <ReportStat label="61-90 days" value={money(data.totals.b60, { compact: true })} tone="caution" />
            <ReportStat label="90+ days" value={money(data.totals.b90, { compact: true })} tone="critical" />
            <ReportStat label="Total outstanding" value={money(data.totals.total, { compact: true })} tone="gold" />
          </div>

          <Table>
            <THead>
              <TR>
                <TH>Client</TH>
                <TH className="text-right">0-30</TH>
                <TH className="text-right">31-60</TH>
                <TH className="text-right">61-90</TH>
                <TH className="text-right">90+</TH>
                <TH className="text-right">Total</TH>
              </TR>
            </THead>
            <TBody>
              {data.rows.map((r) => (
                <TR key={r.artistId}>
                  <TD className="font-medium">{r.artistName}</TD>
                  <TD className="text-right tabular-nums text-steel">{r.b0 ? money(r.b0) : "-"}</TD>
                  <TD className="text-right tabular-nums text-steel">{r.b30 ? money(r.b30) : "-"}</TD>
                  <TD className="text-right tabular-nums text-steel">{r.b60 ? money(r.b60) : "-"}</TD>
                  <TD className="text-right tabular-nums text-critical">{r.b90 ? money(r.b90) : "-"}</TD>
                  <TD className="text-right font-meta font-semibold tabular-nums text-gold">{money(r.total)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </ReportCard>
  );
}
