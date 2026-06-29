"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Check } from "lucide-react";
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
import { Field, Input } from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export type PayTarget = {
  memberId: Id<"members">;
  name: string;
  payType: "hourly" | "salary" | null;
  payRateCents: number | null;
};

export function SetPayDialog({
  target,
  open,
  onOpenChange,
}: {
  target?: PayTarget;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const setPay = useMutation(api.members.setPay);
  const [payType, setPayType] = React.useState<"none" | "hourly" | "salary">("none");
  const [rate, setRate] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open && target) {
      setPayType(target.payType ?? "none");
      setRate(target.payRateCents != null ? (target.payRateCents / 100).toString() : "");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    try {
      if (payType === "none") {
        await setPay({ id: target.memberId, payType: null });
      } else {
        const n = parseFloat(rate);
        if (!Number.isFinite(n) || n < 0) {
          toast.error("Enter a valid rate.");
          setBusy(false);
          return;
        }
        await setPay({ id: target.memberId, payType, payRateCents: Math.round(n * 100) });
      }
      toast.success(`Pay updated for ${target.name}.`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save pay.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Set pay - {target?.name}</DialogTitle>
          <DialogDescription>
            Hourly pay multiplies clocked hours. Salary is an annual figure, prorated per pay period.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="space-y-4">
            <Field label="Pay type">
              <Select value={payType} onValueChange={(v) => setPayType(v as "none" | "hourly" | "salary")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unpaid / not tracked</SelectItem>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="salary">Salary (annual)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {payType !== "none" && (
              <Field label={payType === "hourly" ? "Hourly rate" : "Annual salary"} hint="USD">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-steel/70">$</span>
                  <Input type="number" min="0" step="0.01" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={payType === "hourly" ? "35.00" : "60000"} className="pl-7" autoFocus />
                </div>
              </Field>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}><Check className="size-4" /> {busy ? "Saving…" : "Save pay"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
