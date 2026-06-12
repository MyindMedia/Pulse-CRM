"use client";

import * as React from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { Plus, Clock, Percent, Crown, RefreshCw, CreditCard, CheckCircle2 } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Switch } from "@/components/ui/toggle";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { money } from "@/lib/format";

const intervalLabel: Record<string, string> = { month: "/ mo", year: "/ yr" };

/** Membership plans surface - studio-defined recurring tiers (priority booking,
 *  bundled hours, member discount), billed via the studio's Stripe Connect. The
 *  recurring Stripe Price is created automatically on the connected account. */
export function MembershipsPanel() {
  const plans = useQuery(api.memberships.listPlans, {});
  const connect = useQuery(api.stripeConnect.status, {});
  const setActive = useMutation(api.memberships.setPlanActive);
  const sync = useAction(api.memberships.syncPlanToStripe);
  const [addOpen, setAddOpen] = React.useState(false);
  const [syncing, setSyncing] = React.useState<string | null>(null);

  const connected = Boolean(connect?.connected && connect?.chargesEnabled);

  async function toggle(id: string, active: boolean) {
    try {
      await setActive({ id: id as never, active: !active });
      toast.success(active ? "Plan archived." : "Plan activated.");
    } catch {
      toast.error("Could not update the plan.");
    }
  }

  async function syncPlan(id: string) {
    setSyncing(id);
    try {
      await sync({ planId: id as never });
      toast.success("Recurring price created in Stripe.");
    } catch (err) {
      // ConvexError carries the actionable message in .data; .message is the
      // opaque "Server Error" envelope.
      toast.error(
        err instanceof ConvexError ? String(err.data) : "Could not sync to Stripe.",
      );
    } finally {
      setSyncing(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Membership plans</CardTitle>
          <CardDescription>
            Monthly or yearly packages your clients subscribe to. When you save a package
            we create the recurring price in your connected Stripe automatically, and clients
            can subscribe right from your booking page.
          </CardDescription>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          New plan
        </Button>
      </CardHeader>
      <CardContent>
        {!connected && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-graphite/50 bg-coal-2 px-3 py-2.5">
            <CreditCard className="mt-0.5 size-3.5 shrink-0 text-caution" />
            <p className="text-[0.6875rem] text-steel/70">
              Connect your Stripe account in <span className="text-bone">Settings → Integrations</span> to
              start charging. You can still define packages now; we will create their recurring
              prices the moment Stripe is connected.
            </p>
          </div>
        )}
        {plans === undefined ? (
          <div className="space-y-2">
            {[0, 1].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : plans.length === 0 ? (
          <p className="rounded-md border border-dashed border-graphite/60 py-10 text-center text-xs text-steel/70">
            No plans yet. Add a Producer Pass, a Member tier, or a Studio Plus to start charging recurring revenue.
          </p>
        ) : (
          <ul className="space-y-2">
            {plans.map((p) => (
              <li
                key={p._id}
                className={`rounded-md border border-graphite/50 bg-coal-2 p-4 ${p.active ? "" : "opacity-60"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-grotesk text-base font-semibold text-bone">{p.name}</h3>
                      {!p.active && <Badge tone="neutral">archived</Badge>}
                      {p.priorityBooking && (
                        <Badge tone="gold"><Crown className="size-2.5" /> Priority</Badge>
                      )}
                      {p.stripePriceId && (
                        <Badge tone="positive"><CheckCircle2 className="size-2.5" /> Live</Badge>
                      )}
                    </div>
                    {p.description && <p className="mt-1 text-xs text-steel">{p.description}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-steel">
                      {p.bundledHoursPerPeriod ? (
                        <span className="inline-flex items-center gap-1"><Clock className="size-3 text-steel/70" /> {p.bundledHoursPerPeriod}h bundled</span>
                      ) : null}
                      {p.memberDiscountPct ? (
                        <span className="inline-flex items-center gap-1"><Percent className="size-3 text-steel/70" /> {p.memberDiscountPct}% member discount</span>
                      ) : null}
                      {!p.stripePriceId && (
                        <button
                          type="button"
                          onClick={() => void syncPlan(p._id)}
                          disabled={syncing === p._id}
                          className="inline-flex items-center gap-1 rounded text-caution hover:text-bone disabled:opacity-60"
                        >
                          <RefreshCw className={`size-3 ${syncing === p._id ? "animate-spin" : ""}`} />
                          {syncing === p._id ? "Creating price..." : "Sync to Stripe to go live"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-grotesk text-xl font-bold tabular-nums text-bone">
                      {money(p.priceCents)}<span className="text-xs text-steel/70">{intervalLabel[p.billingInterval]}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => toggle(p._id, p.active)}
                      className="mt-2 text-[0.625rem] font-meta uppercase tracking-wide text-steel/70 hover:text-bone"
                    >
                      {p.active ? "Archive" : "Re-activate"}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <AddPlanDialog open={addOpen} onOpenChange={setAddOpen} connected={connected} />
    </Card>
  );
}

function AddPlanDialog({
  open,
  onOpenChange,
  connected,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  connected: boolean;
}) {
  const create = useAction(api.memberships.createPlanWithStripe);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [interval, setInterval] = React.useState<"month" | "year">("month");
  const [hours, setHours] = React.useState("");
  const [discount, setDiscount] = React.useState("");
  const [priority, setPriority] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  function reset() {
    setName(""); setDescription(""); setPrice(""); setInterval("month");
    setHours(""); setDiscount(""); setPriority(false);
  }

  async function submit() {
    const priceCents = Math.round(Number(price) * 100);
    if (!name.trim()) { toast.error("Name is required."); return; }
    if (!Number.isFinite(priceCents) || priceCents <= 0) { toast.error("Enter a positive price."); return; }
    setBusy(true);
    try {
      const res = await create({
        name: name.trim(),
        description: description.trim() || undefined,
        priceCents,
        billingInterval: interval,
        bundledHoursPerPeriod: hours ? Math.max(0, Number(hours)) : undefined,
        memberDiscountPct: discount ? Math.max(0, Math.min(100, Number(discount))) : undefined,
        priorityBooking: priority || undefined,
      });
      toast.success(
        res.linked
          ? "Plan created and live in Stripe."
          : "Plan saved. Connect Stripe to start charging.",
      );
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the plan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>New membership plan</DialogTitle>
          <DialogDescription>
            Define what a paying member gets each period. We create the recurring price in
            your connected Stripe automatically.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Producer Pass" />
          </Field>
          <Field label="Description" hint="Optional pitch shown on your booking page.">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price (USD)">
              <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="249.00" inputMode="decimal" />
            </Field>
            <Field label="Billing">
              <Select value={interval} onValueChange={(v) => setInterval(v as "month" | "year")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">Monthly</SelectItem>
                  <SelectItem value="year">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bundled hours / period" hint="0 or blank for none.">
              <Input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="8" inputMode="numeric" />
            </Field>
            <Field label="Member discount %" hint="Applied to session rates.">
              <Input value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="10" inputMode="numeric" />
            </Field>
          </div>
          {!connected && (
            <p className="rounded-md border border-graphite/50 bg-coal-2 px-3 py-2 text-[0.6875rem] text-steel/70">
              Stripe isn&apos;t connected yet, so this plan will save as a draft. Connect Stripe in
              Integrations and press &ldquo;Sync to Stripe&rdquo; to make it live.
            </p>
          )}
          <label className="flex items-center justify-between rounded-md border border-graphite/50 bg-coal-2 px-3 py-2">
            <span className="text-sm text-bone">Priority booking</span>
            <Switch checked={priority} onCheckedChange={setPriority} />
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy} onClick={submit}>{busy ? "Saving..." : "Create plan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
