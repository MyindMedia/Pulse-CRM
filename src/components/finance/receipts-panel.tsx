"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { Upload, FileText, History, BookPlus, Trash2, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
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

/* Receipts - upload a photo or PDF, Pulse reads the vendor, date and total,
   then proposes the expense and bank line it belongs to
   (openspec add-bank-sync-receipts, finance/receipt-capture). */

type ReceiptRow = FunctionReturnType<typeof api.receipts.list>[number];
type Filter = "unmatched" | "needs_review" | "matched" | "all";

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,application/pdf";

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

export function ReceiptsPanel({ canEdit }: { canEdit: boolean }) {
  const [filter, setFilter] = React.useState<Filter>("unmatched");
  const rows = useQuery(api.receipts.list, { status: filter });
  const counts = useQuery(api.receipts.counts, {});
  const upload = useReceiptUpload();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading((n) => n + list.length);
    for (const f of list) {
      try {
        await upload(f);
        toast.success(`${f.name} uploaded. Reading it now.`);
      } catch (err) {
        toast.error(`${f.name}: ${errorMessage(err)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-grotesk text-lg text-bone">Receipts</h2>
        {counts && (
          <span className="font-meta text-[0.6875rem] text-steel/80">
            {counts.matched} matched · {counts.unmatched} waiting · {counts.needsReview} to check
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-1">
          {([
            ["unmatched", "Waiting"],
            ["needs_review", "To check"],
            ["matched", "Matched"],
            ["all", "All"],
          ] as const).map(([value, label]) => (
            <Button key={value} size="sm" variant={filter === value ? "primary" : "ghost"} onClick={() => setFilter(value)}>{label}</Button>
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
            <p className="text-xs text-steel/80">Photos or PDFs up to 10 MB. Pulse reads the vendor, date and total, then finds the match.</p>
          </div>
          <input ref={inputRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => { if (e.target.files) void handleFiles(e.target.files); e.target.value = ""; }} />
          <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={uploading > 0}>
            <Upload className="size-4" /> {uploading > 0 ? `Uploading ${uploading}…` : "Upload receipts"}
          </Button>
        </div>
      )}

      {rows === undefined ? (
        <p className="text-sm text-steel/70">Loading receipts…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-graphite/60 px-4 py-6 text-center text-sm text-steel/70">No receipts here.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => <ReceiptItem key={r._id} r={r} canEdit={canEdit} />)}
        </ul>
      )}
    </section>
  );
}

function ReceiptItem({ r, canEdit }: { r: ReceiptRow; canEdit: boolean }) {
  const [open, setOpen] = React.useState(r.status === "needs_review");
  const [creating, setCreating] = React.useState(false);
  const [history, setHistory] = React.useState(false);
  const remove = useMutation(api.receipts.remove);
  const unmatch = useMutation(api.reconcile.unmatch);
  const st = RECEIPT_STATUS[r.status] ?? RECEIPT_STATUS.ready;

  async function run(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); toast.success(ok); } catch (err) { toast.error(errorMessage(err)); }
  }

  return (
    <li className="rounded-lg border border-graphite/50 bg-coal/60">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <FileText className="size-4 shrink-0 text-steel" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-bone">{r.vendor ?? r.fileName}</p>
          <p className="font-meta text-[0.6875rem] text-steel/80">
            {r.date ? bankDay(r.date, true) : "no date"} · uploaded by {r.uploadedBy}
            {r.cardLast4 ? ` · card ••${r.cardLast4}` : ""}
          </p>
        </div>
        <span className="font-meta text-sm text-bone">{r.totalCents !== null ? money(r.totalCents) : "-"}</span>
        <Badge tone={st.tone} dot>{st.label}</Badge>
        {r.expense && <Badge tone="positive">In books</Badge>}
        {r.transaction && <Badge tone="info">Bank matched</Badge>}
        <Button size="icon" variant="ghost" aria-label={open ? "Hide receipt" : "Show receipt"} onClick={() => setOpen(!open)}>
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </Button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-graphite/40 px-4 py-3">
          {r.error && <p className="text-xs text-caution">{r.error}</p>}
          {canEdit && r.status !== "reading" && r.status !== "failed" && (
            <ReceiptEditor key={`${r.vendor}|${r.date}|${r.totalCents}`} r={r} />
          )}
          <div className="flex flex-wrap gap-2">
            {r.url && (
              <Button size="sm" variant="ghost" asChild>
                <a href={r.url} target="_blank" rel="noreferrer"><ExternalLink className="size-3.5" /> View file</a>
              </Button>
            )}
            {canEdit && !r.expense && r.totalCents !== null && r.date !== null && (
              <Button size="sm" onClick={() => setCreating(true)}><BookPlus className="size-3.5" /> Create expense</Button>
            )}
            {canEdit && r.expense && (
              <Button size="sm" variant="ghost" onClick={() => run(() => unmatch({ a: { kind: "receipt", id: r._id }, b: { kind: "expense", id: r.expense!._id } }), "Receipt unmatched from the expense.")}>Undo expense match</Button>
            )}
            {canEdit && r.transaction && (
              <Button size="sm" variant="ghost" onClick={() => run(() => unmatch({ a: { kind: "receipt", id: r._id }, b: { kind: "transaction", id: r.transaction!._id } }), "Receipt unmatched from the bank line.")}>Undo bank match</Button>
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
          {r.status === "ready" && (!r.expense || !r.transaction) && <MatchSuggestions kind="receipt" id={r._id} canEdit={canEdit} />}
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
