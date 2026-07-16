"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Banknote,
  CheckCircle2,
  Landmark,
  Smartphone,
  Sparkles,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ManualPaymentMethod } from "./types";

const METHODS: { value: ManualPaymentMethod; label: string; icon: LucideIcon }[] = [
  { value: "venmo", label: "Venmo", icon: Smartphone },
  { value: "cash", label: "Cash", icon: Banknote },
  { value: "cashapp", label: "Cash App", icon: Wallet },
  { value: "zelle", label: "Zelle", icon: Landmark },
  { value: "credit", label: "Credit", icon: Sparkles },
];

export type RecordPaymentTarget = {
  id: Id<"invoices">;
  number: string;
  amountCents: number;
};

/** Manual "record payment" flow: the payment type is REQUIRED so every
 * collected dollar is attributable by method. Picking Credit warns that a
 * matching P&L adjustment is posted (credit is not cash in). */
export function RecordPaymentDialog({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: RecordPaymentTarget | null;
}) {
  const setStatus = useMutation(api.invoices.setStatus);
  const [method, setMethod] = React.useState<ManualPaymentMethod | null>(null);
  const [busy, setBusy] = React.useState(false);

  function handleOpenChange(next: boolean) {
    if (!next) setMethod(null);
    onOpenChange(next);
  }

  async function confirm() {
    if (!invoice || !method) return;
    setBusy(true);
    try {
      await setStatus({ id: invoice.id, status: "paid", paymentMethod: method });
      const label = METHODS.find((m) => m.value === method)?.label ?? method;
      toast.success(
        method === "credit"
          ? `${invoice.number} settled with studio credit - a P&L adjustment was posted.`
          : `${invoice.number} recorded paid via ${label}.`,
      );
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record the payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Record payment{invoice ? ` - ${invoice.number}` : ""}</DialogTitle>
          <DialogDescription>
            {invoice ? `${money(invoice.amountCents)} - how did the client pay?` : "How did the client pay?"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Payment type">
          {METHODS.map(({ value, label, icon: Icon }) => {
            const selected = method === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setMethod(value)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-md border px-3 py-3 text-sm transition-colors",
                  selected
                    ? "border-gold/60 bg-gold/10 text-bone"
                    : "border-graphite/50 bg-coal-2 text-steel hover:border-graphite/70 hover:bg-coal-3",
                )}
              >
                <Icon className={cn("size-4", selected ? "text-gold" : "text-steel/70")} />
                {label}
              </button>
            );
          })}
        </div>

        {method === "credit" && (
          <p className="rounded-md border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-steel">
            Studio credit settles the invoice without cash coming in. Pulse posts a matching
            P&amp;L adjustment so revenue nets out on the books.
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={confirm} disabled={busy || !method}>
            {busy ? <Spinner className="text-gold-ink" /> : <CheckCircle2 className="size-4" />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
