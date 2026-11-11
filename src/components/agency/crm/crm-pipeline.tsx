"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, closestCorners, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { ArrowDown, ArrowUp, GripVertical, KanbanSquare, Plus, Settings2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input, Label } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import { OP } from "./ops";
import { useZuRead, useZuWrite, type ZuPaged } from "./use-zu";
import {
  ConfirmDialog, NeedsFullAccess, STAGE_COLORS, StageBadge, SyncBar, TOUCH, WriteButton, ZuErrorState, money, phone,
} from "./crm-ui";
import { useCrm } from "./crm-context";
import { LeadSheet } from "./crm-lead-sheet";
import type { Lead, Stage, StageBehavior, StagesResponse } from "./zu-types";

/* Pipeline: one column per visible Zuops stage, in `position` order. Drag a card,
   or use its "Move to" select (the keyboard path). The card moves at once, Zuops
   is asked, and a refusal puts it back with Zuops's reason (eval U-03). */

export const PAGE_LIMIT = 200;
export const MAX_LEADS = 1000;
const LEAD_PAGES = { listKey: "leads", limit: PAGE_LIMIT, max: MAX_LEADS };

export type Override = { stage: string; at: number };

export function leadStage(l: Lead): string | null {
  return l.stage ?? l.stage_key ?? null;
}

/** Apply optimistic moves that are newer than the data on screen. */
export function applyOverrides(leads: Lead[], overrides: Record<string, Override>, fetchedAt: number | null): Lead[] {
  return leads.map((l) => {
    const o = overrides[l.id];
    if (!o || (fetchedAt !== null && fetchedAt > o.at)) return l;
    return { ...l, stage: o.stage };
  });
}

export function visibleStages(stages: Stage[]): Stage[] {
  return stages.filter((s) => !s.hidden).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export function groupByStage(leads: Lead[], stages: Stage[]): { columns: Record<string, Lead[]>; elsewhere: number } {
  const columns: Record<string, Lead[]> = Object.fromEntries(stages.map((s) => [s.key, [] as Lead[]]));
  let elsewhere = 0;
  for (const l of leads) {
    const k = leadStage(l);
    if (k && columns[k]) columns[k].push(l);
    else elsewhere += 1;
  }
  return { columns, elsewhere };
}

function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    (fn) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", fn);
      return () => mq.removeEventListener("change", fn);
    },
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );
}

export function CrmPipeline() {
  const stages = useZuRead<StagesResponse>(OP.stagesList, undefined, { pollMs: 300_000 });
  const leads = useZuRead<ZuPaged<Lead>>(OP.leadsList, undefined, { kinds: ["lead"], pages: LEAD_PAGES });
  const { run } = useZuWrite();
  const reduced = useReducedMotion();
  const [overrides, setOverrides] = React.useState<Record<string, Override>>({});
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [admin, setAdmin] = React.useState(false);
  const { canWrite } = useCrm();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  const allStages = React.useMemo(() => [...(stages.data?.stages ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)), [stages.data]);
  const cols = React.useMemo(() => visibleStages(allStages), [allStages]);
  const shown = React.useMemo(
    () => applyOverrides(leads.data?.items ?? [], overrides, leads.fetchedAt),
    [leads.data, overrides, leads.fetchedAt],
  );
  const { columns, elsewhere } = React.useMemo(() => groupByStage(shown, cols), [shown, cols]);
  const active = activeId ? shown.find((l) => l.id === activeId) ?? null : null;

  const move = async (lead: Lead, to: string) => {
    if (!canWrite || leadStage(lead) === to) return;
    const label = allStages.find((s) => s.key === to)?.label ?? to;
    setOverrides((o) => ({ ...o, [lead.id]: { stage: to, at: Date.now() } }));
    const res = await run(OP.leadSetStage, { path: { lead_id: lead.id }, body: { stage_key: to } }, { invalidate: [OP.leadsList, OP.leadGet] });
    if (res.ok) {
      toast.success(`${lead.full_name || "Lead"} moved to ${label}`);
      return;
    }
    setOverrides((o) => {
      const next = { ...o };
      delete next[lead.id];
      return next;
    });
    toast.error(`Not moved. ${res.reason ?? "Zuops refused."}`);
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (!e.over) return;
    const lead = shown.find((l) => l.id === String(e.active.id));
    const to = (e.over.data.current as { stage?: string } | undefined)?.stage ?? String(e.over.id);
    if (lead && cols.some((s) => s.key === to)) void move(lead, to);
  };

  const refresh = () => { stages.refresh(); leads.refresh(); };
  const error = stages.error ?? leads.error;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SyncBar fetchedAt={leads.fetchedAt} onRefresh={refresh} refreshing={leads.refreshing} />
        <Button type="button" variant="secondary" size="sm" className={TOUCH} onClick={() => setAdmin(true)} disabled={!stages.data}>
          <Settings2 className="size-4" aria-hidden />Stages
        </Button>
      </div>
      <p className="text-sm text-steel">Drag a card, or use its Move to menu. Zuops is updated first; a refusal puts the card back.</p>

      {leads.data?.truncated && (
        <p role="status" className="rounded-md border border-caution/30 bg-caution/10 px-3 py-2 text-sm text-bone">
          Showing the newest {MAX_LEADS.toLocaleString("en-US")} leads. Use the Leads tab to find the rest.
        </p>
      )}

      {error && !(stages.data && leads.data) ? (
        <ZuErrorState error={error} onRetry={refresh} />
      ) : !stages.data || !leads.data ? (
        <div aria-busy="true" aria-label="Loading pipeline" className="flex gap-3 overflow-hidden">
          {[0, 1, 2, 3].map((i) => <div key={i} className="w-64 shrink-0 space-y-2"><Skeleton className="h-6 w-32" /><Skeleton className="h-64 w-full" /></div>)}
        </div>
      ) : cols.length === 0 ? (
        <EmptyState icon={KanbanSquare} title="No visible stages" description="Every stage is hidden in Zuops. Open Stages to show one." />
      ) : (
        <>
          {error && <p role="alert" className="text-sm text-caution">Showing the last copy. {error.reason}</p>}
          {shown.length === 0 && <p className="text-sm text-steel">No leads in Zuops yet. New leads appear in the first column.</p>}
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
            <div className="-mx-4 overflow-x-auto px-4 pb-2" role="region" aria-label="Pipeline board" tabIndex={0}>
              <div className="flex gap-3">
                {cols.map((s) => (
                  <Column key={s.id} stage={s} leads={columns[s.key] ?? []} stages={cols} onOpen={setOpenId} onMove={move} canWrite={canWrite} />
                ))}
              </div>
            </div>
            <DragOverlay dropAnimation={reduced ? null : undefined}>
              {active ? <CardFace lead={active} overlay /> : null}
            </DragOverlay>
          </DndContext>
          {elsewhere > 0 && <p className="text-xs text-steel">{elsewhere} lead{elsewhere === 1 ? " is" : "s are"} in hidden stages and not shown here.</p>}
        </>
      )}

      {stages.data && <StageAdmin open={admin} onOpenChange={setAdmin} stages={allStages} />}
      <LeadSheet leadId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function Column({
  stage, leads, stages, onOpen, onMove, canWrite,
}: {
  stage: Stage;
  leads: Lead[];
  stages: Stage[];
  onOpen: (id: string) => void;
  onMove: (lead: Lead, to: string) => void;
  canWrite: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key, data: { stage: stage.key }, disabled: !canWrite });
  const total = leads.reduce((sum, l) => sum + (l.deal_value_cents ?? 0), 0);
  return (
    <section aria-label={`${stage.label}, ${leads.length} leads`} className="flex w-64 min-w-64 shrink-0 flex-col">
      <header className="mb-2 flex items-center justify-between gap-2 px-0.5">
        <StageBadge stage={stage} />
        <span className="font-meta text-[0.6875rem] text-steel">{leads.length} · {money(total)}</span>
      </header>
      <ul
        ref={setNodeRef}
        className={cn(
          "flex min-h-40 flex-1 flex-col gap-2 rounded-lg border p-2",
          isOver ? "border-gold-dim bg-gold/[0.04]" : "border-graphite/50 bg-obsidian/60",
        )}
      >
        {leads.map((l) => <li key={l.id}><DraggableCard lead={l} stages={stages} onOpen={onOpen} onMove={onMove} canWrite={canWrite} /></li>)}
        {leads.length === 0 && (
          <li className="flex flex-1 items-center justify-center rounded-md border border-dashed border-graphite/60 py-8">
            <span className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">No leads here</span>
          </li>
        )}
      </ul>
    </section>
  );
}

function CardFace({ lead, overlay, children }: { lead: Lead; overlay?: boolean; children?: React.ReactNode }) {
  return (
    <div className={cn("rounded-md border border-graphite/50 bg-coal-2 p-2.5", overlay && "border-gold-dim shadow-pop")}>
      <p className="truncate font-grotesk text-sm font-semibold text-bone">{lead.full_name || lead.email || phone(lead.phone) || "Unnamed lead"}</p>
      <p className="truncate text-xs text-steel">{lead.inquiry || lead.email || phone(lead.phone) || "No details"}</p>
      {lead.deal_value_cents != null && <p className="mt-1 font-meta text-xs text-gold-bright">{money(lead.deal_value_cents, lead.deal_currency)}</p>}
      {children}
    </div>
  );
}

function DraggableCard({
  lead, stages, onOpen, onMove, canWrite,
}: {
  lead: Lead;
  stages: Stage[];
  onOpen: (id: string) => void;
  onMove: (lead: Lead, to: string) => void;
  canWrite: boolean;
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: lead.id, disabled: !canWrite });
  const current = leadStage(lead) ?? "";
  const name = lead.full_name || lead.email || "lead";
  return (
    <div ref={setNodeRef} className={cn("relative", isDragging && "opacity-40")}>
      <CardFace lead={lead}>
        <div className="mt-2 flex items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" className={cn(TOUCH, "px-2")} onClick={() => onOpen(lead.id)} aria-label={`Open ${name}`}>
            Open
          </Button>
          <label className="sr-only" htmlFor={`move-${lead.id}`}>Move {name}</label>
          <select
            id={`move-${lead.id}`} value={current} disabled={!canWrite}
            onChange={(e) => onMove(lead, e.target.value)}
            className="pl-field h-8 min-w-0 flex-1 rounded-md border border-graphite/60 bg-obsidian px-2 text-xs text-bone outline-none focus-visible:ring-2 focus-visible:ring-gold/30 disabled:opacity-50 max-sm:h-11"
          >
            {!stages.some((s) => s.key === current) && <option value={current}>In {current || "no stage"}</option>}
            {stages.map((s) => <option key={s.id} value={s.key}>{s.key === current ? `In ${s.label}` : `Move to ${s.label}`}</option>)}
          </select>
          {canWrite && (
            <span {...listeners} aria-hidden className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded text-steel/70 hover:text-bone max-sm:size-11">
              <GripVertical className="size-4" />
            </span>
          )}
        </div>
      </CardFace>
    </div>
  );
}

/* ---------- stage admin ---------- */

export function moveInOrder<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const j = index + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

function StageAdmin({ open, onOpenChange, stages }: { open: boolean; onOpenChange: (v: boolean) => void; stages: Stage[] }) {
  const { run, pending } = useZuWrite();
  const [newLabel, setNewLabel] = React.useState("");
  const [newBehavior, setNewBehavior] = React.useState<StageBehavior>("contacted");
  const [newColor, setNewColor] = React.useState<string>("blue");
  const inv = [OP.stagesList, OP.leadsList];

  const reorder = async (index: number, dir: -1 | 1) => {
    const order = moveInOrder(stages, index, dir).map((s) => s.id);
    const res = await run(OP.stagesReorder, { body: { order } }, { invalidate: inv });
    if (!res.ok) toast.error(res.reason ?? "Zuops refused.");
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    const res = await run(OP.stageCreate, { body: { label, behavior: newBehavior, color: newColor } }, { invalidate: inv });
    if (res.ok) { toast.success(`Stage ${label} added`); setNewLabel(""); }
    else toast.error(res.reason ?? "Zuops refused.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Pipeline stages</DialogTitle>
          <DialogDescription>Rename, recolor, hide or reorder. The five built-in stages can only change name, color and hidden. Deleting a stage needs a Full access key.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <ol className="space-y-3">
            {stages.map((s, i) => (
              <StageRow key={`${s.id}-${s.label}-${s.color}-${s.hidden}`} stage={s} index={i} count={stages.length} stages={stages} onReorder={reorder} pending={pending} />
            ))}
          </ol>
          <form onSubmit={add} className="grid gap-3 rounded-lg border border-graphite/50 p-3 sm:grid-cols-[minmax(0,1fr)_9rem_8rem_auto] sm:items-end">
            <Field label="New stage" htmlFor="stage-new"><Input id="stage-new" className={TOUCH} maxLength={40} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} /></Field>
            <Field label="Means" htmlFor="stage-new-behavior">
              <Select value={newBehavior} onValueChange={(v) => setNewBehavior(v as StageBehavior)}>
                <SelectTrigger id="stage-new-behavior" className={TOUCH}><SelectValue /></SelectTrigger>
                <SelectContent>{(["new", "contacted", "booked", "won", "lost"] as const).map((b) => <SelectItem key={b} value={b}>{b[0].toUpperCase() + b.slice(1)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Color" htmlFor="stage-new-color">
              <Select value={newColor} onValueChange={setNewColor}>
                <SelectTrigger id="stage-new-color" className={TOUCH}><SelectValue /></SelectTrigger>
                <SelectContent>{STAGE_COLORS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <WriteButton type="submit" disabled={!newLabel.trim() || pending}><Plus className="size-4" aria-hidden />Add stage</WriteButton>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" className={TOUCH} onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function stagePatch(stage: Stage, draft: { label: string; color: string; hidden: boolean }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (draft.label.trim() && draft.label.trim() !== stage.label) out.label = draft.label.trim();
  if (draft.color !== (stage.color ?? "")) out.color = draft.color;
  if (draft.hidden !== !!stage.hidden) out.hidden = draft.hidden;
  return out;
}

function StageRow({
  stage, index, count, stages, onReorder, pending,
}: {
  stage: Stage;
  index: number;
  count: number;
  stages: Stage[];
  onReorder: (index: number, dir: -1 | 1) => void;
  pending: boolean;
}) {
  const { run } = useZuWrite();
  const { hasAdminKey } = useCrm();
  const [draft, setDraft] = React.useState({ label: stage.label, color: stage.color ?? "slate", hidden: !!stage.hidden });
  const others = stages.filter((s) => s.id !== stage.id);
  const [moveTo, setMoveTo] = React.useState(others[0]?.key ?? "");
  const patch = stagePatch(stage, draft);
  const changed = Object.keys(patch).length > 0;

  const save = async () => {
    const res = await run(OP.stageUpdate, { path: { stage_id: stage.id }, body: patch }, { invalidate: [OP.stagesList, OP.leadsList] });
    if (res.ok) toast.success(`Stage ${draft.label} saved`);
    else toast.error(res.reason ?? "Zuops refused.");
  };

  return (
    <li className="space-y-2 rounded-lg border border-graphite/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StageBadge stage={stage} />
        {stage.is_system && <Badge>Built in</Badge>}
        {stage.hidden && <Badge tone="caution">Hidden</Badge>}
        <span className="ml-auto flex gap-1">
          <WriteButton type="button" variant="ghost" size="icon-sm" aria-label={`Move ${stage.label} up`} disabled={index === 0 || pending} onClick={() => onReorder(index, -1)}><ArrowUp className="size-4" aria-hidden /></WriteButton>
          <WriteButton type="button" variant="ghost" size="icon-sm" aria-label={`Move ${stage.label} down`} disabled={index === count - 1 || pending} onClick={() => onReorder(index, 1)}><ArrowDown className="size-4" aria-hidden /></WriteButton>
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto_auto] sm:items-end">
        <Field label="Name" htmlFor={`stage-${stage.id}-label`}>
          <Input id={`stage-${stage.id}-label`} className={TOUCH} maxLength={40} value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} />
        </Field>
        <Field label="Color" htmlFor={`stage-${stage.id}-color`}>
          <Select value={draft.color} onValueChange={(v) => setDraft((d) => ({ ...d, color: v }))}>
            <SelectTrigger id={`stage-${stage.id}-color`} className={TOUCH}><SelectValue /></SelectTrigger>
            <SelectContent>{STAGE_COLORS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="flex h-10 items-center gap-2 max-sm:min-h-11">
          <Switch id={`stage-${stage.id}-hidden`} checked={draft.hidden} onCheckedChange={(v) => setDraft((d) => ({ ...d, hidden: v }))} />
          <Label htmlFor={`stage-${stage.id}-hidden`}>Hidden</Label>
        </div>
        <WriteButton type="button" variant="secondary" disabled={!changed || pending} onClick={save}>Save</WriteButton>
      </div>
      {!stage.is_system && (
        <div className="flex flex-wrap items-end gap-2 border-t border-hairline pt-2">
          <Field label="Its leads move to" htmlFor={`stage-${stage.id}-moveto`} className="min-w-40 flex-1">
            <Select value={moveTo} onValueChange={setMoveTo}>
              <SelectTrigger id={`stage-${stage.id}-moveto`} className={TOUCH}><SelectValue /></SelectTrigger>
              <SelectContent>{others.map((s) => <SelectItem key={s.id} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <ConfirmDialog
            title={`Delete the ${stage.label} stage?`}
            body={<>Its leads move to {others.find((s) => s.key === moveTo)?.label ?? moveTo}. This cannot be undone.</>}
            confirmLabel="Delete stage"
            destructive
            onConfirm={async (grant) => {
              const res = await run(OP.stageDelete, { path: { stage_id: stage.id }, query: { move_to: moveTo }, ...grant }, { invalidate: [OP.stagesList, OP.leadsList] });
              if (res.ok) toast.success(`Stage ${stage.label} deleted`);
              else toast.error(res.reason ?? "Zuops refused.");
            }}
            trigger={<WriteButton type="button" variant="danger" admin disabled={!moveTo}><Trash2 className="size-4" aria-hidden />Delete</WriteButton>}
          />
          {!hasAdminKey && <NeedsFullAccess />}
        </div>
      )}
    </li>
  );
}
