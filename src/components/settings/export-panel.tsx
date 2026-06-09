"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Download, FileSpreadsheet } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type CsvResult = { filename: string; csv: string };

/** Trigger a client-side download of a CSV payload. */
function downloadCsv({ filename, csv }: CsvResult) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type ExportDef = {
  key: string;
  label: string;
  description: string;
  run: () => Promise<CsvResult>;
};

function ExportRow({ def }: { def: ExportDef }) {
  const [busy, setBusy] = React.useState(false);
  async function handle() {
    setBusy(true);
    try {
      const result = await def.run();
      downloadCsv(result);
      toast.success(`Exported ${def.label}.`);
    } catch {
      toast.error(`Could not export ${def.label}.`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-graphite/50 bg-coal/40 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-bone">{def.label}</p>
        <p className="truncate text-xs text-steel">{def.description}</p>
      </div>
      <Button variant="ghost" onClick={handle} disabled={busy}>
        <Download className="size-4" />
        {busy ? "Exporting…" : "CSV"}
      </Button>
    </div>
  );
}

/** Data export - one button per dataset, each downloads an org-scoped CSV. */
export function ExportPanel() {
  const clientsCsv = useMutation(api.exports.clientsCsv);
  const songsCsv = useMutation(api.exports.songsCsv);
  const bookingsCsv = useMutation(api.exports.bookingsCsv);
  const invoicesCsv = useMutation(api.exports.invoicesCsv);
  const splitSheetsCsv = useMutation(api.exports.splitSheetsCsv);
  const activityCsv = useMutation(api.exports.activityCsv);

  const defs: ExportDef[] = [
    { key: "clients", label: "Clients", description: "Artists and bands with status, value and contact details.", run: () => clientsCsv({}) },
    { key: "songs", label: "Songs", description: "Catalog with stage, metadata and revision budget.", run: () => songsCsv({}) },
    { key: "bookings", label: "Bookings", description: "Studio sessions with rates, deposits and status.", run: () => bookingsCsv({}) },
    { key: "invoices", label: "Invoices", description: "Invoice ledger with amounts, due dates and line items.", run: () => invoicesCsv({}) },
    { key: "splits", label: "Split sheets", description: "Per-contributor master and publishing splits.", run: () => splitSheetsCsv({}) },
    { key: "activity", label: "Activity log", description: "The workspace activity feed.", run: () => activityCsv({}) },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="size-4 text-gold" />
          Export your data
        </CardTitle>
        <CardDescription>
          Download an org-scoped CSV of any dataset. Each export is metered against your plan.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {defs.map((def) => (
          <ExportRow key={def.key} def={def} />
        ))}
      </CardContent>
    </Card>
  );
}
