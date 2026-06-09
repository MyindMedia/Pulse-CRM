"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, Plus, Search } from "lucide-react";
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
import { money } from "@/lib/format";
import {
  SOFTWARE_CATEGORIES,
  LICENSE_TYPES,
  BILLING_INTERVALS,
  type SoftwareCategory,
  type SoftwareLicenseType,
  type BillingInterval,
  type SoftwareStatus,
} from "./constants";

export type EditableSoftware = {
  _id: Id<"softwareLicenses">;
  name: string;
  vendor?: string;
  category: string;
  licenseType: string;
  seats?: number;
  costCents: number;
  billingInterval: string;
  renewalDate?: number;
  licenseKey?: string;
  seatHolder?: string;
  status: string;
  notes?: string;
};

type FormState = {
  name: string;
  vendor: string;
  category: SoftwareCategory;
  licenseType: SoftwareLicenseType;
  billingInterval: BillingInterval;
  cost: string;
  seats: string;
  renewal: string; // yyyy-mm-dd
  licenseKey: string;
  seatHolder: string;
  status: SoftwareStatus;
  notes: string;
};

const BLANK: FormState = {
  name: "", vendor: "", category: "plugin", licenseType: "perpetual",
  billingInterval: "one_time", cost: "", seats: "", renewal: "",
  licenseKey: "", seatHolder: "", status: "active", notes: "",
};

function toForm(s: EditableSoftware): FormState {
  return {
    name: s.name,
    vendor: s.vendor ?? "",
    category: s.category as SoftwareCategory,
    licenseType: s.licenseType as SoftwareLicenseType,
    billingInterval: s.billingInterval as BillingInterval,
    cost: (s.costCents / 100).toString(),
    seats: s.seats != null ? String(s.seats) : "",
    renewal: s.renewalDate ? new Date(s.renewalDate).toISOString().slice(0, 10) : "",
    licenseKey: s.licenseKey ?? "",
    seatHolder: s.seatHolder ?? "",
    status: s.status as SoftwareStatus,
    notes: s.notes ?? "",
  };
}

function dollarsToCents(v: string): number {
  const n = parseFloat(v);
  return !v.trim() || !Number.isFinite(n) || n < 0 ? 0 : Math.round(n * 100);
}

export function SoftwareDialog({
  item,
  open,
  onOpenChange,
}: {
  item?: EditableSoftware;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const isEdit = item !== undefined;
  const create = useMutation(api.software.create);
  const update = useMutation(api.software.update);

  const [form, setForm] = React.useState<FormState>(item ? toForm(item) : BLANK);
  const [submitting, setSubmitting] = React.useState(false);
  const [catQ, setCatQ] = React.useState("");
  const [catOpen, setCatOpen] = React.useState(false);

  const results = useQuery(
    api.software.searchCatalog,
    !isEdit && catOpen ? { q: catQ, limit: catQ.trim() ? 20 : 300 } : "skip",
  ) as
    | { id: string; name: string; vendor: string; category: string; licenseType: string; billingInterval: string; priceCents: number; note?: string }[]
    | undefined;

  const grouped = React.useMemo(() => {
    const byCat = new Map<string, NonNullable<typeof results>>();
    for (const it of results ?? []) {
      const arr = byCat.get(it.category) ?? [];
      arr.push(it); byCat.set(it.category, arr);
    }
    return SOFTWARE_CATEGORIES
      .map((c) => ({ label: c.plural, items: byCat.get(c.value) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [results]);

  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) { setForm(item ? toForm(item) : BLANK); setCatQ(""); setCatOpen(false); }
  }

  function set<K extends keyof FormState>(k: K, val: FormState[K]) {
    setForm((p) => ({ ...p, [k]: val }));
  }

  function pick(it: NonNullable<typeof results>[number]) {
    setForm((p) => ({
      ...p,
      name: it.name,
      vendor: it.vendor,
      category: it.category as SoftwareCategory,
      licenseType: it.licenseType as SoftwareLicenseType,
      billingInterval: it.billingInterval as BillingInterval,
      cost: (it.priceCents / 100).toString(),
    }));
    setCatQ(it.name);
    setCatOpen(false);
  }

  function applyCustom() {
    const n = catQ.trim();
    if (!n) return;
    setForm((p) => ({ ...p, name: n }));
    setCatOpen(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) { toast.error("Give the software a name."); return; }
    setSubmitting(true);
    const payload = {
      name,
      vendor: form.vendor.trim() || undefined,
      category: form.category,
      licenseType: form.licenseType,
      seats: form.seats.trim() ? Math.max(0, parseInt(form.seats, 10) || 0) : undefined,
      costCents: dollarsToCents(form.cost),
      billingInterval: form.billingInterval,
      renewalDate: form.renewal ? new Date(`${form.renewal}T12:00:00`).getTime() : undefined,
      licenseKey: form.licenseKey.trim() || undefined,
      seatHolder: form.seatHolder.trim() || undefined,
      status: form.status,
      notes: form.notes.trim() || undefined,
    };
    try {
      if (isEdit && item) {
        await update({ id: item._id, ...payload });
        toast.success(`${name} updated.`);
      } else {
        await create(payload);
        toast.success(`${name} added.`);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit software" : "Add software"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? `Update the license details for ${item?.name}.`
              : "Track a DAW, plugin, sample library or subscription - cost, seats, renewal and license key."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="space-y-4">
            {!isEdit && (
              <Field label="Software catalog" hint="Pick to auto-fill, or add a custom item.">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel/70" />
                  <Input
                    value={catQ}
                    onChange={(e) => { setCatQ(e.target.value); setCatOpen(true); }}
                    onFocus={() => setCatOpen(true)}
                    onBlur={() => setTimeout(() => setCatOpen(false), 150)}
                    placeholder="Pro Tools, FabFilter, Splice…"
                    className="pl-9"
                    autoComplete="off"
                  />
                  {catOpen && (
                    <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-graphite/50 bg-coal-2 shadow-elev-3">
                      {catQ.trim().length >= 1 && (
                        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={applyCustom}
                          className="flex w-full items-center gap-2 border-b border-graphite/60 px-3 py-2 text-left hover:bg-hairline/40">
                          <Plus className="size-4 shrink-0 text-gold" />
                          <span className="truncate text-sm text-bone">Add <span className="text-gold">&ldquo;{catQ.trim()}&rdquo;</span> as custom</span>
                        </button>
                      )}
                      {results === undefined ? (
                        <p className="px-3 py-2 text-xs text-steel/70">Loading…</p>
                      ) : grouped.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-steel/70">No match — use the custom option.</p>
                      ) : (
                        grouped.map((g) => (
                          <div key={g.label}>
                            <p className="sticky top-0 z-10 bg-obsidian px-3 py-1 text-[0.625rem] font-semibold uppercase tracking-wide text-steel/70">{g.label}</p>
                            {g.items.map((it) => (
                              <button key={it.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(it)}
                                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-hairline/40">
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm text-bone">{it.name}</span>
                                  <span className="block truncate text-[0.6875rem] uppercase tracking-wide text-steel/70">{it.vendor}{it.note ? ` · ${it.note}` : ""}</span>
                                </span>
                                <span className="shrink-0 font-meta text-xs text-gold">{money(it.priceCents)}</span>
                              </button>
                            ))}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </Field>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="sw-name">
                <Input id="sw-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Pro Tools" required />
              </Field>
              <Field label="Vendor" htmlFor="sw-vendor">
                <Input id="sw-vendor" value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="Avid" />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category">
                <Select value={form.category} onValueChange={(v) => set("category", v as SoftwareCategory)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOFTWARE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="License type">
                <Select value={form.licenseType} onValueChange={(v) => set("licenseType", v as SoftwareLicenseType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LICENSE_TYPES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Cost" hint="USD">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-steel/70">$</span>
                  <Input type="number" min="0" step="0.01" inputMode="decimal" value={form.cost} onChange={(e) => set("cost", e.target.value)} placeholder="0.00" className="pl-7" />
                </div>
              </Field>
              <Field label="Billing">
                <Select value={form.billingInterval} onValueChange={(v) => set("billingInterval", v as BillingInterval)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BILLING_INTERVALS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Seats" htmlFor="sw-seats">
                <Input id="sw-seats" type="number" min="1" step="1" value={form.seats} onChange={(e) => set("seats", e.target.value)} placeholder="1" />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Renewal / expiry" htmlFor="sw-renewal" hint="Subscriptions">
                <Input id="sw-renewal" type="date" value={form.renewal} onChange={(e) => set("renewal", e.target.value)} className="font-meta" />
              </Field>
              <Field label="Status">
                <Select value={form.status} onValueChange={(v) => set("status", v as SoftwareStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                    <SelectItem value="unused">Unused</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="License key" htmlFor="sw-key" hint="Serial / auth code">
                <Input id="sw-key" value={form.licenseKey} onChange={(e) => set("licenseKey", e.target.value)} placeholder="Optional" autoComplete="off" />
              </Field>
              <Field label="Installed on" htmlFor="sw-holder" hint="Machine or person">
                <Input id="sw-holder" value={form.seatHolder} onChange={(e) => set("seatHolder", e.target.value)} placeholder="Studio A Mac…" />
              </Field>
            </div>

            <Field label="Notes" htmlFor="sw-notes">
              <Textarea id="sw-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder="Anything worth noting…" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {isEdit ? <Check className="size-4" /> : <Plus className="size-4" />}
              {submitting ? "Saving…" : isEdit ? "Save changes" : "Add software"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
