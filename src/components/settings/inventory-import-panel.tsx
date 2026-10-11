"use client";

import * as React from "react";
import * as XLSX from "xlsx";
import { useAction, useMutation } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { IMPORT_ROW_LIMIT } from "@convex/lib/jev/gearMatch";
import { toast } from "sonner";
import { Check, Download, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/toggle";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EQUIPMENT_CATEGORIES, categoryMeta, type EquipmentCategory } from "@/components/studio/constants";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ASSET_COLUMNS,
  ASSET_FIELD_LABEL,
  autoMapHeaders,
  rowToAsset,
  toImportItems,
  type AssetField,
} from "@/lib/inventory-import";

const IGNORE = "__ignore__";

type Parsed = {
  fileName: string;
  headers: string[];
  rows: unknown[][];
};

type SuggestRows = FunctionArgs<typeof api.gearMatch.suggestImport>["rows"];
type RowSuggestion = FunctionReturnType<typeof api.gearMatch.suggestImport>["suggestions"][number];
type CategorySuggestion = NonNullable<RowSuggestion["category"]>;

/** Suggestions for one exact set of preview rows (`request`). */
type Suggestions = { request: string; loading: boolean; byRow: Map<number, RowSuggestion> };
/** The owner's calls on those rows: categories confirmed or picked, rows skipped. */
type Decisions = { request: string; categories: Record<number, EquipmentCategory>; skipped: Set<number> };

const NO_DECISIONS: Decisions = { request: "", categories: {}, skipped: new Set() };
const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Settings panel: import a studio's gear inventory from an Excel/CSV sheet.
 *  Auto-discovers any column order/naming from the header row, lets the owner
 *  confirm the mapping, previews the result, then bulk-inserts. Also serves a
 *  template that captures every field on the assets screen.
 *
 *  The preview also asks Jev (convex/gearMatch.ts) for a category where the
 *  sheet has none Pulse recognises, and flags rows that look like gear the
 *  studio already has. Suggestions apply only once the owner confirms them;
 *  with no answer from Jev the import is exactly what it always was. */
export function InventoryImportPanel() {
  const importBulk = useMutation(api.equipment.importBulk);
  const suggestImport = useAction(api.gearMatch.suggestImport);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [mapping, setMapping] = React.useState<(AssetField | null)[]>([]);
  const [dedupe, setDedupe] = React.useState(true);
  const [importing, setImporting] = React.useState(false);
  const [result, setResult] = React.useState<{ inserted: number; skipped: number } | null>(null);
  const [suggestions, setSuggestions] = React.useState<Suggestions | null>(null);
  const [decisions, setDecisions] = React.useState<Decisions>(NO_DECISIONS);

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

  /* ── Suggestions (Jev) ─────────────────────────────────────── */
  // What gets asked about: the first rows, gear fields only, never money.
  // As a string so a remap that leaves these rows alone asks nothing new.
  const request = React.useMemo(
    () =>
      JSON.stringify(
        assets.slice(0, IMPORT_ROW_LIMIT).map((a, row) => ({
          row,
          name: a.name,
          notes: a.notes,
          sheetCategory: a.sheetCategory,
          needsCategory: !a.categoryKnown,
        })),
      ),
    [assets],
  );

  React.useEffect(() => {
    const rows = JSON.parse(request) as SuggestRows;
    if (rows.length === 0) return;
    let live = true;
    // Wait for the mapping to settle before asking.
    const timer = setTimeout(() => {
      setSuggestions({ request, loading: true, byRow: new Map() });
      suggestImport({ rows })
        .then((res) => {
          if (live) setSuggestions({ request, loading: false, byRow: new Map(res.suggestions.map((s) => [s.row, s])) });
        })
        .catch(() => {
          // No suggestions: the preview and the import stay as they always were.
          if (live) setSuggestions({ request, loading: false, byRow: new Map() });
        });
    }, 600);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [request, suggestImport]);

  // Both belong to one exact set of rows; a remap that changes the rows drops them.
  const active = suggestions?.request === request ? suggestions : null;
  const mine = decisions.request === request ? decisions : NO_DECISIONS;
  const flagged = active ? [...active.byRow.values()].sort((a, b) => a.row - b.row) : [];
  // A suggested category the owner has not yet confirmed or changed.
  const pending = flagged.filter(
    (s): s is RowSuggestion & { category: CategorySuggestion } =>
      Boolean(s.category) && mine.categories[s.row] === undefined && !mine.skipped.has(s.row),
  );

  function decide(change: (d: Decisions) => Decisions) {
    setDecisions((d) => change(d.request === request ? d : { request, categories: {}, skipped: new Set() }));
  }
  const choose = (row: number, category: EquipmentCategory) =>
    decide((d) => ({ ...d, categories: { ...d.categories, [row]: category } }));
  const toggleSkip = (row: number) =>
    decide((d) => {
      const skipped = new Set(d.skipped);
      if (skipped.has(row)) skipped.delete(row);
      else skipped.add(row);
      return { ...d, skipped };
    });
  // One click for each answer to the whole list: take every suggestion, or
  // keep those rows as the import has always left them (Other).
  const acceptAll = () =>
    decide((d) => ({
      ...d,
      categories: { ...d.categories, ...Object.fromEntries(pending.map((s) => [s.row, s.category.value])) },
    }));
  const keepAllAsOther = () =>
    decide((d) => ({
      ...d,
      categories: { ...d.categories, ...Object.fromEntries(pending.map((s) => [s.row, "other" as const])) },
    }));

  const items = toImportItems(assets, { categories: mine.categories, skipped: mine.skipped });
  const categoryOf = (row: number) => mine.categories[row] ?? assets[row].category;

  function reset() {
    setParsed(null);
    setMapping([]);
    setResult(null);
    setSuggestions(null);
    setDecisions(NO_DECISIONS);
  }

  async function runImport() {
    if (items.length === 0) return;
    setImporting(true);
    try {
      const res = await importBulk({ items, skipDuplicateSerials: dedupe });
      setResult(res);
      toast.success(`Imported ${res.inserted} item${res.inserted === 1 ? "" : "s"}.`);
      setParsed(null);
      setMapping([]);
      setSuggestions(null);
      setDecisions(NO_DECISIONS);
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
            className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-graphite/60 bg-coal-2 px-4 py-10 text-center transition hover:border-gold-dim/60"
          >
            <Upload className="size-6 text-steel/70" />
            <span className="text-sm font-medium text-bone">Choose a spreadsheet</span>
            <span className="text-xs text-steel/70">.xlsx, .xls or .csv - first sheet, header row on top</span>
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
            <div className="flex flex-wrap items-center gap-2 text-xs text-steel/70">
              <FileSpreadsheet className="size-3.5" />
              <span className="text-steel">{parsed.fileName}</span>
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
              <p className="text-xs font-medium text-steel">Column mapping</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {parsed.headers.map((header, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-md border border-graphite/50 bg-coal-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-bone" title={header}>
                      {header || <span className="text-steel/70">(unnamed column)</span>}
                    </span>
                    <span className="text-steel/70">&rarr;</span>
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

            {/* Suggestions: categories to confirm, possible duplicates */}
            {active?.loading && (
              <p className="flex items-center gap-2 text-xs text-steel">
                <Loader2 className="size-3.5 animate-spin" />
                Checking categories and possible duplicates...
              </p>
            )}
            {flagged.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-medium text-steel">
                    Suggestions · {flagged.length} row{flagged.length === 1 ? "" : "s"}
                    {assets.length > IMPORT_ROW_LIMIT && <> · first {IMPORT_ROW_LIMIT} rows checked</>}
                  </p>
                  {pending.length > 0 && (
                    <div className="ml-auto flex gap-1">
                      <Button size="sm" variant="secondary" onClick={acceptAll}>
                        <Check className="size-3.5" />
                        Use all {pending.length}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={keepAllAsOther}>Keep as Other</Button>
                    </div>
                  )}
                </div>
                <div className="divide-y divide-graphite/50 overflow-hidden rounded-md border border-graphite/50">
                  {flagged.map((s) => {
                    const asset = assets[s.row];
                    if (!asset) return null;
                    const skipped = mine.skipped.has(s.row);
                    const chosen = mine.categories[s.row];
                    const suggested = s.category;
                    return (
                      <div key={s.row} className={cn("flex flex-wrap items-center gap-2 px-3 py-2", skipped && "opacity-60")}>
                        <span className="min-w-0 flex-1 truncate text-sm text-bone" title={asset.name}>{asset.name}</span>
                        {suggested ? (
                          <>
                            <Select
                              value={chosen ?? suggested.value}
                              onValueChange={(v) => choose(s.row, v as EquipmentCategory)}
                              disabled={skipped}
                            >
                              <SelectTrigger className="h-8 w-44 shrink-0" aria-label={`Category for ${asset.name}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {EQUIPMENT_CATEGORIES.map((c) => (
                                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {chosen === undefined && !skipped && (
                              <>
                                <Badge tone="gold" title="Suggested by Pulse. Confirm it or pick another category.">
                                  Suggested · {pct(suggested.confidence)} sure
                                </Badge>
                                <Button size="sm" variant="ghost" onClick={() => choose(s.row, suggested.value)}>
                                  <Check className="size-3.5" />
                                  Use
                                </Button>
                              </>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-steel">{categoryMeta(categoryOf(s.row)).label}</span>
                        )}
                        {s.match && (
                          <>
                            <Badge tone="caution" className="max-w-[18rem]" title={`Looks like your existing ${s.match.name}`}>
                              <span className="truncate">Looks like your existing {s.match.name}</span>
                            </Badge>
                            <Button size="sm" variant="ghost" onClick={() => toggleSkip(s.row)}>
                              {skipped ? "Import anyway" : "Skip"}
                            </Button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-[0.6875rem] text-steel/70">
                  Nothing changes until you confirm it. Flagged rows still import unless you skip them.
                </p>
              </div>
            )}

            {/* Preview */}
            {items.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-steel">Preview · {items.length} importable</p>
                <div className="overflow-hidden rounded-md border border-graphite/50">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-coal-2 text-steel/70">
                      <tr>
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Category</th>
                        <th className="px-3 py-2 font-medium">Value</th>
                        <th className="px-3 py-2 font-medium">Location</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.slice(0, 5).map((a, i) => (
                        <tr key={i} className="border-t border-graphite/50">
                          <td className="px-3 py-2 text-bone">{a.name}</td>
                          <td className="px-3 py-2 text-steel">{a.category}</td>
                          <td className="px-3 py-2 text-steel tabular-nums">{a.currentValueCents ? money(a.currentValueCents) : "-"}</td>
                          <td className="px-3 py-2 text-steel">{a.roomName ?? "Storage"}</td>
                          <td className="px-3 py-2 text-steel">{a.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {items.length > 5 && (
                  <p className="text-[0.6875rem] text-steel/70">+ {items.length - 5} more</p>
                )}
              </div>
            )}

            <label className="flex items-center justify-between rounded-md border border-graphite/50 bg-coal-2 px-3 py-2">
              <span className="text-sm text-bone">Skip rows whose serial number already exists</span>
              <Switch checked={dedupe} onCheckedChange={setDedupe} />
            </label>
          </div>
        )}
      </CardContent>

      {parsed && (
        <CardFooter className="flex-wrap justify-end gap-2">
          {pending.length > 0 && (
            <p className="mr-auto text-xs text-caution">
              Confirm or change {pending.length} suggested categor{pending.length === 1 ? "y" : "ies"} to import.
            </p>
          )}
          <Button variant="ghost" onClick={reset} disabled={importing}>Cancel</Button>
          <Button onClick={runImport} disabled={importing || items.length === 0 || !hasNameColumn || pending.length > 0}>
            <Upload className="size-4" />
            {importing ? "Importing..." : `Import ${items.length} item${items.length === 1 ? "" : "s"}`}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
