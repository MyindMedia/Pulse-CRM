"use client";

import * as React from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { FileUp } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/feedback";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { putToR2 } from "@/lib/r2-upload";
import { errorMessage } from "@/lib/errors";

/* Upload a distributor statement. The file goes straight to R2; the server
   reads it back, recognises DistroKid, TuneCore and CD Baby on its own, and
   asks for a one-time column mapping for anything else. */

type Columns = {
  isrc?: string;
  title?: string;
  artist?: string;
  amount: string;
  currency?: string;
  units?: string;
  period?: string;
};

const FIELDS: { key: keyof Columns; label: string; required?: boolean }[] = [
  { key: "amount", label: "Amount earned", required: true },
  { key: "isrc", label: "ISRC" },
  { key: "title", label: "Song title" },
  { key: "artist", label: "Artist" },
  { key: "currency", label: "Currency" },
  { key: "period", label: "Sale month" },
  { key: "units", label: "Units / streams" },
];

const NONE = "__none";

export function UploadStatementDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const prepare = useMutation(api.royalties.prepareStatementUpload);
  const confirm = useAction(api.media.confirmUpload);
  const importStatement = useAction(api.royaltiesNode.importStatement);

  const [busy, setBusy] = React.useState<string | null>(null);
  const [mediaId, setMediaId] = React.useState<Id<"mediaFiles"> | null>(null);
  const [mapping, setMapping] = React.useState<{ headers: string[]; sample: string[][] } | null>(null);
  const [columns, setColumns] = React.useState<Partial<Columns>>({});
  const inputRef = React.useRef<HTMLInputElement>(null);

  function reset() {
    setBusy(null);
    setMediaId(null);
    setMapping(null);
    setColumns({});
  }

  async function finish(id: Id<"mediaFiles">, cols?: Columns) {
    setBusy("Reading the statement…");
    const res = await importStatement({ mediaId: id, ...(cols ? { mapping: cols } : {}) });
    if (res.kind === "needsMapping") {
      setMapping({ headers: res.headers, sample: res.sample });
      setBusy(null);
      return;
    }
    toast.success(
      `Statement imported: ${res.rows.toLocaleString()} rows became ${res.lines.toLocaleString()} songs${
        res.skippedRows ? ` (${res.skippedRows} rows had no amount or song)` : ""
      }.`,
    );
    reset();
    onOpenChange(false);
  }

  async function onFile(file: File) {
    try {
      setBusy("Uploading…");
      const prep = await prepare({ fileName: file.name, mimeType: file.type || "text/csv", size: file.size });
      await putToR2(file, prep);
      const id = prep.mediaId as Id<"mediaFiles">;
      await confirm({ mediaId: id });
      setMediaId(id);
      await finish(id);
    } catch (err) {
      toast.error(errorMessage(err, "Could not import that statement."));
      reset();
    }
  }

  async function submitMapping() {
    if (!mediaId || !columns.amount) return;
    try {
      await finish(mediaId, columns as Columns);
    } catch (err) {
      toast.error(errorMessage(err, "Could not import with that mapping."));
      setBusy(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{mapping ? "Which column is which?" : "Upload a royalty statement"}</DialogTitle>
          <DialogDescription>
            {mapping
              ? "Pulse didn't recognise this layout. Pick the columns once and every later file with the same headers imports on its own."
              : "A CSV export from DistroKid, TuneCore, CD Baby or any distributor, up to 20 MB. Earnings are matched to your songs by ISRC."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {busy ? (
            <div className="flex items-center gap-3 py-6 text-sm text-steel" aria-live="polite">
              <Spinner />
              {busy}
            </div>
          ) : mapping ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {FIELDS.map((f) => (
                  <Field key={f.key} label={f.required ? `${f.label} (required)` : f.label}>
                    <Select
                      value={columns[f.key] ?? NONE}
                      onValueChange={(val) => setColumns((c) => ({ ...c, [f.key]: val === NONE ? undefined : val }))}
                    >
                      <SelectTrigger aria-label={f.label}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {!f.required && <SelectItem value={NONE}>Not in this file</SelectItem>}
                        {mapping.headers.map((h) => (
                          <SelectItem key={h} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ))}
              </div>
              {mapping.sample.length > 0 && (
                <div className="overflow-x-auto rounded-md border border-graphite/50">
                  <table className="w-full text-left text-[0.6875rem]">
                    <thead className="bg-coal-2 text-steel">
                      <tr>
                        {mapping.headers.slice(0, 8).map((h) => (
                          <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="text-mist/80">
                      {mapping.sample.slice(0, 3).map((row, i) => (
                        <tr key={i} className="border-t border-graphite/40">
                          {row.slice(0, 8).map((c, j) => (
                            <td key={j} className="whitespace-nowrap px-2 py-1.5">
                              {c}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!columns.isrc && !columns.title && (
                <p className="text-xs text-caution">Pick the ISRC or the song title so earnings can be matched to songs.</p>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-graphite bg-coal px-4 py-10 text-sm text-steel transition-colors hover:border-gold-dim hover:text-bone"
            >
              <FileUp className="size-6" />
              Choose a CSV or TSV file
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onFile(f);
            }}
          />
        </DialogBody>
        {mapping && !busy && (
          <DialogFooter>
            <Button variant="ghost" onClick={reset}>
              Start over
            </Button>
            <Button onClick={() => void submitMapping()} disabled={!columns.amount || (!columns.isrc && !columns.title)}>
              Import
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
