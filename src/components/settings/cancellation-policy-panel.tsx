"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Save, ShieldCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/toggle";

type Policy = {
  cancellationWindowHours: number | null;
  cancellationFeePct: number | null;
  noShowAutoCharge: boolean;
  stripeReady: boolean;
};

/**
 * No-Show Shield policy: how much notice a client must give before a
 * cancellation fee kicks in, and what percentage of the booking rate that fee
 * is. A no-show always assesses; a cancel only inside the window. Any paid
 * deposit is forfeited first, and the remainder is invoiced, or charged to the
 * card the client agreed to at checkout when the owner turned that on.
 */
export function CancellationPolicyPanel() {
  const policy = useQuery(api.sessions.getCancellationPolicy, {}) as Policy | undefined;
  const save = useMutation(api.sessions.setCancellationPolicy);
  const setAutoCharge = useMutation(api.sessions.setNoShowAutoCharge);
  const [switching, setSwitching] = React.useState(false);

  async function onToggleAutoCharge(enabled: boolean) {
    setSwitching(true);
    try {
      await setAutoCharge({ enabled });
      toast.success(
        enabled
          ? "Card charging is on. New checkouts ask clients to agree before their card is saved."
          : "Card charging is off. Fees go out as an invoice.",
      );
    } catch (err) {
      const d = (err as { data?: unknown })?.data;
      toast.error(typeof d === "string" ? d : err instanceof Error ? err.message : "Could not change it.");
    } finally {
      setSwitching(false);
    }
  }

  const [hours, setHours] = React.useState("");
  const [pct, setPct] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // Re-seed the inputs when the loaded policy changes.
  const key = policy ? `${policy.cancellationWindowHours ?? ""}|${policy.cancellationFeePct ?? ""}` : "loading";
  const [prevKey, setPrevKey] = React.useState(key);
  if (policy && prevKey !== key) {
    setPrevKey(key);
    setHours(policy.cancellationWindowHours != null ? String(policy.cancellationWindowHours) : "");
    setPct(policy.cancellationFeePct != null ? String(policy.cancellationFeePct) : "");
  }

  async function onSave() {
    setSaving(true);
    try {
      const h = parseFloat(hours);
      const p = parseFloat(pct);
      await save({
        cancellationWindowHours: Number.isFinite(h) ? h : 0,
        cancellationFeePct: Number.isFinite(p) ? p : 0,
      });
      toast.success("Cancellation policy saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const hoursNum = parseFloat(hours);
  const pctNum = parseFloat(pct);
  const preview =
    Number.isFinite(pctNum) && pctNum > 0
      ? `A client who cancels within ${Number.isFinite(hoursNum) ? hoursNum : 0}h of the start, or no-shows, owes ${pctNum}% of the booking rate. Pulse keeps any paid deposit toward that fee and ${
          policy?.noShowAutoCharge
            ? "charges the rest to the card the client saved and agreed to at checkout. If there is no such card, or the charge fails, it drafts a bill and tells you."
            : "drafts a bill for the rest when staff mark it."
        }`
      : "No fee applies yet. Set a percentage above to arm the shield.";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-gold" />
          No-Show Shield
        </CardTitle>
        <CardDescription>
          Protect against late cancellations and no-shows. Set the notice window
          and the fee (a percentage of the booking rate). A no-show always
          assesses the fee; a cancellation only inside the window. Cancellations
          outside the window stay free.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[10rem_10rem_auto] sm:items-end">
          <Field label="Notice window" hint="Hours before start">
            <div className="relative">
              <Input
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                placeholder="24"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className="pr-10"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-steel/70">
                h
              </span>
            </div>
          </Field>
          <Field label="Cancellation fee" hint="% of booking rate">
            <div className="relative">
              <Input
                type="number"
                inputMode="numeric"
                min="0"
                max="100"
                step="5"
                placeholder="50"
                value={pct}
                onChange={(e) => setPct(e.target.value)}
                className="pr-7"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-steel/70">
                %
              </span>
            </div>
          </Field>
          <Button size="sm" onClick={onSave} disabled={saving || policy === undefined}>
            <Save className="size-3.5" />
            {saving ? "Saving…" : "Save policy"}
          </Button>
        </div>

        <p className="rounded-md border border-gold/25 bg-gold/[0.06] p-3 text-xs leading-relaxed text-steel">
          {preview}
        </p>

        <div className="flex items-start justify-between gap-4 rounded-md border border-graphite/50 p-3">
          <div className="space-y-1 text-xs leading-relaxed text-steel">
            <p className="font-medium text-bone">Charge the fee to the client&apos;s saved card</p>
            <p>
              Off by default. When on, the online checkout asks each client to agree, in one
              sentence that states your fee, before the card they pay with is saved. A no-show is
              then charged once to that card, at least 15 minutes after you mark it (undo the
              no-show in that time and nothing is charged), less anything the client already paid.
              A late cancel is never charged to the card: it stays a draft invoice you choose to
              send. Clients who did not agree, and any failed charge, get an invoice instead. Only
              the owner can change this.
            </p>
            {policy && !policy.stripeReady && (
              <p className="text-warning">Connect Stripe and turn on card payments first.</p>
            )}
          </div>
          <Switch
            checked={policy?.noShowAutoCharge ?? false}
            disabled={switching || policy === undefined || (!policy.noShowAutoCharge && !policy.stripeReady)}
            onCheckedChange={onToggleAutoCharge}
            aria-label="Charge no-show fees to the client's saved card"
          />
        </div>
      </CardContent>
    </Card>
  );
}
