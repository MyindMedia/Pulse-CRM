"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Gift, LayoutGrid, List, Pencil, Plus, RotateCcw, Sparkles, Star, Tag, Trash2 } from "lucide-react";
import { PageHeader, Section } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/toggle";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/feedback";
import { SkeletonCards } from "@/components/ui/skeleton";
import { money } from "@/lib/format";

type PlanDraft = {
  name: string;
  description: string;
  priceDollars: string;
  billingInterval: "month" | "year";
  trialDays: string;
  requireCardAfterTrial: boolean;
  isPromo: boolean;
};

const EMPTY: PlanDraft = {
  name: "",
  description: "",
  priceDollars: "",
  billingInterval: "month",
  trialDays: "14",
  requireCardAfterTrial: true,
  isPromo: false,
};

export default function AgencyPlansPage() {
  const plans = useQuery(api.agencyPlans.list, {});
  const seedStarter = useMutation(api.agencyPlans.seedStarter);
  const reseedStarter = useMutation(api.agencyPlans.reseedStarter);
  const create = useMutation(api.agencyPlans.create);
  const update = useMutation(api.agencyPlans.update);
  const setActive = useMutation(api.agencyPlans.setActive);
  const setDefault = useMutation(api.agencyPlans.setDefault);
  const remove = useMutation(api.agencyPlans.remove);

  type PlanRow = NonNullable<typeof plans>[number];

  const [open, setOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<Id<"agencyPlans"> | null>(null);
  const [draft, setDraft] = React.useState<PlanDraft>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [busyReset, setBusyReset] = React.useState(false);
  const [view, setView] = React.useState<"cards" | "list">("cards");

  async function doReset() {
    setBusyReset(true);
    try {
      const r = await reseedStarter({});
      toast.success(
        r.studiosMoved > 0
          ? `Reset to ${r.seeded} starter plans. ${r.studiosMoved} studio${r.studiosMoved === 1 ? "" : "s"} moved to Studio: Free Forever.`
          : `Reset to ${r.seeded} starter plans.`,
      );
      setResetOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reset the price book.");
    } finally {
      setBusyReset(false);
    }
  }

  function openCreate() {
    setEditingId(null);
    setDraft(EMPTY);
    setOpen(true);
  }

  function openEdit(p: PlanRow) {
    setEditingId(p._id);
    setDraft({
      name: p.name,
      description: p.description ?? "",
      priceDollars: p.priceCents ? (p.priceCents / 100).toString() : "",
      billingInterval: p.billingInterval,
      trialDays: p.trialDays.toString(),
      requireCardAfterTrial: p.requireCardAfterTrial,
      isPromo: p.isPromo,
    });
    setOpen(true);
  }

  function closeDialog() {
    setOpen(false);
    setEditingId(null);
    setDraft(EMPTY);
  }

  async function submit() {
    setBusy(true);
    try {
      const fields = {
        name: draft.name,
        description: draft.description || undefined,
        priceCents: Math.round(parseFloat(draft.priceDollars || "0") * 100),
        billingInterval: draft.billingInterval,
        trialDays: parseInt(draft.trialDays || "0", 10),
        requireCardAfterTrial: draft.requireCardAfterTrial,
        isPromo: draft.isPromo,
      };
      if (editingId) {
        await update({ planId: editingId, ...fields });
        toast.success("Plan updated.");
      } else {
        await create(fields);
        toast.success("Plan created.");
      }
      closeDialog();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : editingId
            ? "Could not update the plan."
            : "Could not create the plan.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function guarded(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  function renderActions(p: PlanRow) {
    return (
      <>
        <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
          <Pencil className="size-3.5" /> Edit
        </Button>
        {!p.isDefault && p.active && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void guarded(() => setDefault({ planId: p._id }), `${p.name} is now the default.`)}
          >
            Make default
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void guarded(
              () => setActive({ planId: p._id, active: !p.active }),
              p.active ? "Plan deactivated." : "Plan reactivated.",
            )
          }
        >
          {p.active ? "Deactivate" : "Reactivate"}
        </Button>
        {p.assignedCount === 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="text-critical hover:text-critical"
            onClick={() => void guarded(() => remove({ planId: p._id }), "Plan deleted.")}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </>
    );
  }

  const viewToggle = (
    <div className="flex items-center gap-1 rounded-md border border-graphite/50 bg-coal-2 p-0.5">
      <Button
        size="sm"
        variant={view === "cards" ? "secondary" : "ghost"}
        className="px-2"
        aria-pressed={view === "cards"}
        aria-label="Card view"
        onClick={() => setView("cards")}
      >
        <LayoutGrid className="size-4" />
      </Button>
      <Button
        size="sm"
        variant={view === "list" ? "secondary" : "ghost"}
        className="px-2"
        aria-pressed={view === "list"}
        aria-label="List view"
        onClick={() => setView("list")}
      >
        <List className="size-4" />
      </Button>
    </div>
  );

  return (
    <div className="space-y-8">
      <PageHeader
        overline="Billing"
        title="Plans"
        description="The price book you sell to your studios. Seed first-adopter packages (free forever, 30 days, or one year free), set paid tiers, trial lengths, and which plan new studios start on."
        actions={
          <div className="flex flex-wrap gap-2">
            {plans && plans.length > 0 && (
              <Button onClick={() => setResetOpen(true)} size="sm" variant="secondary">
                <RotateCcw className="size-4" /> Reset to starter plans
              </Button>
            )}
            <Button onClick={openCreate} size="sm">
              <Plus className="size-4" /> New plan
            </Button>
          </div>
        }
      />

      {plans === undefined ? (
        <SkeletonCards cards={3} />
      ) : plans.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="No plans yet"
          description="Create your price book. Seed first-adopter packages for every tier (free forever, 30 days, and one year free), then assign studios to them."
          action={
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => void guarded(() => seedStarter({}), "Starter plans created.")}
              >
                <Sparkles className="size-4" /> Create starter plans
              </Button>
              <Button size="sm" variant="secondary" onClick={openCreate}>
                <Plus className="size-4" /> New plan
              </Button>
            </div>
          }
        />
      ) : (
        <Section title="Your plans" trailing={viewToggle}>
          {view === "cards" ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {plans.map((p) => (
                <Card key={p._id} className={p.isDefault ? "border-gold/40" : undefined}>
                  <CardContent className="space-y-4 pt-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h3 className="font-grotesk text-base font-semibold text-bone">{p.name}</h3>
                          {p.isPromo && (
                            <Badge tone="gold">
                              <Gift className="mr-1 size-3" /> Promo
                            </Badge>
                          )}
                          {p.isDefault && (
                            <Badge tone="info">
                              <Star className="mr-1 size-3" /> Default
                            </Badge>
                          )}
                          {!p.active && <Badge tone="neutral">Inactive</Badge>}
                        </div>
                        {p.description && <p className="text-xs text-steel">{p.description}</p>}
                      </div>
                    </div>

                    <div className="flex items-baseline gap-1">
                      <span className="chrome-display text-2xl text-bone">
                        {p.priceCents === 0 ? "Free" : money(p.priceCents)}
                      </span>
                      {p.priceCents !== 0 && (
                        <span className="text-sm text-steel">/{p.billingInterval}</span>
                      )}
                    </div>

                    <dl className="space-y-1 text-xs text-steel">
                      <div className="flex justify-between">
                        <dt>Trial</dt>
                        <dd className="text-bone">{p.trialDays > 0 ? `${p.trialDays} days` : "None"}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Card after trial</dt>
                        <dd className="text-bone">{p.requireCardAfterTrial ? "Required" : "Optional"}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Studios on plan</dt>
                        <dd className="text-bone">{p.assignedCount}</dd>
                      </div>
                    </dl>

                    <div className="flex flex-wrap gap-2 border-t border-graphite/40 pt-3">
                      {renderActions(p)}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Plan</TH>
                  <TH className="text-right">Price</TH>
                  <TH>Trial</TH>
                  <TH>Card after trial</TH>
                  <TH className="text-right">Studios</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {plans.map((p) => (
                  <TR key={p._id} className={!p.active ? "opacity-60" : undefined}>
                    <TD>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-bone">{p.name}</span>
                        {p.isPromo && (
                          <Badge tone="gold">
                            <Gift className="mr-1 size-3" /> Promo
                          </Badge>
                        )}
                        {p.isDefault && (
                          <Badge tone="info">
                            <Star className="mr-1 size-3" /> Default
                          </Badge>
                        )}
                        {!p.active && <Badge tone="neutral">Inactive</Badge>}
                      </div>
                      {p.description && <p className="mt-0.5 text-xs text-steel">{p.description}</p>}
                    </TD>
                    <TD className="text-right whitespace-nowrap">
                      {p.priceCents === 0 ? (
                        "Free"
                      ) : (
                        <>
                          {money(p.priceCents)}
                          <span className="text-steel">/{p.billingInterval}</span>
                        </>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-steel">
                      {p.trialDays > 0 ? `${p.trialDays} days` : "None"}
                    </TD>
                    <TD className="text-steel">{p.requireCardAfterTrial ? "Required" : "Optional"}</TD>
                    <TD className="text-right">{p.assignedCount}</TD>
                    <TD>
                      <div className="flex flex-wrap justify-end gap-1">{renderActions(p)}</div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Section>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : closeDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit plan" : "New plan"}</DialogTitle>
            <DialogDescription>A plan your studios are billed on. A free promo = $0 with the promo flag on.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Name" htmlFor="plan-name">
              <Input
                id="plan-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="First Adopter"
              />
            </Field>
            <Field label="Description" htmlFor="plan-desc">
              <Input
                id="plan-desc"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Free for early studios."
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price (USD)" htmlFor="plan-price" hint="0 = free">
                <Input
                  id="plan-price"
                  value={draft.priceDollars}
                  onChange={(e) => setDraft({ ...draft, priceDollars: e.target.value.replace(/[^0-9.]/g, "") })}
                  placeholder="0"
                  inputMode="decimal"
                />
              </Field>
              <Field label="Billing">
                <Select
                  value={draft.billingInterval}
                  onValueChange={(v) => setDraft({ ...draft, billingInterval: v as "month" | "year" })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Monthly</SelectItem>
                    <SelectItem value="year">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Free trial / promo days" htmlFor="plan-trial" hint="How long studios use it before a card is needed.">
              <Input
                id="plan-trial"
                value={draft.trialDays}
                onChange={(e) => setDraft({ ...draft, trialDays: e.target.value.replace(/[^0-9]/g, "") })}
                placeholder="14"
                inputMode="numeric"
              />
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-md border border-graphite/50 bg-coal-2 px-3 py-2.5">
              <span className="text-sm text-bone">
                Require a card when the trial ends
                <span className="block text-xs text-steel">Locks the studio until they add payment.</span>
              </span>
              <Switch
                checked={draft.requireCardAfterTrial}
                onCheckedChange={(v) => setDraft({ ...draft, requireCardAfterTrial: v })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-graphite/50 bg-coal-2 px-3 py-2.5">
              <span className="text-sm text-bone">
                First-adopter promo
                <span className="block text-xs text-steel">Badge it as a limited promo offer.</span>
              </span>
              <Switch
                checked={draft.isPromo}
                onCheckedChange={(v) => setDraft({ ...draft, isPromo: v })}
              />
            </label>
            <div className="flex justify-end">
              <Button onClick={() => void submit()} disabled={busy || !draft.name.trim()}>
                {busy
                  ? editingId
                    ? "Saving…"
                    : "Creating…"
                  : editingId
                    ? "Save changes"
                    : "Create plan"}
              </Button>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* Reset confirmation */}
      <Dialog open={resetOpen} onOpenChange={(o) => !busyReset && setResetOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset to starter plans?</DialogTitle>
            <DialogDescription>
              This deletes your current plans and rebuilds the 9 first-adopter packages
              (Free Forever, 30 Day Free, and 1 Year Free for Solo, Studio, and Label). Any
              studio on an old plan is moved to Studio: Free Forever. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setResetOpen(false)} disabled={busyReset}>
                Cancel
              </Button>
              <Button onClick={() => void doReset()} disabled={busyReset}>
                <RotateCcw className="size-4" /> {busyReset ? "Resetting…" : "Reset price book"}
              </Button>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
