"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { errorMessage } from "@/lib/errors";

type DocType = "invoice" | "receipt" | "warranty" | "other";
const TYPE_LABEL: Record<DocType, string> = {
  invoice: "Invoice",
  receipt: "Receipt",
  warranty: "Warranty",
  other: "Other",
};

function fileSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Receipts / invoices / warranties attached to a hardware or software asset.
 * Kept for tax, insurance, and historical records. Upload (image or PDF),
 * tag the type, download, or remove. Only render for a saved item (needs refId).
 */
export function AssetDocuments({
  kind,
  refId,
}: {
  kind: "equipment" | "software";
  refId: string;
}) {
  const docs = useQuery(api.assetDocuments.list, { kind, refId });
  const generateUploadUrl = useMutation(api.assetDocuments.generateUploadUrl);
  const attach = useMutation(api.assetDocuments.attach);
  const remove = useMutation(api.assetDocuments.remove);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [docType, setDocType] = React.useState<DocType>("receipt");

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: string };
      await attach({
        kind,
        refId,
        storageId: storageId as Id<"_storage">,
        fileName: file.name,
        fileType: file.type,
        sizeBytes: file.size,
        docType,
      });
      toast.success("Document added.");
    } catch (e) {
      toast.error(errorMessage(e, "Could not upload the document."));
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove(id: Id<"assetDocuments">) {
    try {
      await remove({ id });
      toast.success("Document removed.");
    } catch (e) {
      toast.error(errorMessage(e, "Could not remove the document."));
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-steel">Receipts &amp; documents</p>
          <p className="text-[0.6875rem] text-steel/70">
            Purchase invoices, receipts &amp; warranties - for tax &amp; insurance records.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value as DocType)}
            className="rounded-md border border-graphite/60 bg-obsidian px-2 py-1.5 text-xs text-bone outline-none focus:border-gold-dim"
          >
            {(Object.keys(TYPE_LABEL) as DocType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {uploading ? "Uploading…" : "Add file"}
          </Button>
        </div>
      </div>

      {docs === undefined ? (
        <p className="rounded-md border border-graphite/50 px-3 py-3 text-xs text-steel/70">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="rounded-md border border-dashed border-graphite/50 px-3 py-4 text-center text-xs text-steel/70">
          No documents yet. Add the purchase invoice or receipt to keep a record.
        </p>
      ) : (
        <ul className="divide-y divide-hairline overflow-hidden rounded-md border border-graphite/50">
          {docs.map((d) => (
            <li key={d._id} className="flex items-center gap-2.5 px-2.5 py-2">
              <FileText className="size-4 shrink-0 text-steel/70" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-bone">{d.fileName}</p>
                <p className="flex items-center gap-1.5 text-[0.6875rem] text-steel/70">
                  <Badge tone="neutral">{TYPE_LABEL[(d.docType as DocType) ?? "receipt"]}</Badge>
                  <span>{new Date(d.uploadedAt).toLocaleDateString()}</span>
                  {d.sizeBytes ? <span>· {fileSize(d.sizeBytes)}</span> : null}
                </p>
              </div>
              {d.url && (
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Download ${d.fileName}`}
                  className="grid size-8 place-items-center rounded-md text-steel transition-colors hover:bg-coal-2 hover:text-bone"
                >
                  <Download className="size-3.5" />
                </a>
              )}
              <button
                type="button"
                onClick={() => void handleRemove(d._id)}
                aria-label={`Remove ${d.fileName}`}
                className="grid size-8 place-items-center rounded-md text-steel transition-colors hover:bg-critical/10 hover:text-critical"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void handleFile(f);
        }}
      />
    </div>
  );
}
