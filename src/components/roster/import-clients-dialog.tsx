"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { CheckCircle2, FileUp, Upload, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";

/* Client CSV import dialog - paste or upload a CSV, preview the parsed rows,
   then upsert into the roster. Parsing is done client-side (no new dep) with a
   small RFC-4180-ish parser that handles quoted fields + embedded commas. */

type ParsedRow = {
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
  tags?: string[];
};

type FieldKey = "name" | "email" | "phone" | "notes" | "tags";

const FIELD_ALIASES: Record<FieldKey, string[]> = {
  name: ["name", "full name", "fullname", "client", "client name", "contact", "contact name", "artist"],
  email: ["email", "e-mail", "email address", "mail"],
  phone: ["phone", "phone number", "mobile", "cell", "tel", "telephone"],
  notes: ["notes", "note", "comment", "comments"],
  tags: ["tags", "tag", "labels", "label"],
};

const DEFAULT_ORDER: FieldKey[] = ["name", "email", "phone", "notes", "tags"];

/** Split raw CSV text into rows of string cells. Handles quoted fields with
 *  embedded commas, newlines and doubled-quote escapes. */
function tokenizeCsv(text: string): string[][] {
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  row.push(field);
  rows.push(row);
  // Drop rows that are entirely blank.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Detect a header row: map column index -> field when a cell matches a known
 *  alias. Returns null when no cell looks like a header (assume default order). */
function detectHeader(cells: string[]): Record<number, FieldKey> | null {
  const map: Record<number, FieldKey> = {};
  let matched = 0;
  cells.forEach((cell, idx) => {
    const key = cell.trim().toLowerCase();
    for (const field of Object.keys(FIELD_ALIASES) as FieldKey[]) {
      if (FIELD_ALIASES[field].includes(key)) {
        map[idx] = field;
        matched++;
        break;
      }
    }
  });
  return matched > 0 ? map : null;
}

function splitTags(cell: string): string[] {
  return cell
    .split(/[;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

type ParseResult = { rows: ParsedRow[]; skipped: number };

function parseClients(text: string): ParseResult {
  const table = tokenizeCsv(text);
  if (table.length === 0) return { rows: [], skipped: 0 };

  const header = detectHeader(table[0]);
  const colMap: Record<number, FieldKey> =
    header ?? Object.fromEntries(DEFAULT_ORDER.map((f, idx) => [idx, f]));
  const dataRows = header ? table.slice(1) : table;

  const rows: ParsedRow[] = [];
  let skipped = 0;
  for (const cells of dataRows) {
    const rec: ParsedRow = { name: "" };
    for (const [idxStr, field] of Object.entries(colMap)) {
      const val = (cells[Number(idxStr)] ?? "").trim();
      if (!val) continue;
      if (field === "tags") rec.tags = splitTags(val);
      else rec[field] = val;
    }
    if (!rec.name) {
      skipped++;
      continue;
    }
    rows.push(rec);
  }
  return { rows, skipped };
}

const PLACEHOLDER = `name,email,phone,tags,notes
Jordan Reyes,jordan@example.com,(404) 555-0142,vip;returning,Prefers night sessions
Casey Lin,casey@example.com,404.555.0119,,`;

export function ImportClientsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const importClients = useMutation(api.importClients.importClients);
  const [raw, setRaw] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{
    created: number;
    updated: number;
    skipped: number;
  } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Reset transient state whenever the dialog opens.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setRaw("");
      setResult(null);
      setSubmitting(false);
    }
  }

  const parsed = React.useMemo(() => (raw.trim() ? parseClients(raw) : null), [raw]);
  const preview = parsed?.rows ?? [];

  async function onUploadFile(file: File) {
    try {
      const text = await file.text();
      setRaw(text);
    } catch {
      toast.error("Could not read that file.");
    }
  }

  async function submit() {
    if (!parsed || preview.length === 0) {
      toast.error("Nothing to import - paste or upload a CSV with at least one named row.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await importClients({
        rows: preview.map((r) => ({
          name: r.name,
          email: r.email,
          phone: r.phone,
          notes: r.notes,
          tags: r.tags,
        })),
      });
      setResult(res);
      toast.success(
        `Imported ${res.created + res.updated} client${res.created + res.updated === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not import clients.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Import clients</DialogTitle>
          <DialogDescription>
            Moving from another tool? Paste your client list or upload a .csv. We match a header
            row for name, email, phone, tags and notes - and dedupe by email so nobody is imported
            twice.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {result ? (
            <div className="rounded-chrome border border-graphite/60 bg-coal/40 p-5 text-center">
              <CheckCircle2 className="mx-auto size-8 text-gold" />
              <p className="mt-3 font-grotesk text-lg font-semibold text-bone">Import complete</p>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="rounded-md border border-graphite/50 bg-coal-2/60 px-3 py-3">
                  <p className="font-meta text-xl font-semibold tabular-nums text-gold">{result.created}</p>
                  <p className="text-[0.6875rem] uppercase tracking-wide text-steel/70">New</p>
                </div>
                <div className="rounded-md border border-graphite/50 bg-coal-2/60 px-3 py-3">
                  <p className="font-meta text-xl font-semibold tabular-nums text-bone">{result.updated}</p>
                  <p className="text-[0.6875rem] uppercase tracking-wide text-steel/70">Updated</p>
                </div>
                <div className="rounded-md border border-graphite/50 bg-coal-2/60 px-3 py-3">
                  <p className="font-meta text-xl font-semibold tabular-nums text-steel">{result.skipped}</p>
                  <p className="text-[0.6875rem] uppercase tracking-wide text-steel/70">Skipped</p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-steel/70">
                  First row can be a header (name, email, phone, tags, notes) or plain columns in
                  that order. Separate multiple tags with a semicolon.
                </p>
                <label className="shrink-0 cursor-pointer">
                  <span className="inline-flex h-9 items-center gap-2 rounded-md border border-graphite/60 bg-coal/60 px-3 text-xs font-medium text-steel transition-colors hover:border-gold-dim hover:text-bone">
                    <FileUp className="size-3.5" />
                    Upload .csv
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onUploadFile(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              <Field label="CSV data" htmlFor="import-csv">
                <Textarea
                  id="import-csv"
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  rows={7}
                  placeholder={PLACEHOLDER}
                  className="font-meta text-xs"
                />
              </Field>

              {parsed && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-steel">
                    <Users className="size-3.5 text-gold" />
                    <span className="text-bone">{preview.length}</span> ready to import
                    {parsed.skipped > 0 && (
                      <span className="text-steel/70">
                        · {parsed.skipped} skipped (no name)
                      </span>
                    )}
                  </div>
                  {preview.length > 0 && (
                    <div className="max-h-56 overflow-auto rounded-md border border-graphite/50">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-obsidian text-[0.625rem] uppercase tracking-wide text-steel/70">
                          <tr>
                            <th className="px-3 py-2 font-semibold">Name</th>
                            <th className="px-3 py-2 font-semibold">Email</th>
                            <th className="px-3 py-2 font-semibold">Phone</th>
                            <th className="px-3 py-2 font-semibold">Tags</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.slice(0, 50).map((r, idx) => (
                            <tr key={idx} className="border-t border-graphite/40">
                              <td className="px-3 py-1.5 text-bone">{r.name}</td>
                              <td className="px-3 py-1.5 text-steel">{r.email ?? "-"}</td>
                              <td className="px-3 py-1.5 text-steel">{r.phone ?? "-"}</td>
                              <td className="px-3 py-1.5 text-steel/70">
                                {r.tags?.length ? r.tags.join(", ") : "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {preview.length > 50 && (
                        <p className="border-t border-graphite/40 px-3 py-1.5 text-[0.6875rem] text-steel/70">
                          + {preview.length - 50} more not shown in the preview.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </DialogBody>

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={submitting || preview.length === 0}>
                <Upload className="size-4" />
                {submitting
                  ? "Importing…"
                  : `Import ${preview.length || ""} client${preview.length === 1 ? "" : "s"}`.trim()}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
