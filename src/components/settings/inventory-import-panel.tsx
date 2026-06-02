"use client";

import * as React from "react";
import * as XLSX from "xlsx";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/toggle";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { money } from "@/lib/format";
import {
  ASSET_COLUMNS,
  ASSET_FIELD_LABEL,
  autoMapHeaders,
  rowToAsset,
  type AssetField,
} from "@/lib/inventory-import";

const IGNORE = "__ignore__";

type Parsed = {
  fileName: string;
  headers: string[];
  rows: unknown[][];
};

/** Settings panel: import a studio's gear inventory from an Excel/CSV sheet.
 *  Auto-discovers any column order/naming from the header row, lets the owner
 *  confirm the mapping, previews the result, then bulk-inserts. Also serves a
 *  template that captures every field on the assets screen. */
export function InventoryImportPanel() {
  const importBulk = useMutation(api.equipment.importBulk);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [mapping, setMapping] = React.useState<(AssetField | null)[]>([]);
  const [dedupe, setDedupe] = React.useState(true);
  const [importing, setImporting] = React.useState(false);
  const [result, setResult] = React.useState<{ inserted: number; skipped: number } | null>(null);

  /* ── Template ──────────────────────────────────────────────── */
  function downloadTemplate() {
    const headers = ASSET_COLUMNS.map((c) => c.header);
    const example = ASSET_COLUMNS.map((c) => c.example);
    const sheet = XLSX.utils.aoa_to_sheet([headers, example]);
    sheet["!cols"] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));

    // A second sheet documents required fields + allowed values.
    const guide = XLSX.utils.aoa_to_sheet([
      ["Column", "Required", "Notes"],
      ...ASSET_COLUMNS.map((c) => [c.header, c.required ? "Yes" : "No", c.hint]),
      [],
      ["Tip", "", "Column order and exact names don't matter - Pulse auto-detects them from your header row. Only Name is required."],
    ]);
    guide["!cols"] = [{ wch: 20 }, { wch: 10 }, { wch: 70 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Inventory");
    XLSX.utils.book_append_sheet(wb, guide, "Instructions");
    XLSX.writeFile(wb, "pulse-inventory-template.xlsx");
  }

  /* ── Parse an uploaded file ────────────────────────────────── */
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("empty");
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false, blankrows: false });
      if (aoa.length < 1) throw new Error("no rows");

      const headers = (aoa[0] as unknown[]).map((h) => String(h ?? "").trim());
      const rows = aoa.slice(1).filter((r) => (r as unknown[]).some((c) => String(c ?? "").trim() !== ""));
      if (headers.filter(Boolean).length === 0) throw new Error("no headers");

      setParsed({ fileName: file.name, headers, rows });
      setMapping(autoMapHeaders(headers));
    } catch {
      toast.error("Could not read that file. Use the template, or export your sheet as .xlsx or .csv.");
    } finally {
      // Allow re-selecting the same file.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function setColumnField(index: number, field: AssetField | null) {
    setMapping((prev) => {
      const next = [...prev];
      // A field maps once - clear any other column holding it.
      if (field) next.forEach((f, i) => { if (f === field && i !== index) next[i] = null; });
      next[index] = field;
      return next;
    });
  }

  // Build clean assets from the current mapping.
  const assets = React.useMemo(() => {
    if (!parsed) return [];
    return parsed.rows
      .map((row) => {
        const obj: Partial<Record<AssetField, unknown>> = {};
        mapping.forEach((field, i) => {
          if (field) obj[field] = (row as unknown[])[i];
        });
        return rowToAsset(obj);
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);
  }, [parsed, mapping]);

  const hasNameColumn = mapping.includes("name");

  function reset() {
    setParsed(null);
    setMapping([]);
    setResult(null);
  }

  async function runImport() {
    if (assets.length === 0) return;
    setImporting(true);
    try {
      const res = await importBulk({
        items: assets.map((a) => ({
          name: a.name,
          category: a.category as "console" | "mic" | "outboard" | "instrument" | "monitor" | "rig" | "other",
          purchaseCents: a.purchaseCents,
          currentValueCents: a.currentValueCents,
          serialNumber: a.serialNumber,
          condition: a.condition,
          notes: a.notes,
          status: a.status as "available" | "in_use" | "maintenance" | "retired",
          purchaseDate: a.purchaseDate,
          roomName: a.roomName,
        })),
        skipDuplicateSerials: dedupe,
      });
      setResult(res);
      toast.success(`Imported ${res.inserted} item${res.inserted === 1 ? "" : "s"}.`);
      setParsed(null);
      setMapping([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Import inventory</CardTitle>
          <CardDescription>
            Upload your gear list as Excel (.xlsx) or CSV. Pulse reads your header row and
            auto-detects the columns in any order or naming - you just confirm the mapping.
          </CardDescription>
        </div>
        <Button variant="outline" onClick={downloadTemplate}>
          <Download className="size-4" />
          Template
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Upload */}
        {!parsed && !result && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-hairline-2 bg-coal-2 px-4 py-10 text-center transition hover:border-gold-dim/60"
          >
            <Upload className="size-6 text-ash-dim" />
            <span className="text-sm font-medium text-bone">Choose a spreadsheet</span>
            <span className="text-xs text-ash-dim">.xlsx, .xls or .csv - first sheet, header row on top</span>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="hidden"
          onChange={onFile}
        />

        {/* Result */}
        {result && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-positive/30 bg-positive/10 px-4 py-3">
            <CheckCircle2 className="size-5 text-positive" />
            <span className="text-sm text-bone">
              Imported <strong>{result.inserted}</strong> item{result.inserted === 1 ? "" : "s"}
              {result.skipped > 0 && <> · skipped <strong>{result.skipped}</strong> (duplicate / no name)</>}.
            </span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={reset}>Import another</Button>
          </div>
        )}

        {/* Mapping + preview */}
        {parsed && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ash-dim">
              <FileSpreadsheet className="size-3.5" />
              <span className="text-ash">{parsed.fileName}</span>
              <span>· {parsed.rows.length} rows · {parsed.headers.length} columns detected</span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={reset}>Cancel</Button>
            </div>

            {!hasNameColumn && (
              <div className="flex items-start gap-2 rounded-md border border-caution/30 bg-caution/10 px-3 py-2.5">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-caution" />
                <p className="text-xs text-bone">Map one column to <strong>Name</strong> to import - it is the only required field.</p>
              </div>
            )}

            {/* Column mapping */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-ash">Column mapping</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {parsed.headers.map((header, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-md border border-hairline bg-coal-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-bone" title={header}>
                      {header || <span className="text-ash-dim">(unnamed column)</span>}
                    </span>
                    <span className="text-ash-dim">&rarr;</span>
                    <Select
                      value={mapping[i] ?? IGNORE}
                      onValueChange={(v) => setColumnField(i, v === IGNORE ? null : (v as AssetField))}
                    >
                      <SelectTrigger className="w-40 shrink-0"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={IGNORE}>Ignore</SelectItem>
                        {ASSET_COLUMNS.map((c) => (
                          <SelectItem key={c.field} value={c.field}>{ASSET_FIELD_LABEL[c.field]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            {/* Preview */}
            {assets.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-ash">Preview · {assets.length} importable</p>
                <div className="overflow-hidden rounded-md border border-hairline">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-coal-2 text-ash-dim">
                      <tr>
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Category</th>
                        <th className="px-3 py-2 font-medium">Value</th>
                        <th className="px-3 py-2 font-medium">Location</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assets.slice(0, 5).map((a, i) => (
                        <tr key={i} className="border-t border-hairline">
                          <td className="px-3 py-2 text-bone">{a.name}</td>
                          <td className="px-3 py-2 text-ash">{a.category}</td>
                          <td className="px-3 py-2 text-ash tabular-nums">{a.currentValueCents ? money(a.currentValueCents) : "-"}</td>
                          <td className="px-3 py-2 text-ash">{a.roomName ?? "Storage"}</td>
                          <td className="px-3 py-2 text-ash">{a.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {assets.length > 5 && (
                  <p className="text-[0.6875rem] text-ash-dim">+ {assets.length - 5} more</p>
                )}
              </div>
            )}

            <label className="flex items-center justify-between rounded-md border border-hairline bg-coal-2 px-3 py-2">
              <span className="text-sm text-bone">Skip rows whose serial number already exists</span>
              <Switch checked={dedupe} onCheckedChange={setDedupe} />
            </label>
          </div>
        )}
      </CardContent>

      {parsed && (
        <CardFooter className="justify-end gap-2">
          <Button variant="ghost" onClick={reset} disabled={importing}>Cancel</Button>
          <Button onClick={runImport} disabled={importing || assets.length === 0 || !hasNameColumn}>
            <Upload className="size-4" />
            {importing ? "Importing..." : `Import ${assets.length} item${assets.length === 1 ? "" : "s"}`}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
