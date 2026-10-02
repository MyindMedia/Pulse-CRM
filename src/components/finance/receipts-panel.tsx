"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { Upload, History, BookPlus, Trash2, Maximize2, ChevronDown, ChevronUp, Paperclip, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Field } from "@/components/ui/field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { money } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { EXPENSE_CATEGORIES } from "@/components/expenses/expense-dialog";
import { FinanceHistorySheet } from "./finance-history-sheet";
import { MatchSuggestions } from "./match-suggestions";
import { RECEIPT_STATUS, bankDay, dayFromInput, dayInputValue } from "./finance-labels";
import { ReceiptThumb, ReceiptViewer, type ReceiptFile } from "./receipt-viewer";
import { island } from "@/components/shell/dynamic-island";

/* Receipts - upload a photo or PDF, Pulse reads the vendor, date and total,
   then matches the expense and bank line or highlights what needs attention
   (openspec add-bank-sync-receipts, finance/receipt-capture). */

type ReceiptRow = FunctionReturnType<typeof api.receipts.list>[number];
type Filter = "needs_attention" | "processing" | "reconciled" | "all";

export const RECEIPT_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,application/pdf";

export function useReceiptUpload() {
  const generateUploadUrl = useMutation(api.receipts.generateUploadUrl);
  const attach = useMutation(api.receipts.attach);
  return React.useCallback(async (file: File, expenseId?: Id<"expenses">) => {
    const url = await generateUploadUrl({});
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
    if (!res.ok) throw new Error("The upload didn't go through. Try again.");
    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
    const out = await attach({ storageId, fileName: file.name, expenseId });
    if (!out.ok) throw new Error(out.message);
    return out.receiptId;
  }, [generateUploadUrl, attach]);
}

/** A local preview of a picked file, for the moments before the server has it. */
export function localPreview(file: File) {
  return file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
}

/** Previews are shown by the island notice too, so they outlive the upload a little. */
export function releasePreview(url: string | null) {
  if (url) setTimeout(() => URL.revokeObjectURL(url), 15_000);
}

/**
 * Upload with a live notice in the Dynamic Island: the receipt's picture and
 * "Uploading", morphing into "Attached" (or what went wrong) when it lands.
 */
export async function uploadReceiptWithNotice(
  upload: ReturnType<typeof useReceiptUpload>,
  file: File,
  opts: { preview: string | null; expenseId?: Id<"expenses">; expenseLabel?: string },
) {
  const id = island.show({
    title: "Uploading receipt",
    message: opts.expenseLabel ?? file.name,
    image: opts.preview ?? undefined,
    loading: true,
  });
  try {
    await upload(file, opts.expenseId);
    island.update(id, {
      title: opts.expenseId ? "Receipt attached" : "Receipt uploaded",
      message: opts.expenseId
        ? `${opts.expenseLabel ?? "Expense"} · reading it now`
        : "Reading and matching it automatically",
      icon: Paperclip,
      tone: "positive",
      loading: false,
      duration: 3200,
    });
    return true;
  } catch (err) {
    island.update(id, {
      title: "Upload didn't go through",
      message: `${file.name}: ${errorMessage(err)}`,
      icon: TriangleAlert,
      image: undefined,
      tone: "critical",
      loading: false,
      duration: 6000,
    });
    return false;
  }
}

function receiptFile(r: ReceiptRow): ReceiptFile | null {
  if (!r.url) return null;
  const details = [r.date ? bankDay(r.date, true) : null, r.totalCents !== null ? money(r.totalCents) : null].filter(Boolean);
  return { url: r.url, fileType: r.fileType, title: r.vendor ?? r.fileName, subtitle: details.length ? details.join(" · ") : r.fileName };
}

type Pending = { key: string; name: string; type: string; preview: string | null };

export function ReceiptsPanel({ canEdit }: { canEdit: boolean }) {
  const [filter, setFilter] = React.useState<Filter>("needs_attention");
  const rows = useQuery(api.receipts.list, { status: filter });
  const counts = useQuery(api.receipts.counts, {});
  const upload = useReceiptUpload();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, setPending] = React.useState<Pending[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const [viewing, setViewing] = React.useState<ReceiptFile | null>(null);
  const uploading = pending.length;

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setFilter("all");
    const batch = list.map((file, i) => ({ file, key: `${Date.now()}-${i}-${file.name}`, name: file.name, type: file.type, preview: localPreview(file) }));
    setPending((p) => [...p, ...batch.map(({ key, name, type, preview }) => ({ key, name, type, preview }))]);
    for (const item of batch) {
      await uploadReceiptWithNotice(upload, item.file, { preview: item.preview });
      setPending((p) => p.filter((x) => x.key !== item.key));
      releasePreview(item.preview);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-grotesk text-lg text-bone">Receipts</h2>
        {counts && (
          <span className="font-meta text-[0.6875rem] text-steel/80">
            {counts.fullyMatched} matched · {counts.processing} processing · {counts.needsAttention} need attention
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-1">
          {([
            ["needs_attention", "Needs attention"],
            ["processing", "Processing"],
            ["reconciled", "Matched"],
            ["all", "All"],
          ] as const).map(([value, label]) => (
            <Button key={value} size="sm" variant={filter === value ? "primary" : "ghost"} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</Button>
          ))}
        </div>
      </div>

      {canEdit && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFiles(e.dataTransfer.files); }}
          className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-4 ${dragging ? "border-gold bg-gold/5" : "border-graphite/60 bg-coal/40"}`}
        >
          <div>
            <p className="text-sm text-bone">Drop receipts here</p>
            <p className="text-xs text-steel/80">Photos or PDFs up to 10 MB. Pulse fills in the details and matches expenses and bank transactions in this studio automatically. Anything uncertain appears in Needs attention. The original file stays with the expense.</p>
          </div>
          <input ref={inputRef} type="file" accept={RECEIPT_ACCEPT} multiple className="hidden" onChange={(e) => { if (e.target.files) void handleFiles(e.target.files); e.target.value = ""; }} />
          <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={uploading > 0}>
            <Upload className="size-4" /> {uploading > 0 ? `Uploading ${uploading}…` : "Upload receipts"}
          </Button>
        </div>
      )}

      {pending.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Receipts uploading">
          {pending.map((p) => (
            <li key={p.key} className="anim-rise flex items-center gap-2 rounded-lg border border-graphite/50 bg-coal/60 py-1.5 pl-1.5 pr-3">
              <ReceiptThumb url={p.preview} fileType={p.type} label={p.name} status="uploading" />
              <span className="max-w-40 truncate text-xs text-bone">{p.name}</span>
            </li>
          ))}
        </ul>
      )}

      {rows === undefined ? (
        <p className="text-sm text-steel/70">Loading receipts…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-graphite/60 px-4 py-6 text-center text-sm text-steel/70">{filter === "needs_attention" ? "No receipts need attention. New uploads are read and matched automatically." : filter === "processing" ? "No receipts are processing." : filter === "reconciled" ? "No receipts are fully matched yet." : "No receipts uploaded yet."}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => <ReceiptItem key={r._id} r={r} canEdit={canEdit} onView={setViewing} />)}
        </ul>
      )}
      <ReceiptViewer file={viewing} onOpenChange={(o) => { if (!o) setViewing(null); }} />
    </section>
  );
}

function ReceiptItem({ r, canEdit, onView }: { r: ReceiptRow; canEdit: boolean; onView: (file: ReceiptFile) => void }) {
  const [open, setOpen] = React.useState(r.status === "needs_review");
  const [creating, setCreating] = React.useState(false);
  const [history, setHistory] = React.useState(false);
  const remove = useMutation(api.receipts.remove);
  const unmatch = useMutation(api.reconcile.unmatch);
  const processing = r.status === "reading" || r.matchingPending;
  const file = receiptFile(r);
  const st = processing
    ? { label: r.status === "reading" ? "Reading" : "Matching", tone: "info" as const }
    : r.needsAttention
      ? { label: r.status === "ready" ? "Needs attention" : RECEIPT_STATUS[r.status]?.label ?? "Needs attention", tone: r.status === "failed" ? "critical" as const : "caution" as const }
      : { label: "Matched", tone: "positive" as const };

  async function run(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); toast.success(ok); } catch (err) { toast.error(errorMessage(err)); }
  }

  return (
    <li className={`rounded-lg border bg-coal/60 ${r.needsAttention ? "border-caution/50" : "border-graphite/50"}`}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <ReceiptThumb
          url={r.url}
          fileType={r.fileType}
          label={r.vendor ?? r.fileName}
          status={r.expense ? "attached" : "plain"}
          onOpen={file ? () => onView(file) : undefined}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-bone">{r.vendor ?? r.fileName}</p>
          <p className="font-meta text-[0.6875rem] text-steel/80">
            {r.date ? bankDay(r.date, true) : "no date"} · uploaded by {r.uploadedBy}
            {r.cardLast4 ? ` · card ••${r.cardLast4}` : ""}
          </p>
          {r.needsAttention && r.attentionReason && <p className="mt-1 text-xs text-caution">{r.attentionReason}</p>}
          {processing && <p className="mt-1 text-xs text-steel">Reading and matching automatically. You can leave this page.</p>}
        </div>
        <span className="font-meta text-sm text-bone">{r.totalCents !== null ? money(r.totalCents) : "-"}</span>
        <Badge tone={st.tone} dot>{st.label}</Badge>
        {r.expense && <Badge tone="positive">In books</Badge>}
        {r.transaction && <Badge tone="info">Bank matched</Badge>}
        <Button size="icon" variant="ghost" aria-label={open ? "Hide receipt" : "Show receipt"} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </Button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-graphite/40 px-4 py-3">
          {r.error && <p className="text-xs text-caution">{r.error}</p>}
          {canEdit && !processing && r.status !== "failed" && (
            <ReceiptEditor key={`${r.vendor}|${r.date}|${r.totalCents}`} r={r} />
          )}
          <div className="flex flex-wrap gap-2">
            {file && (
              <Button size="sm" variant="ghost" onClick={() => onView(file)}><Maximize2 className="size-3.5" /> View receipt</Button>
            )}
            {canEdit && !processing && !r.expense && r.totalCents !== null && r.date !== null && (
              <Button size="sm" onClick={() => setCreating(true)}><BookPlus className="size-3.5" /> Create expense</Button>
            )}
            {canEdit && r.expense && (
              <Button size="sm" variant="ghost" disabled={processing} onClick={() => run(() => unmatch({ a: { kind: "receipt", id: r._id }, b: { kind: "expense", id: r.expense!._id } }), "Receipt unmatched from the expense.")}>Undo expense match</Button>
            )}
            {canEdit && r.transaction && (
              <Button size="sm" variant="ghost" disabled={processing} onClick={() => run(() => unmatch({ a: { kind: "receipt", id: r._id }, b: { kind: "transaction", id: r.transaction!._id } }), "Receipt unmatched from the bank line.")}>Undo bank match</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setHistory(true)}><History className="size-3.5" /> History</Button>
            {canEdit && (
              <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Delete ${r.fileName}? The file is removed; the history keeps a record.`)) void run(() => remove({ id: r._id }), "Receipt deleted."); }}>
                <Trash2 className="size-3.5" /> Delete
              </Button>
            )}
          </div>
          {r.expense && <p className="text-xs text-steel">Expense: {r.expense.vendor ?? r.expense.category}, {money(r.expense.amountCents)}</p>}
          {r.transaction && <p className="text-xs text-steel">Bank line: {r.transaction.name}, {money(r.transaction.amountCents)} on {bankDay(r.transaction.date)}</p>}
          {r.status === "ready" && !processing && (!r.expense || !r.transaction) && <MatchSuggestions kind="receipt" id={r._id} canEdit={canEdit} />}
        </div>
      )}

      <CreateExpenseDialog receipt={creating ? r : null} onClose={() => setCreating(false)} />
      <FinanceHistorySheet open={history} onOpenChange={setHistory} title={`${r.vendor ?? r.fileName}`} receiptId={r._id} />
    </li>
  );
}

function ReceiptEditor({ r }: { r: ReceiptRow }) {
  const update = useMutation(api.receipts.update);
  const initialTotal = r.totalCents !== null ? (r.totalCents / 100).toFixed(2) : "";
  const [vendor, setVendor] = React.useState(r.vendor ?? "");
  const [date, setDate] = React.useState(dayInputValue(r.date));
  const [total, setTotal] = React.useState(initialTotal);
  const [saving, setSaving] = React.useState(false);
  const dirty = vendor !== (r.vendor ?? "") || date !== dayInputValue(r.date) || total !== initialTotal;
  const badTotal = total.trim() !== "" && (Number.isNaN(Number(total)) || Number(total) < 0);

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Vendor" htmlFor={`v-${r._id}`} className="sm:col-span-2">
          <Input id={`v-${r._id}`} value={vendor} onChange={(e) => setVendor(e.target.value)} />
        </Field>
        <Field label="Date" htmlFor={`d-${r._id}`}>
          <Input id={`d-${r._id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="font-meta" />
        </Field>
        <Field label="Total" htmlFor={`t-${r._id}`}>
          <Input id={`t-${r._id}`} inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} className="font-meta" />
        </Field>
      </div>
      {dirty && (
        <Button size="sm" disabled={saving || badTotal} onClick={async () => {
          setSaving(true);
          try {
            await update({
              id: r._id,
              vendor: vendor.trim(),
              date: dayFromInput(date),
              totalCents: total.trim() ? Math.round(Number(total) * 100) : undefined,
            });
            toast.success("Receipt saved.");
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setSaving(false);
          }
        }}>
          Save details
        </Button>
      )}
    </div>
  );
}

function CreateExpenseDialog({ receipt, onClose }: { receipt: ReceiptRow | null; onClose: () => void }) {
  const createExpense = useMutation(api.receipts.createExpense);
  const [category, setCategory] = React.useState("supplies");
  const [saving, setSaving] = React.useState(false);
  return (
    <Dialog open={receipt !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Create expense from receipt</DialogTitle>
          <DialogDescription>
            {receipt ? `${receipt.vendor ?? receipt.fileName}, ${receipt.totalCents !== null ? money(receipt.totalCents) : ""}${receipt.date ? ` on ${bankDay(receipt.date, true)}` : ""}. The receipt is attached to the expense.` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field label="Category" htmlFor="rc-category">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="rc-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !receipt} onClick={async () => {
            if (!receipt) return;
            setSaving(true);
            try {
              await createExpense({ id: receipt._id, category: category as never });
              toast.success("Expense created.");
              onClose();
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setSaving(false);
            }
          }}>Create expense</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
