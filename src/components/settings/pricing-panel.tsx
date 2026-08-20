"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Plus, Trash2, Save, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Field, Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/toggle";
import { PLAN_LIMITS, PUBLIC_TIERS, type TierKey } from "@convex/lib/plans";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SERVICES, type Org, type DiscountCode, type ServicePricing } from "./types";

function dollarsToCents(value: string): number | undefined {
  const n = parseFloat(value);
  if (!value.trim() || !Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100);
}
function centsToDollars(cents: number | undefined): string {
  return cents !== undefined ? (cents / 100).toFixed(2) : "";
}

/** Per-service pricing + discount codes + tax config. */
export function PricingPanel({ org }: { org: Org }) {
  return (
    <div className="space-y-5">
      <PublicTiersCard org={org} />
      <ServicePricingCard org={org} />
      <SavedFeesCard />
      <DiscountCodesCard org={org} />
      <TaxConfigCard org={org} />
    </div>
  );
}

/* ============================================================ */
type FeeTemplate = {
  _id: string;
  label: string;
  amountCents: number;
  description?: string;
  active: boolean;
};

/** Reusable flat fees a studio can quick-add to invoices (mix/master per song,
 *  annual maintenance, etc.). Each fee is its own record, edited inline. */
function SavedFeesCard() {
  const fees = useQuery(api.feeTemplates.list, {}) as FeeTemplate[] | undefined;
  const create = useMutation(api.feeTemplates.create);

  const [label, setLabel] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [adding, setAdding] = React.useState(false);

  const canAdd = label.trim().length > 0 && (dollarsToCents(amount) ?? 0) > 0 && !adding;

  async function add() {
    if (!canAdd) return;
    setAdding(true);
    try {
      await create({ label: label.trim(), amountCents: dollarsToCents(amount)! });
      setLabel("");
      setAmount("");
      toast.success("Fee saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save fee.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Saved fees</CardTitle>
        <CardDescription>
          Reusable flat charges (mixing &amp; mastering per song, annual
          maintenance, rush fees) you can one-click add to any invoice. Toggle a
          fee off to hide it from the invoice picker without deleting it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {fees === undefined ? (
          <p className="py-6 text-center text-xs text-steel/70">Loading…</p>
        ) : fees.length === 0 ? (
          <p className="rounded-md border border-dashed border-graphite/60 py-6 text-center text-xs text-steel/70">
            No saved fees yet. Add one below.
          </p>
        ) : (
          <ul className="space-y-2">
            {fees.map((fee) => (
              <FeeRow key={fee._id} fee={fee} />
            ))}
          </ul>
        )}

        <div className="grid grid-cols-[1fr_8rem_auto] items-end gap-2 border-t border-graphite/60 pt-4">
          <Field label="New fee">
            <Input
              type="text"
              placeholder="Mixing & Mastering"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field label="Amount">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-steel/70">
                $
              </span>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="5"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-7"
              />
            </div>
          </Field>
          <Button size="sm" onClick={add} disabled={!canAdd}>
            <Plus className="size-3.5" />
            Add fee
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FeeRow({ fee }: { fee: FeeTemplate }) {
  const update = useMutation(api.feeTemplates.update);
  const remove = useMutation(api.feeTemplates.remove);

  const [label, setLabel] = React.useState(fee.label);
  const [amount, setAmount] = React.useState(centsToDollars(fee.amountCents));
  const [saving, setSaving] = React.useState(false);

  // Re-seed when the underlying record changes.
  const key = `${fee.label}|${fee.amountCents}`;
  const [prevKey, setPrevKey] = React.useState(key);
  if (prevKey !== key) {
    setPrevKey(key);
    setLabel(fee.label);
    setAmount(centsToDollars(fee.amountCents));
  }

  const cents = dollarsToCents(amount);
  const dirty = label.trim() !== fee.label || (cents !== undefined && cents !== fee.amountCents);
  const canSave = label.trim().length > 0 && (cents ?? 0) > 0 && dirty && !saving;

  const id = fee._id as unknown as Parameters<typeof update>[0]["id"];

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      await update({ id, label: label.trim(), amountCents: cents! });
      toast.success("Fee updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li
      className={cn(
        "grid grid-cols-[1fr_8rem_auto_auto] items-center gap-2 rounded-md border border-graphite/50 bg-coal-2 p-2",
        !fee.active && "opacity-60",
      )}
    >
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Fee name" />
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-steel/70">
          $
        </span>
        <Input
          type="number"
          inputMode="decimal"
          min="0"
          step="5"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="pl-7 text-right font-meta"
        />
      </div>
      <div className="flex items-center gap-1.5 px-1">
        <Switch
          checked={fee.active}
          onCheckedChange={(v) => update({ id, active: v })}
          aria-label={`Toggle ${fee.label}`}
        />
        {dirty ? (
          <IconButton variant="ghost" size="icon-sm" onClick={save} disabled={!canSave} label="Save fee">
            <Save className="size-3.5" />
          </IconButton>
        ) : null}
      </div>
      <IconButton
        variant="ghost"
        size="icon-sm"
        onClick={() => remove({ id })}
        label={`Remove ${fee.label}`}
      >
        <Trash2 className="size-3.5" />
      </IconButton>
    </li>
  );
}

/* ============================================================ */
/** Short, hand-written inclusions per public tier (limits come from PLAN_LIMITS). */
const TIER_BULLETS: Record<Exclude<TierKey, "agency">, string[]> = {
  flow: [
    "No monthly fee, ever",
    "2% of what you collect through Pulse",
    "Booking page, deposits, card on file",
    "No-show shield + auto invoicing",
    "1 room \u00b7 2 seats \u00b7 5 GB",
  ],
  studio: [
    "Booking page, deposits, card on file",
    "No-show shield + auto waitlist",
    "Invoices with the 3/7/14 dunning ladder",
    "2 rooms \u00b7 3 seats \u00b7 10 GB",
  ],
  pro: [
    "Everything in Studio, plus:",
    "Staff schedule, time clock, payroll",
    "AI ops agent + SMS receptionist",
    "Reports, pipeline, inventory, packages",
    "6 rooms \u00b7 15 seats \u00b7 100 GB",
  ],
  label: [
    "Everything in Pro, plus:",
    "Full white-label UI: your logo, colors, fonts",
    "Custom domain + branded sign-in and email",
    "Releases, licensing, patch bay, split sheets",
    "Unlimited rooms and seats \u00b7 1 TB",
  ],
  growth: [
    "Legacy plan (superseded by Label)",
    "Up to 3 sub-accounts",
    "Custom domain + white-label",
    "2,000 AI credits \u00b7 250 GB storage",
  ],
  enterprise: [
    "Studio networks + schools",
    "Unlimited AI credits \u00b7 2 TB storage",
    "Full white-label + custom domain",
    "Dedicated onboarding & support",
  ],
};

function priceLabel(tier: TierKey): string {
  const limits = PLAN_LIMITS[tier];
  if (limits.custom || limits.priceCents === 0) return "Custom";
  return `$${Math.round(limits.priceCents / 100)} / mo`;
}

/**
 * Maps the legacy workspace plan flag to a public billing tier so we can mark
 * one tier as the current plan. solo/studio -> studio, label -> growth.
 */
function currentPublicTier(plan: Org["plan"]): TierKey {
  if (plan === "label") return "growth";
  return "studio";
}

/** Public subscription tiers - synced from PLAN_LIMITS / PUBLIC_TIERS. */
function PublicTiersCard({ org }: { org: Org }) {
  const current = currentPublicTier(org.plan);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Subscription plan</CardTitle>
        <CardDescription>
          Your Pulse subscription tier. Prices reflect the public plans; the
          highlighted card is your current workspace plan.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PUBLIC_TIERS.map((key) => {
            const limits = PLAN_LIMITS[key];
            const isCurrent = key === current;
            return (
              <div
                key={key}
                className={cn(
                  "flex flex-col rounded-lg border p-4",
                  isCurrent
                    ? "border-gold bg-gold/[0.06]"
                    : "border-graphite/50 bg-coal-2",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-grotesk text-sm font-semibold text-bone">
                    {limits.label}
                  </p>
                  {isCurrent && <Badge tone="gold">Current</Badge>}
                </div>
                <p className="mt-1 font-meta text-sm text-gold">{priceLabel(key)}</p>
                <p className="mt-2 text-xs text-steel">{limits.tagline}</p>
                <ul className="mt-3 flex-1 space-y-1.5">
                  {TIER_BULLETS[key as Exclude<TierKey, "agency">].map((b) => (
                    <li key={b} className="flex items-start gap-1.5 text-xs text-steel">
                      <Check className="mt-0.5 size-3 shrink-0 text-positive" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================================================ */
function ServicePricingCard({ org }: { org: Org }) {
  const setServicePricing = useMutation(api.orgs.setServicePricing);
  const initial = React.useMemo(
    () =>
      Object.fromEntries(
        SERVICES.map((s) => [s.key, centsToDollars(org.servicePricing?.[s.key])]),
      ) as Record<string, string>,
    [org.servicePricing],
  );
  const [vals, setVals] = React.useState<Record<string, string>>(initial);
  // Re-seed when the prop changes.
  const [prevKey, setPrevKey] = React.useState(JSON.stringify(initial));
  const nextKey = JSON.stringify(initial);
  if (prevKey !== nextKey) {
    setPrevKey(nextKey);
    setVals(initial);
  }
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    try {
      const pricing: ServicePricing = {};
      for (const s of SERVICES) {
        const cents = dollarsToCents(vals[s.key]);
        if (cents !== undefined) pricing[s.key] = cents;
      }
      await setServicePricing({ pricing });
      toast.success("Service pricing saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Service pricing</CardTitle>
        <CardDescription>
          Hourly rate per service. Sessions default to the room rate; setting a
          rate here overrides for that service type.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {SERVICES.map((s) => (
            <Field key={s.key} label={s.label} hint="USD / hour">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-steel/70">
                  $
                </span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="5"
                  placeholder="0.00"
                  value={vals[s.key] ?? ""}
                  onChange={(e) =>
                    setVals((prev) => ({ ...prev, [s.key]: e.target.value }))
                  }
                  className="pl-7"
                />
              </div>
            </Field>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={save} disabled={saving}>
            <Save className="size-3.5" />
            {saving ? "Saving…" : "Save pricing"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================================================ */
function DiscountCodesCard({ org }: { org: Org }) {
  const setCodes = useMutation(api.orgs.setDiscountCodes);
  const setDefaultPct = useMutation(api.orgs.setDefaultRateCutPct);

  const [codes, setCodes_] = React.useState<DiscountCode[]>(
    org.discountCodes ?? [],
  );
  const [defaultPct, setDefaultPctVal] = React.useState<string>(
    org.defaultRateCutPct?.toString() ?? "",
  );
  const [prevKey, setPrevKey] = React.useState(JSON.stringify(org.discountCodes));
  const nextKey = JSON.stringify(org.discountCodes);
  if (prevKey !== nextKey) {
    setPrevKey(nextKey);
    setCodes_(org.discountCodes ?? []);
    setDefaultPctVal(org.defaultRateCutPct?.toString() ?? "");
  }
  const [saving, setSaving] = React.useState(false);

  function add() {
    setCodes_((prev) => [
      ...prev,
      { code: "", pct: 10, label: "", active: true },
    ]);
  }
  function update(i: number, patch: Partial<DiscountCode>) {
    setCodes_((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function removeAt(i: number) {
    setCodes_((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true);
    try {
      // Skip empty codes.
      const clean = codes.filter((c) => c.code.trim());
      await setCodes({ codes: clean });
      const pct = parseFloat(defaultPct);
      if (Number.isFinite(pct) && pct > 0) {
        await setDefaultPct({ pct });
      }
      toast.success("Discount codes saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discount codes</CardTitle>
        <CardDescription>
          Promo codes for your subaccount. Each code stores its percentage and
          can be paused without deleting. The default rate-cut percentage tunes
          how aggressive the AI promo generator is when it finds underused
          windows.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="Default rate-cut percentage" hint="Used by the AI promo recommender">
          <div className="relative w-32">
            <Input
              type="number"
              inputMode="decimal"
              min="1"
              max="90"
              step="1"
              placeholder="15"
              value={defaultPct}
              onChange={(e) => setDefaultPctVal(e.target.value)}
              className="pr-7"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-steel/70">
              %
            </span>
          </div>
        </Field>

        <div className="space-y-2">
          <p className="overline">Custom codes</p>
          {codes.length === 0 ? (
            <p className="rounded-md border border-dashed border-graphite/60 py-6 text-center text-xs text-steel/70">
              No discount codes yet. Add one below.
            </p>
          ) : (
            <ul className="space-y-2">
              {codes.map((c, i) => (
                <li
                  key={i}
                  className={cn(
                    "grid grid-cols-[1fr_5rem_1fr_auto_auto] items-center gap-2 rounded-md border border-graphite/50 bg-coal-2 p-2",
                    !c.active && "opacity-60",
                  )}
                >
                  <Input
                    type="text"
                    placeholder="CODE"
                    value={c.code}
                    onChange={(e) => update(i, { code: e.target.value.toUpperCase() })}
                    className="font-meta uppercase"
                  />
                  <div className="relative">
                    <Input
                      type="number"
                      min="1"
                      max="90"
                      step="1"
                      placeholder="15"
                      value={c.pct.toString()}
                      onChange={(e) =>
                        update(i, { pct: parseFloat(e.target.value) || 0 })
                      }
                      className="pr-6"
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-steel/70">
                      %
                    </span>
                  </div>
                  <Input
                    type="text"
                    placeholder="Label (optional)"
                    value={c.label ?? ""}
                    onChange={(e) => update(i, { label: e.target.value })}
                  />
                  <div className="flex items-center gap-1.5 px-2">
                    <Switch
                      checked={c.active}
                      onCheckedChange={(v) => update(i, { active: v })}
                      aria-label={`Toggle ${c.code || "code"}`}
                    />
                    <span className="font-meta text-[0.625rem] uppercase text-steel/70">
                      {c.active ? "on" : "off"}
                    </span>
                  </div>
                  <IconButton
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeAt(i)}
                    label={`Remove ${c.code || "code"}`}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          <Button variant="outline" size="sm" onClick={add}>
            <Plus className="size-3.5" />
            Add code
          </Button>
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={saving}>
            <Save className="size-3.5" />
            {saving ? "Saving…" : "Save codes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================================================ */
type StateRate = {
  code: string;
  name: string;
  rate: number;
  taxesServices: boolean;
};

function TaxConfigCard({ org }: { org: Org }) {
  const states = useQuery(api.orgs.stateTaxRates) as StateRate[] | undefined;
  const setTaxConfig = useMutation(api.orgs.setTaxConfig);

  const [state, setState] = React.useState<string>(org.taxState ?? "");
  const [rate, setRate] = React.useState<string>(
    org.taxRate !== null && org.taxRate !== undefined
      ? (org.taxRate * 100).toFixed(3).replace(/\.?0+$/, "")
      : "",
  );
  const [apply, setApply] = React.useState<boolean>(org.taxApply);
  const [override, setOverride] = React.useState(false);
  const [prevKey, setPrevKey] = React.useState(
    `${org.taxState ?? ""}|${org.taxRate ?? ""}|${org.taxApply ? 1 : 0}`,
  );
  const nextKey = `${org.taxState ?? ""}|${org.taxRate ?? ""}|${org.taxApply ? 1 : 0}`;
  if (prevKey !== nextKey) {
    setPrevKey(nextKey);
    setState(org.taxState ?? "");
    setRate(
      org.taxRate !== null && org.taxRate !== undefined
        ? (org.taxRate * 100).toFixed(3).replace(/\.?0+$/, "")
        : "",
    );
    setApply(org.taxApply);
    setOverride(false);
  }
  const [saving, setSaving] = React.useState(false);

  // When state changes (and not overriding), auto-fill the rate.
  const handleStateChange = React.useCallback(
    (next: string) => {
      setState(next);
      if (!override && states) {
        const found = states.find((s) => s.code === next);
        if (found) setRate((found.rate * 100).toFixed(3).replace(/\.?0+$/, ""));
      }
    },
    [override, states],
  );

  const selected = states?.find((s) => s.code === state);

  async function save() {
    setSaving(true);
    try {
      const rNum = parseFloat(rate);
      const taxRate = Number.isFinite(rNum) ? rNum / 100 : undefined;
      await setTaxConfig({
        state: state || undefined,
        taxRate,
        apply,
      });
      toast.success("Tax config saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales tax</CardTitle>
        <CardDescription>
          Pick the state where the studio is registered; we auto-fill the
          current sales/use tax rate for services. Override the rate manually
          for city/county additions. Toggle the checkbox to apply tax to new
          invoices automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
          <Field label="State">
            <Select value={state} onValueChange={handleStateChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
              <SelectContent>
                {(states ?? []).map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.name} ({(s.rate * 100).toFixed(2)}%)
                    {s.taxesServices ? " · services taxable" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Effective rate" hint="Override OK">
            <div className="relative">
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                max="20"
                step="0.001"
                placeholder="0.000"
                value={rate}
                onChange={(e) => {
                  setRate(e.target.value);
                  setOverride(true);
                }}
                className="pr-7"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-steel/70">
                %
              </span>
            </div>
          </Field>
          <Button size="sm" onClick={save} disabled={saving}>
            <Save className="size-3.5" />
            Save
          </Button>
        </div>

        <label className="flex items-start gap-3 rounded-md border border-graphite/50 bg-coal-2 p-3 cursor-pointer">
          <input
            type="checkbox"
            checked={apply}
            onChange={(e) => setApply(e.target.checked)}
            className="mt-0.5 size-4 accent-gold"
          />
          <span className="flex-1">
            <span className="block text-sm font-medium text-bone">
              Apply tax to new invoices automatically
            </span>
            <span className="block text-xs text-steel">
              When on, every new invoice adds a tax line item at the effective rate.
              Existing invoices are not retroactively recalculated.
            </span>
          </span>
        </label>

        {selected && !selected.taxesServices && (
          <p className="rounded-md border border-caution/30 bg-caution/10 p-3 text-xs text-caution">
            Heads up: {selected.name} generally does <strong>not</strong> tax
            recording-studio services. Most studios in this state leave the
            checkbox off. Confirm with your accountant before flipping it on.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
