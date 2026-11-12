"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus, Search, UserSearch, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input, Label } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import { OP } from "./ops";
import { stableStringify, useIdemFor, useZuFetch, useZuRead, useZuWrite } from "./use-zu";
import {
  ConfirmDialog, StageBadge, SyncBar, TOUCH, WriteButton, ZuErrorState, money, phone, relTime, type ConfirmGrant,
} from "./crm-ui";
import { LeadSheet } from "./crm-lead-sheet";
import type { LeadsJump } from "./crm-context";
import type { Lead, LeadResponse, LeadsResponse, StagesResponse, TagsResponse } from "./zu-types";

/* Leads: server search (debounced 300 ms) and filters, 50 a page, a row opens the
   lead. "New lead" creates one in Zuops; nothing is sent to the person unless
   "Work it like a form lead" is ticked. */

export const PAGE_SIZE = 50;
const ALL = "all";

export const LEAD_STATUSES = ["new", "contacted", "qualified", "booked", "won", "lost", "spam", "partial"] as const;
export const LEAD_SOURCES = [
  "manual", "api", "smart_form", "smart_form_partial", "website_form", "site_widget", "meta_lead_ad", "instagram", "messenger",
  "sms_inbound", "email_inbound", "webhook", "import", "review_funnel", "calendly", "acuity", "other",
] as const;

export type LeadFilters = {
  search: string;
  status: string;
  stage: string;
  tag: string;
  source: string;
  existing: "all" | "leads" | "customers";
};

export const EMPTY_FILTERS: LeadFilters = { search: "", status: ALL, stage: ALL, tag: ALL, source: ALL, existing: "all" };

export function isFiltering(f: LeadFilters): boolean {
  return f.search.trim() !== "" || f.status !== ALL || f.stage !== ALL || f.tag !== ALL || f.source !== ALL || f.existing !== "all";
}

/** The query sent to GET /v1/leads. Zuops has no source filter, so source is
 *  applied to the page in the browser (see `bySource`). */
export function leadsQuery(f: LeadFilters, offset: number): Record<string, string | number | boolean | undefined> {
  return {
    limit: PAGE_SIZE,
    offset: offset > 0 ? offset : undefined,
    search: f.search.trim() || undefined,
    status: f.status !== ALL ? f.status : undefined,
    stage_key: f.stage !== ALL ? f.stage : undefined,
    tags: f.tag !== ALL ? JSON.stringify([f.tag]) : undefined,
    existing_customer: f.existing === "customers" ? true : f.existing === "leads" ? false : undefined,
  };
}

export function bySource(leads: Lead[], source: string): Lead[] {
  return source === ALL ? leads : leads.filter((l) => (l.source ?? "other") === source);
}

export const label = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : s);

export type NewLeadForm = {
  name: string;
  email: string;
  phone: string;
  inquiry: string;
  stage: string;
  tags: string;
  runIntake: boolean;
};

/** The body for POST /v1/leads, or the reason it cannot be sent. */
export function newLeadBody(f: NewLeadForm): { body: Record<string, unknown> } | { error: string } {
  const name = f.name.trim();
  const email = f.email.trim();
  const tel = f.phone.trim();
  if (!name && !email && !tel) return { error: "Add a name, an email or a phone number." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That email does not look right." };
  if (tel && tel.replace(/\D/g, "").length < 7) return { error: "That phone number looks too short." };
  const tags = f.tags.split(",").map((t) => t.trim()).filter(Boolean);
  const body: Record<string, unknown> = { run_intake: f.runIntake };
  if (name) body.full_name = name;
  if (email) body.email = email;
  if (tel) body.phone = tel;
  if (f.inquiry.trim()) body.inquiry = f.inquiry.trim();
  if (f.stage && f.stage !== ALL) body.stage_key = f.stage;
  if (tags.length) body.tags = tags;
  return { body };
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function FilterSelect({
  id, labelText, value, onChange, options,
}: {
  id: string;
  labelText: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="min-w-0 space-y-1 sm:w-44">
      <Label htmlFor={id}>{labelText}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className={TOUCH}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The filters a jump from another tab (the Pipeline's "not in a stage" line) sets. */
export function filtersForJump(jump: LeadsJump | undefined): LeadFilters {
  return { ...EMPTY_FILTERS, status: jump?.status && (LEAD_STATUSES as readonly string[]).includes(jump.status) ? jump.status : ALL };
}

/** "Showing a to b" for the rows actually on screen (F-U17). */
export function showingRange(dataOffset: number, count: number): string {
  return count ? `Showing ${dataOffset + 1} to ${dataOffset + count}` : "No leads on this page";
}

export function CrmLeads({ jump, jumpNonce = 0 }: { jump?: LeadsJump; jumpNonce?: number } = {}) {
  const [filters, setFilters] = React.useState<LeadFilters>(() => (jumpNonce ? filtersForJump(jump) : EMPTY_FILTERS));
  // A new jump (each one bumps the nonce) replaces the filters.
  const [seenJump, setSeenJump] = React.useState(jumpNonce);
  if (seenJump !== jumpNonce) {
    setSeenJump(jumpNonce);
    setFilters(filtersForJump(jump));
  }
  const search = useDebounced(filters.search, 300);
  const serverFilters = { ...filters, search };
  const sig = JSON.stringify(leadsQuery(serverFilters, 0));
  const [page, setPage] = React.useState<{ sig: string; offset: number }>({ sig, offset: 0 });
  const offset = page.sig === sig ? page.offset : 0;
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [opener, setOpener] = React.useState<HTMLElement | null>(null);
  const [creating, setCreating] = React.useState(false);
  /** Open a lead and remember the row's button, so closing the sheet puts focus
   *  back on it (F-V3). */
  const open = (id: string, from?: Element | null) => {
    const el = from instanceof HTMLElement
      ? (from.matches("[data-lead-opener]") ? from : from.querySelector<HTMLElement>("[data-lead-opener]"))
      : null;
    setOpener(el);
    setOpenId(id);
  };

  const leads = useZuRead<LeadsResponse>(OP.leadsList, { query: leadsQuery(serverFilters, offset) }, { kinds: ["lead"], keepPrevious: true });
  const stages = useZuRead<StagesResponse>(OP.stagesList, undefined, { pollMs: 300_000 });
  const tags = useZuRead<TagsResponse>(OP.tagsList, undefined, { pollMs: 300_000 });

  const stageList = React.useMemo(
    () => [...(stages.data?.stages ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [stages.data],
  );
  const set = (patch: Partial<LeadFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const rows = bySource(leads.data?.leads ?? [], filters.source);
  const all = leads.data?.leads ?? [];
  const hasMore = !leads.held && !!leads.data?.has_more && leads.data?.next_offset != null;
  const filtering = isFiltering(filters);
  // The offset the rows on screen came from. While the next page loads the old
  // rows stay up (dimmed), so they keep their own numbers.
  const [dataOffset, setDataOffset] = React.useState(offset);
  if (!leads.held && leads.data && dataOffset !== offset) setDataOffset(offset);
  const rowsOffset = leads.held ? dataOffset : offset;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SyncBar fetchedAt={leads.fetchedAt} onRefresh={() => { leads.refresh(); stages.refresh(); tags.refresh(); }} refreshing={leads.refreshing} />
        <WriteButton type="button" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden />
          New lead
        </WriteButton>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1 space-y-1 sm:min-w-56">
          <Label htmlFor="crm-lead-search">Search leads</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel/70" aria-hidden />
            <Input
              id="crm-lead-search" type="search" value={filters.search} className={cn("pl-9", TOUCH)}
              placeholder="Name, email, phone, notes" onChange={(e) => set({ search: e.target.value })}
            />
          </div>
        </div>
        <FilterSelect id="crm-lead-status" labelText="Status" value={filters.status} onChange={(v) => set({ status: v })}
          options={[{ value: ALL, label: "Any status" }, ...LEAD_STATUSES.map((s) => ({ value: s, label: label(s) }))]} />
        <FilterSelect id="crm-lead-stage" labelText="Stage" value={filters.stage} onChange={(v) => set({ stage: v })}
          options={[{ value: ALL, label: "Any stage" }, ...stageList.map((s) => ({ value: s.key, label: s.label }))]} />
        <FilterSelect id="crm-lead-tag" labelText="Tag" value={filters.tag} onChange={(v) => set({ tag: v })}
          options={[{ value: ALL, label: "Any tag" }, ...(tags.data?.tags ?? []).map((t) => ({ value: t.name, label: t.name }))]} />
        <FilterSelect id="crm-lead-source" labelText="Source (this page)" value={filters.source} onChange={(v) => set({ source: v })}
          options={[{ value: ALL, label: "Any source" }, ...LEAD_SOURCES.map((s) => ({ value: s, label: label(s) }))]} />
        <FilterSelect id="crm-lead-existing" labelText="Who" value={filters.existing} onChange={(v) => set({ existing: v as LeadFilters["existing"] })}
          options={[{ value: "all", label: "Leads and customers" }, { value: "leads", label: "Leads only" }, { value: "customers", label: "Existing customers" }]} />
      </div>

      {leads.error && !leads.data ? (
        <ZuErrorState error={leads.error} onRetry={leads.refresh} />
      ) : leads.loading ? (
        <div aria-busy="true" aria-label="Loading leads"><SkeletonRows rows={6} /></div>
      ) : rows.length === 0 ? (
        filtering ? (
          <EmptyState
            icon={UserSearch} title="No leads match" description="Clear the filters, or add a lead."
            action={<Button type="button" variant="secondary" size="sm" className={TOUCH} onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</Button>}
          />
        ) : (
          <EmptyState icon={Users} title="No leads yet" description="Leads from forms, Instagram and the API land here. You can also add one by hand." />
        )
      ) : (
        <>
          {leads.error && (
            <p role="alert" className="flex items-center gap-2 text-sm text-caution">
              <AlertTriangle className="size-4" aria-hidden />Showing the last copy. {leads.error.reason}
            </p>
          )}
          {leads.held && <p role="status" className="text-sm text-steel">Loading leads from Zuops</p>}
          <Table
            className={cn("min-w-[760px] transition-opacity", leads.held && "opacity-50")}
            aria-label="Leads" aria-busy={leads.refreshing || leads.held || undefined}
          >
            <THead>
              <tr><TH>Lead</TH><TH>Contact</TH><TH>Stage</TH><TH>Source</TH><TH>Tags</TH><TH>Deal</TH><TH>Last activity</TH></tr>
            </THead>
            <TBody>
              {rows.map((l) => (
                <TR key={l.id} interactive onClick={(e) => open(l.id, e.currentTarget)}>
                  <TD>
                    <button
                      type="button" data-lead-opener={l.id} onClick={(e) => { e.stopPropagation(); open(l.id, e.currentTarget); }}
                      className="block max-w-56 truncate rounded-sm text-left font-semibold text-bone outline-none hover:underline focus-visible:ring-2 focus-visible:ring-gold/40 max-sm:min-h-11"
                    >
                      {l.full_name || l.email || phone(l.phone) || "Unnamed lead"}
                    </button>
                    {l.inquiry && <span className="block max-w-56 truncate text-xs text-steel">{l.inquiry}</span>}
                    {l.existing_customer && <Badge tone="info" className="mt-1">Existing customer</Badge>}
                  </TD>
                  <TD>
                    <span className="block max-w-56 truncate">{l.email || <span className="text-steel/70">No email</span>}</span>
                    <span className="block text-xs tabular-nums text-steel">{phone(l.phone) || "No phone"}</span>
                  </TD>
                  <TD><StageBadge stage={l.stage ?? l.stage_key ?? null} stages={stageList} /></TD>
                  <TD className="whitespace-nowrap text-ash">{label(l.source ?? "other")}</TD>
                  <TD>
                    {(l.tags ?? []).length
                      ? <span className="flex max-w-48 flex-wrap gap-1">{(l.tags ?? []).map((t) => <Badge key={t}>{t}</Badge>)}</span>
                      : <span className="text-steel/70">–</span>}
                  </TD>
                  <TD className="whitespace-nowrap tabular-nums">{money(l.deal_value_cents, l.deal_currency)}</TD>
                  <TD className="whitespace-nowrap text-ash">{relTime(l.last_activity_at ?? l.updated_at ?? l.created_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}

      {(all.length > 0 || offset > 0) && (
        <nav aria-label="Lead pages" className="flex flex-wrap items-center gap-2">
          <span className="mr-auto font-meta text-xs uppercase tracking-wide text-steel">
            {showingRange(rowsOffset, all.length)}
            {filters.source !== ALL ? ` · ${rows.length} from this source` : ""}
          </span>
          <Button type="button" variant="secondary" size="sm" className={TOUCH} disabled={offset === 0 || leads.held}
            onClick={() => setPage({ sig, offset: Math.max(0, offset - PAGE_SIZE) })}>
            <ChevronLeft className="size-4" aria-hidden />Previous
          </Button>
          <Button type="button" variant="secondary" size="sm" className={TOUCH} disabled={!hasMore}
            onClick={() => setPage({ sig, offset: leads.data?.next_offset ?? offset + PAGE_SIZE })}>
            Next<ChevronRight className="size-4" aria-hidden />
          </Button>
        </nav>
      )}

      <NewLeadDialog
        open={creating} onOpenChange={setCreating} stages={stageList.filter((s) => !s.hidden)}
        onOpenLead={(id) => { setCreating(false); open(id, document.querySelector(`[data-lead-opener="${CSS.escape(id)}"]`)); }}
      />
      <LeadSheet leadId={openId} onClose={() => setOpenId(null)} returnFocus={opener} />
    </div>
  );
}

const BLANK: NewLeadForm = { name: "", email: "", phone: "", inquiry: "", stage: ALL, tags: "", runIntake: false };

function NewLeadDialog({
  open, onOpenChange, stages, onOpenLead,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  stages: Array<{ key: string; label: string }>;
  onOpenLead: (id: string) => void;
}) {
  const { run, pending } = useZuWrite();
  const fetchZu = useZuFetch();
  const [form, setForm] = React.useState<NewLeadForm>(BLANK);
  const [error, setError] = React.useState<string | null>(null);
  const [duplicate, setDuplicate] = React.useState(false);
  const [finding, setFinding] = React.useState(false);
  const [confirmIntake, setConfirmIntake] = React.useState(false);
  const [dupId, setDupId] = React.useState<string | null>(null);
  // One Idempotency-Key per distinct form (F-U11): kept for an identical retry,
  // different once any value changes, and new for each opening of the form.
  const [round, setRound] = React.useState(0);
  const idem = useIdemFor(`${round}|${stableStringify(form)}`);
  const set = (patch: Partial<NewLeadForm>) => { setForm((f) => ({ ...f, ...patch })); setError(null); setDuplicate(false); setDupId(null); };

  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) { setForm(BLANK); setError(null); setDuplicate(false); setDupId(null); setRound((n) => n + 1); }
  };

  const create = async (body: Record<string, unknown>, grant?: ConfirmGrant) => {
    const res = await run(OP.leadCreate, { body, idem, ...grant }, { invalidate: [OP.leadsList] });
    if (res.ok) {
      toast.success(body.run_intake ? "Lead created in Zuops. The intake is running." : "Lead created in Zuops. Nothing was sent.");
      const id = (res.data as LeadResponse | undefined)?.lead?.id;
      close(false);
      if (id) onOpenLead(id);
      return;
    }
    if (res.status === 409) {
      // The backend passes Zuops's details through: { lead_id, matched_on }.
      const d = res.data as { lead_id?: unknown } | undefined;
      setDupId(typeof d?.lead_id === "string" ? d.lead_id : null);
      setDuplicate(true);
      return;
    }
    setError(res.reason ?? "Zuops refused.");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const built = newLeadBody(form);
    if ("error" in built) { setError(built.error); return; }
    // Working it like a form lead texts a real person: the server wants a confirm.
    if (built.body.run_intake) { setConfirmIntake(true); return; }
    await create(built.body);
  };

  const openExisting = async () => {
    if (dupId) { close(false); onOpenLead(dupId); return; }
    setFinding(true);
    const term = form.email.trim() || form.phone.trim();
    const found = await fetchZu<LeadsResponse>(OP.leadsList, { query: { search: term, limit: 5 } });
    setFinding(false);
    const lead = found.data?.leads?.[0];
    if (lead) { close(false); onOpenLead(lead.id); return; }
    setError(found.error?.reason ?? "Could not find that lead. Search the list for it.");
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="md">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>New lead</DialogTitle>
            <DialogDescription>Adds the person to Zuops. Add at least a name, an email or a phone number.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Name" htmlFor="nl-name"><Input id="nl-name" autoComplete="off" className={TOUCH} value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" htmlFor="nl-email"><Input id="nl-email" type="email" autoComplete="off" className={TOUCH} value={form.email} onChange={(e) => set({ email: e.target.value })} /></Field>
              <Field label="Phone" htmlFor="nl-phone"><Input id="nl-phone" type="tel" autoComplete="off" className={TOUCH} value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
            </div>
            <Field label="Asked about" htmlFor="nl-inquiry"><Input id="nl-inquiry" className={TOUCH} maxLength={500} value={form.inquiry} onChange={(e) => set({ inquiry: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Stage" htmlFor="nl-stage">
                <Select value={form.stage} onValueChange={(v) => set({ stage: v })}>
                  <SelectTrigger id="nl-stage" className={TOUCH}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Zuops default</SelectItem>
                    {stages.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Tags" htmlFor="nl-tags" hint="Separate with commas. New tags are created.">
                <Input id="nl-tags" className={TOUCH} value={form.tags} onChange={(e) => set({ tags: e.target.value })} />
              </Field>
            </div>
            <div className="space-y-1.5 rounded-md border border-graphite/50 p-3">
              <div className="flex items-start gap-2.5">
                <Checkbox id="nl-intake" className="mt-0.5" checked={form.runIntake} onCheckedChange={(v) => set({ runIntake: v === true })} />
                <Label htmlFor="nl-intake" className="text-sm text-bone">Work it like a form lead (first text, follow-ups, team alert)</Label>
              </div>
              <p className="pl-6.5 text-xs text-steel">Left unchecked, nothing is sent to the lead.</p>
            </div>
            {duplicate && (
              <div role="alert" className="space-y-2 rounded-md border border-caution/40 bg-caution/10 p-3 text-sm">
                <p className="flex items-center gap-2 font-semibold text-bone"><AlertTriangle className="size-4 text-caution" aria-hidden />Already a lead</p>
                <p className="text-steel">Someone with this email or phone is already in Zuops. Open that lead and update it instead.</p>
                <Button type="button" variant="secondary" size="sm" className={TOUCH} onClick={openExisting} disabled={finding || (!dupId && !form.email.trim() && !form.phone.trim())}>
                  {finding ? "Finding the lead" : "Open the existing lead"}
                </Button>
              </div>
            )}
            {error && <p role="alert" className="text-sm text-critical">{error}</p>}
          </DialogBody>
          <DialogFooter className="flex-wrap">
            <Button type="button" variant="ghost" className={TOUCH} onClick={() => close(false)}>Cancel</Button>
            <WriteButton type="submit" disabled={pending}>{pending ? "Creating" : "Create lead"}</WriteButton>
          </DialogFooter>
        </form>
      </DialogContent>
      <ConfirmDialog
        open={confirmIntake}
        onOpenChange={setConfirmIntake}
        title="Text this person now?"
        body={<>Working the lead like a form lead sends {form.name.trim() || "them"} the first text and follow-ups, and alerts your team. It reaches a real person.</>}
        confirmLabel="Create and start texts"
        onConfirm={async (grant) => {
          const built = newLeadBody(form);
          if ("body" in built) await create(built.body, grant);
        }}
      />
    </Dialog>
  );
}
