"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, Plus } from "lucide-react";
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
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export const EXPENSE_CATEGORIES = [
  { value: "rent", label: "Rent" },
  { value: "utilities", label: "Utilities" },
  { value: "software", label: "Software" },
  { value: "gear", label: "Gear" },
  { value: "repairs", label: "Repairs" },
  { value: "payroll", label: "Payroll" },
  { value: "contractor", label: "Contractor / engineer payout" },
  { value: "marketing", label: "Marketing" },
  { value: "supplies", label: "Supplies" },
  { value: "insurance", label: "Insurance" },
  { value: "adjustment", label: "P&L adjustment" },
  { value: "travel", label: "Travel" },
  { value: "fees", label: "Fees" },
  { value: "other", label: "Other" },
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["value"];

export type EditableExpense = {
  _id: Id<"expenses">;
  category: string;
  amountCents: number;
  date: number;
  vendor?: string;
  description?: string;
  recurring?: "monthly" | "annual";
  notes?: string;
};

type FormState = {
  category: ExpenseCategory;
  amount: string;
  date: string; // yyyy-mm-dd
  vendor: string;
  description: string;
  recurring: "none" | "monthly" | "annual";
  notes: string;
};

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function blank(): FormState {
  return { category: "other", amount: "", date: todayYmd(), vendor: "", description: "", recurring: "none", notes: "" };
}

function toForm(e: EditableExpense): FormState {
  return {
    category: e.category as ExpenseCategory,
    amount: (e.amountCents / 100).toString(),
    date: new Date(e.date).toISOString().slice(0, 10),
    vendor: e.vendor ?? "",
    description: e.description ?? "",
    recurring: e.recurring ?? "none",
    notes: e.notes ?? "",
  };
}

function dollarsToCents(v: string): number {
  const n = parseFloat(v);
  return !v.trim() || !Number.isFinite(n) || n < 0 ? 0 : Math.round(n * 100);
}

export function ExpenseDialog({
  item,
  open,
  onOpenChange,
}: {
  item?: EditableExpense;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const isEdit = item !== undefined;
  const create = useMutation(api.expenses.create);
  const update = useMutation(api.expenses.update);

  const [form, setForm] = React.useState<FormState>(item ? toForm(item) : blank());
  const [submitting, setSubmitting] = React.useState(false);

  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) setForm(item ? toForm(item) : blank());
  }

  function set<K extends keyof FormState>(k: K, val: FormState[K]) {
    setForm((p) => ({ ...p, [k]: val }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = dollarsToCents(form.amount);
    if (amountCents <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    setSubmitting(true);
    const date = form.date ? new Date(`${form.date}T12:00:00`).getTime() : Date.now();
    const recurring = form.recurring === "none" ? undefined : form.recurring;
    try {
      if (isEdit && item) {
        await update({
          id: item._id,
          category: form.category,
          amountCents,
          date,
          vendor: form.vendor.trim() || undefined,
          description: form.description.trim() || undefined,
          recurring: recurring ?? null,
          notes: form.notes.trim() || undefined,
        });
        toast.success("Expense updated.");
      } else {
        await create({
          category: form.category,
          amountCents,
          date,
          vendor: form.vendor.trim() || undefined,
          description: form.description.trim() || undefined,
          recurring,
          notes: form.notes.trim() || undefined,
        });
        toast.success("Expense logged.");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the expense.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit expense" : "Log an expense"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this cost."
              : "Record money out - rent, utilities, gear, repairs, a contractor payout. It flows straight into your P&L."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category">
                <Select value={form.category} onValueChange={(v) => set("category", v as ExpenseCategory)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Amount" hint="USD">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-steel/70">$</span>
                  <Input type="number" min="0" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" className="pl-7" required />
                </div>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date" htmlFor="ex-date">
                <Input id="ex-date" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className="font-meta" />
              </Field>
              <Field label="Recurring" hint="Fixed monthly / annual cost">
                <Select value={form.recurring} onValueChange={(v) => set("recurring", v as FormState["recurring"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">One-off</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="annual">Annual</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Vendor / paid to" htmlFor="ex-vendor">
                <Input id="ex-vendor" value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="Landlord, Power Co, engineer…" />
              </Field>
              <Field label="Description" htmlFor="ex-desc">
                <Input id="ex-desc" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What was it for" />
              </Field>
            </div>

            <Field label="Notes" htmlFor="ex-notes">
              <Textarea id="ex-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder="Anything worth noting…" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {isEdit ? <Check className="size-4" /> : <Plus className="size-4" />}
              {submitting ? "Saving…" : isEdit ? "Save changes" : "Log expense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
