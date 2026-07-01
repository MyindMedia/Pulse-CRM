"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, Package } from "lucide-react";
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
import { money } from "@/lib/format";

export type PackageTarget = {
  _id: Id<"packageProducts">;
  name: string;
  hours: number;
  priceCents: number;
  description?: string | null;
  active: boolean;
};

/** Dollars string -> integer cents (> 0), or null when blank/invalid. */
function dollarsToCents(value: string): number | null {
  const n = parseFloat(value);
  if (!value.trim() || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/**
 * Create or edit a prepaid package product (a block of studio hours sold up
 * front). Shows the implied per-hour rate so the studio can price the discount.
 */
export function ProductDialog({
  product,
  open,
  onOpenChange,
}: {
  product: PackageTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useMutation(api.packages.create);
  const update = useMutation(api.packages.update);
  const editing = product !== null;

  const [name, setName] = React.useState("");
  const [hours, setHours] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // Reset the form whenever the dialog opens for a different target (the
  // codebase's derived-on-change pattern, not a setState-in-effect).
  const [prevKey, setPrevKey] = React.useState<string | null>(null);
  const openKey = open ? (product?._id ?? "new") : null;
  if (prevKey !== openKey) {
    setPrevKey(openKey);
    if (open) {
      setName(product?.name ?? "");
      setHours(product ? String(product.hours) : "");
      setPrice(product ? (product.priceCents / 100).toString() : "");
      setDescription(product?.description ?? "");
    }
  }

  const hoursNum = parseFloat(hours);
  const cents = dollarsToCents(price);
  const perHour =
    cents !== null && Number.isFinite(hoursNum) && hoursNum > 0
      ? Math.round(cents / hoursNum)
      : null;

  async function submit() {
    const cleanName = name.trim();
    if (!cleanName) {
      toast.error("Give the package a name.");
      return;
    }
    if (!Number.isFinite(hoursNum) || hoursNum <= 0) {
      toast.error("Hours must be positive.");
      return;
    }
    if (cents === null) {
      toast.error("Enter a price (more than $0).");
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await update({
          id: product._id,
          name: cleanName,
          hours: hoursNum,
          priceCents: cents,
          description: description.trim() || undefined,
        });
        toast.success("Package updated.");
      } else {
        await create({
          name: cleanName,
          hours: hoursNum,
          priceCents: cents,
          description: description.trim() || undefined,
        });
        toast.success("Package created.");
      }
      onOpenChange(false);
    } catch {
      toast.error("Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <Package className="size-4 text-gold" />
            {editing ? "Edit package" : "New package"}
          </DialogTitle>
          <DialogDescription>
            A prepaid block of studio hours. The client buys it up front; hours
            draw down on future sessions.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="10-hour block"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hours">
              <Input
                type="number"
                min={0}
                step="0.5"
                inputMode="decimal"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="10"
              />
            </Field>
            <Field label="Price">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-steel">$</span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="850"
                />
              </div>
            </Field>
          </div>
          {perHour !== null && (
            <p className="text-xs text-steel/70">
              Works out to{" "}
              <span className="font-meta font-semibold text-gold-bright">
                {money(perHour)}
              </span>{" "}
              per hour.
            </p>
          )}
          <Field label="Description">
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Save 15% vs the hourly rate. Great for a full project."
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            <Check className="size-4" />
            {editing ? "Save package" : "Create package"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
