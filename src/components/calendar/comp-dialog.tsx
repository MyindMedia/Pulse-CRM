"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Gift, Check } from "lucide-react";
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
import { money } from "@/lib/format";

const REASONS = [
  { value: "artist_development", label: "Artist development" },
  { value: "makegood", label: "Makegood" },
  { value: "referral", label: "Referral" },
  { value: "charity", label: "Charity" },
  { value: "promo", label: "Promo" },
  { value: "internal", label: "Internal use" },
  { value: "other", label: "Other" },
];

type Mode = "comped" | "discounted" | "none";

export type CompTarget = {
  _id: Id<"sessions">;
  title: string;
  rateCents: number;
  listValueCents?: number;
  compType?: "comped" | "discounted";
  compReason?: string;
};

/** Mark a session comped or discounted (or clear it), tracking foregone revenue
 *  (list value minus what was charged). */
export function CompDialog({
  session,
  open,
  onOpenChange,
}: {
  session: CompTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setComp = useMutation(api.sessions.setComp);
  const [mode, setMode] = React.useState<Mode>("comped");
  const [reason, setReason] = React.useState("artist_development");
  const [charged, setCharged] = React.useState("");
  const [listVal, setListVal] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // Prefill on open from the session's current state.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open && session) {
      setMode(session.compType ?? "comped");
      setReason(session.compReason ?? "artist_development");
      const list = session.listValueCents ?? session.rateCents;
      setListVal(list ? (list / 100).toString() : "");
      setCharged(session.compType === "discounted" ? (session.rateCents / 100).toString() : "");
    }
  }

  if (!session) return null;

  const listCents = Math.round((parseFloat(listVal) || 0) * 100);
  const chargedCents = mode === "comped" ? 0 : Math.round((parseFloat(charged) || 0) * 100);
  const foregone = Math.max(0, listCents - chargedCents);

  async function save() {
    if (!session) return;
    if (mode === "discounted" && chargedCents >= listCents) {
      toast.error("A discount must be below the list value.");
      return;
    }
    setBusy(true);
    try {
      await setComp({
        id: session._id,
        compType: mode,
        listValueCents: mode === "none" ? undefined : listCents,
        chargedCents: mode === "discounted" ? chargedCents : undefined,
        compReason: mode === "none" ? undefined : reason,
      });
      toast.success(mode === "none" ? "Comp removed - full rate restored." : `Session ${mode}.`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="size-4 text-gold" />
            Comp or discount
          </DialogTitle>
          <DialogDescription>
            Track what you give away on &ldquo;{session.title}&rdquo;. List value minus what you
            charge is recorded as foregone revenue.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field label="Type">
            <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="comped">Comped (free)</SelectItem>
                <SelectItem value="discounted">Discounted</SelectItem>
                {session.compType && (
                  <SelectItem value="none">Remove comp (restore full rate)</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>

          {mode !== "none" && (
            <>
              <Field label="List value" hint="What it would normally bill">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={listVal}
                  onChange={(e) => setListVal(e.target.value)}
                  placeholder="200"
                />
              </Field>
              {mode === "discounted" && (
                <Field label="Charged amount" hint="What the client actually pays">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={charged}
                    onChange={(e) => setCharged(e.target.value)}
                    placeholder="120"
                  />
                </Field>
              )}
              <Field label="Reason">
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex items-center justify-between rounded-md border border-graphite/50 bg-coal-2 px-3 py-2 text-sm">
                <span className="text-steel">Foregone revenue</span>
                <span className="font-meta font-semibold text-gold-bright">{money(foregone)}</span>
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            <Check className="size-4" />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
