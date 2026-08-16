"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Trash2 } from "lucide-react";
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
import { Field, Input, Textarea } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CONNECTORS, connectorMeta } from "./constants";
import { CableColorField } from "./cable-color-field";
import { errorMessage } from "@/lib/errors";

type StockItem = {
  _id: Id<"equipment">;
  name: string;
  spec: {
    connectorA: string;
    connectorB: string;
    channels: number;
    lengthFt?: number;
    color?: string;
  } | null;
  quantity: number;
  purchaseCents: number;
  currentValueCents: number;
  condition: string | null;
  notes: string | null;
  status: string;
  inUse: number;
};

const BLANK = {
  name: "",
  connectorA: "xlr",
  connectorB: "xlr",
  channels: "1",
  lengthFt: "25",
  color: "black",
  quantity: "6",
  price: "25",
  value: "",
  condition: "",
  notes: "",
  status: "available",
};

/**
 * Add or edit cable stock. One dialog for both, because a cable row you
 * can create but not correct is a row that goes stale the first time
 * someone cuts one down or loses two.
 *
 * Carries both money fields the rest of inventory carries: what it cost
 * and what it is worth now. Cables depreciate hard and get damaged, and a
 * locker valued at purchase price overstates the asset register.
 */
export function CableStockDialog({
  open,
  onOpenChange,
  editId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to add a new row. */
  editId?: Id<"equipment"> | null;
}) {
  const existing = useQuery(
    api.patchCables.stockItem,
    editId ? { id: editId } : "skip",
  ) as StockItem | null | undefined;

  const createStock = useMutation(api.patchCables.createStock);
  const updateStock = useMutation(api.patchCables.updateStock);
  const removeItem = useMutation(api.equipment.remove);

  const [form, setForm] = React.useState(BLANK);
  const [saving, setSaving] = React.useState(false);

  // Seed the form when the dialog opens, or when a different row loads.
  const [seed, setSeed] = React.useState<string | null>(null);
  const key = open ? `${editId ?? "new"}:${existing?._id ?? ""}` : null;
  if (key !== seed) {
    setSeed(key);
    if (!open) {
      // leave the form alone while closing
    } else if (editId && existing) {
      setForm({
        name: existing.name,
        connectorA: existing.spec?.connectorA ?? "xlr",
        connectorB: existing.spec?.connectorB ?? "xlr",
        channels: String(existing.spec?.channels ?? 1),
        lengthFt: existing.spec?.lengthFt != null ? String(existing.spec.lengthFt) : "",
        color: existing.spec?.color ?? "black",
        quantity: String(existing.quantity),
        price: (existing.purchaseCents / 100).toString(),
        value: (existing.currentValueCents / 100).toString(),
        condition: existing.condition ?? "",
        notes: existing.notes ?? "",
        status: existing.status,
      });
    } else if (!editId) {
      setForm(BLANK);
    }
  }

  const suggested = `${connectorMeta(form.connectorA).short}${
    form.connectorA === form.connectorB ? "" : ` to ${connectorMeta(form.connectorB).short}`
  }${form.lengthFt ? ` ${form.lengthFt}ft` : ""}`;

  const priceCents = Math.round((Number(form.price) || 0) * 100);
  // Value defaults to price, so the common case is one number not two.
  const valueCents = form.value === "" ? priceCents : Math.round((Number(form.value) || 0) * 100);

  async function submit() {
    setSaving(true);
    try {
      if (editId) {
        await updateStock({
          id: editId,
          name: form.name.trim() || suggested,
          connectorA: form.connectorA as never,
          connectorB: form.connectorB as never,
          channels: Math.max(1, Number(form.channels) || 1),
          lengthFt: form.lengthFt ? Number(form.lengthFt) : undefined,
          color: form.color,
          quantity: Math.max(1, Number(form.quantity) || 1),
          purchaseCents: priceCents,
          currentValueCents: valueCents,
          condition: form.condition.trim() || undefined,
          notes: form.notes.trim() || undefined,
          status: form.status as never,
        });
        toast.success("Cable stock updated.");
      } else {
        await createStock({
          name: form.name.trim() || suggested,
          quantity: Math.max(1, Number(form.quantity) || 1),
          purchaseCents: priceCents,
          currentValueCents: valueCents,
          connectorA: form.connectorA as never,
          connectorB: form.connectorB as never,
          channels: Math.max(1, Number(form.channels) || 1),
          lengthFt: form.lengthFt ? Number(form.lengthFt) : undefined,
          color: form.color,
          condition: form.condition.trim() || undefined,
          notes: form.notes.trim() || undefined,
        });
        toast.success("Cable stock added to inventory.");
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error, "Could not save that."));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editId) return;
    if (!window.confirm(`Delete ${form.name || "this cable"} from inventory?`)) return;
    try {
      await removeItem({ id: editId });
      toast.success("Removed from inventory.");
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error, "Could not delete that."));
    }
  }

  const loading = !!editId && existing === undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{editId ? "Edit cable stock" : "Add cable stock"}</DialogTitle>
          <DialogDescription>
            Cables are inventory, so this row carries what it cost and what it is worth now.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              {editId && existing && existing.inUse > 0 && (
                <p className="rounded-md border border-hairline-2 bg-coal-2/50 px-2.5 py-1.5 text-[11px] text-steel">
                  {existing.inUse} of these {existing.inUse === 1 ? "is" : "are"} patched right
                  now. The count cannot drop below that.
                </p>
              )}

              <Field label="Name" hint={`Leave blank to use "${suggested}"`}>
                <Input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder={suggested}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="End A">
                  <Select
                    value={form.connectorA}
                    onValueChange={(value) => setForm({ ...form, connectorA: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONNECTORS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="End B">
                  <Select
                    value={form.connectorB}
                    onValueChange={(value) => setForm({ ...form, connectorB: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONNECTORS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Length (ft)">
                  <Input
                    type="number"
                    min={0}
                    value={form.lengthFt}
                    onChange={(event) => setForm({ ...form, lengthFt: event.target.value })}
                  />
                </Field>
                <Field label="Channels" hint="8 for a DB25 fan.">
                  <Input
                    type="number"
                    min={1}
                    value={form.channels}
                    onChange={(event) => setForm({ ...form, channels: event.target.value })}
                  />
                </Field>
                <Field label="How many">
                  <Input
                    type="number"
                    min={1}
                    value={form.quantity}
                    onChange={(event) => setForm({ ...form, quantity: event.target.value })}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Purchase price each">
                  <Input
                    type="number"
                    min={0}
                    value={form.price}
                    onChange={(event) => setForm({ ...form, price: event.target.value })}
                  />
                </Field>
                <Field label="Current value each" hint="Blank matches the purchase price.">
                  <Input
                    type="number"
                    min={0}
                    value={form.value}
                    placeholder={form.price || "0"}
                    onChange={(event) => setForm({ ...form, value: event.target.value })}
                  />
                </Field>
              </div>

              <Field label="Jacket colour">
                <CableColorField
                  value={form.color}
                  onChange={(color) => setForm({ ...form, color })}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Condition">
                  <Input
                    value={form.condition}
                    onChange={(event) => setForm({ ...form, condition: event.target.value })}
                    placeholder="Two have intermittent shields"
                  />
                </Field>
                <Field label="Status">
                  <Select
                    value={form.status}
                    onValueChange={(value) => setForm({ ...form, status: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="available">Available</SelectItem>
                      <SelectItem value="in_use">In use</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                      <SelectItem value="retired">Retired</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field label="Notes">
                <Textarea
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  placeholder="Bought for the Neve rack. Keep them together."
                  className="min-h-16"
                />
              </Field>
            </>
          )}
        </DialogBody>

        <DialogFooter className="justify-between">
          {editId ? (
            <Button variant="danger" size="sm" onClick={remove} disabled={saving || loading}>
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          ) : (
            <span />
          )}
          <span className="flex items-center gap-2">
            {editId && existing && (
              <Badge tone="neutral">
                {existing.inUse} patched · {Math.max(0, existing.quantity - existing.inUse)} free
              </Badge>
            )}
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving || loading}>
              {saving ? "Saving" : editId ? "Save changes" : "Add to inventory"}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
