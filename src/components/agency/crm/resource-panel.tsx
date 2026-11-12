"use client";

import * as React from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Info, Search, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Input, Label } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useZuRead } from "./use-zu";
import { SyncBar, TOUCH, ZuErrorState } from "./crm-ui";
import type { ActionDef, ResourceDef } from "./resource-config";
import { ResourceAction } from "./resource-action";
import { FocusHome, focusOnClose, rowOpener } from "./resource-focus";
import {
  FIRST_PAGE, extractRows, getPath, isObj, leadWithMeaning, nextPage, pageQuery, prevPage, present, rowName, shows, unwrapSingle, visibleColumns,
  type Obj, type PageState,
} from "./resource-utils";
import { CellValue, ValueList } from "./resource-values";

/* Renders one ResourceDef (resource-config.ts): a live list with search,
   filters and paging whose rows open a detail Sheet, or one settings object as a
   definition list. Actions open their own dialogs (resource-action.tsx). At most
   two Zuops reads at once: the list or object, plus one record when a Sheet is
   open (eval P-02). */

const ANY = "__any";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* Read actions are the ones whose op is a GET. The config cannot see the
   registry, so the GET ops it uses as actions are listed here; the test checks
   this set against the registry. */
export const READ_ACTION_OPS: ReadonlySet<string> = new Set([
  "list_automation_enrollments", "automation_results", "list_form_submissions", "get_survey_results", "get_report_data",
  "short_link_stats", "list_short_link_clicks", "list_reward_game_plays", "match_calendar_route",
]);
export const actionIsRead = (a: ActionDef) => READ_ACTION_OPS.has(a.op);

function invalidateFor(def: ResourceDef): string[] {
  return [def.list?.op, def.single?.op, def.detail?.op].filter((x): x is string => !!x);
}

function Header({ def, fetchedAt, onRefresh, refreshing, headingRef, children }: {
  def: ResourceDef; fetchedAt: number | null; onRefresh: () => void; refreshing: boolean;
  headingRef: React.RefObject<HTMLHeadingElement | null>; children?: React.ReactNode;
}) {
  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {/* tabIndex -1: where focus lands when the button that opened a dialog is gone (U-10). */}
          <h2 ref={headingRef} tabIndex={-1} className="rounded-sm font-grotesk text-lg font-semibold text-bone outline-none focus-visible:ring-2 focus-visible:ring-gold/40">{def.title}</h2>
          <p className="text-sm text-steel">{def.blurb}</p>
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
      <SyncBar fetchedAt={fetchedAt} onRefresh={onRefresh} refreshing={refreshing} />
      {def.note && (
        <p className="flex items-start gap-2 text-xs text-steel"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />{def.note}</p>
      )}
    </header>
  );
}

export function ResourcePanel({ def }: { def: ResourceDef }) {
  if (def.single) return <SingleView def={def} />;
  if (def.list) return <ListView def={def} />;
  return null;
}

/* ---------- a settings object ---------- */

function SingleView({ def }: { def: ResourceDef }) {
  const single = def.single!;
  const read = useZuRead<unknown>(single.op, { query: single.query }, { pollMs: 300_000 });
  const picked = single.pick ? getPath(read.data, single.pick) : read.data;
  const obj = single.pick ? (isObj(picked) ? picked : null) : unwrapSingle(read.data);
  const panelActions = (def.actions ?? []).filter((a) => a.scope === "panel");
  const invalidate = invalidateFor(def);
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  // Names for ids from a list that is ALREADY cached (the Calendar tab's
  // calendars, say). enabled: false reads the cache only and never fetches.
  const names = useZuRead<unknown>(single.names?.op ?? null, undefined, { enabled: false, pollMs: 0 });
  const root = single.names && names.data !== undefined ? { answer: read.data, cached: extractRows(names.data, single.names.rowsKey) } : read.data;

  return (
    <FocusHome.Provider value={headingRef}>
    <section className="space-y-4" aria-label={def.title}>
      <Header def={def} fetchedAt={read.fetchedAt} onRefresh={read.refresh} refreshing={read.refreshing} headingRef={headingRef}>
        {panelActions.map((a) => (
          <ResourceAction
            key={`${a.op}-${a.label}`} action={a}
            ctx={{ source: obj, prefillFrom: a.prefill === false || actionIsRead(a) ? null : obj, invalidate, isRead: actionIsRead(a) }}
          />
        ))}
      </Header>
      {read.error && read.data === undefined ? (
        <ZuErrorState error={read.error} onRetry={read.refresh} />
      ) : read.loading ? (
        <div aria-busy="true" aria-label={`Loading ${def.title}`}><SkeletonRows rows={5} /></div>
      ) : !obj || Object.keys(obj).length === 0 ? (
        <EmptyState icon={Inbox} title={`Nothing set for ${def.title.toLowerCase()} yet`} description="Zuops has no settings saved here." />
      ) : (
        <>
          {read.error && <Stale reason={read.error.reason} />}
          <div className="rounded-xl border border-graphite/50 p-4 sm:p-5">
            <ValueList value={obj} only={single.only} root={root} />
          </div>
        </>
      )}
    </section>
    </FocusHome.Provider>
  );
}

function Stale({ reason }: { reason: string }) {
  return (
    <p role="alert" className="flex items-center gap-2 text-sm text-caution">
      <AlertTriangle className="size-4 shrink-0" aria-hidden />Showing the last copy. {reason}
    </p>
  );
}

/* ---------- a list ---------- */

function ListView({ def }: { def: ResourceDef }) {
  const list = def.list!;
  const [term, setTerm] = React.useState("");
  const search = useDebounced(term, 300);
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const baseQuery: Obj = { ...(list.query ?? {}) };
  if (list.search && search.trim()) baseQuery[list.search] = search.trim();
  for (const [k, v] of Object.entries(filters)) if (v !== ANY) baseQuery[k] = v;
  const sig = JSON.stringify(baseQuery);
  const [page, setPage] = React.useState<{ sig: string; at: PageState }>({ sig, at: FIRST_PAGE });
  const at = page.sig === sig ? page.at : FIRST_PAGE;
  const query = { ...baseQuery, ...pageQuery(list.paging, at) } as Record<string, string | number | boolean>;

  const read = useZuRead<unknown>(list.op, { query }, { keepPrevious: true });
  const rows = extractRows(read.data, list.rowsKey);
  // Columns no row fills drop out; an id column never leads (R3-R3).
  const columns = visibleColumns(leadWithMeaning(list.columns), rows);
  const rowIdKey = list.rowId ?? "id";
  const idOf = (row: Obj): string | null => {
    const raw = getPath(row, rowIdKey);
    return typeof raw === "string" || typeof raw === "number" ? String(raw) : null;
  };
  // The open record is kept as its id plus the copy it was opened from; the
  // sheet always shows the CURRENT row from the latest read, so after a write
  // (switching an automation on) its buttons follow the new state (R3-R1).
  const [opened, setOpened] = React.useState<{ id: string | null; snapshot: Obj } | null>(null);
  // The opener's row id outlives `opened`: closing clears `opened` before the
  // sheet's focus handler runs, and that handler still needs the row (R4-R1).
  const lastOpenedId = React.useRef<string | null>(null);
  const setOpenRow = (row: Obj | null) => {
    if (row) lastOpenedId.current = idOf(row);
    setOpened(row ? { id: idOf(row), snapshot: row } : null);
  };
  const openRow = opened ? (opened.id !== null ? rows.find((r) => idOf(r) === opened.id) : undefined) ?? opened.snapshot : null;
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const sectionRef = React.useRef<HTMLElement | null>(null);
  const limit = typeof list.query?.limit === "number" ? list.query.limit : rows.length;
  const next = nextPage(list.paging, at, read.data, rows.length, limit);
  const prev = prevPage(list.paging, at, limit);
  const filtering = !!search.trim() || Object.values(filters).some((v) => v !== ANY);
  const panelActions = (def.actions ?? []).filter((a) => a.scope === "panel");
  const invalidate = invalidateFor(def);

  return (
    <FocusHome.Provider value={headingRef}>
    <section ref={sectionRef} className="space-y-4" aria-label={def.title}>
      <Header def={def} fetchedAt={read.fetchedAt} onRefresh={read.refresh} refreshing={read.refreshing} headingRef={headingRef}>
        {panelActions.map((a) => <ResourceAction key={`${a.op}-${a.label}`} action={a} ctx={{ invalidate, isRead: actionIsRead(a) }} size="md" />)}
      </Header>

      {(list.search || (list.filters ?? []).length > 0) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          {list.search && (
            <div className="min-w-0 flex-1 space-y-1 sm:min-w-56">
              <Label htmlFor={`${def.key}-search`}>Search {def.title.toLowerCase()}</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel/70" aria-hidden />
                <Input id={`${def.key}-search`} type="search" value={term} onChange={(e) => setTerm(e.target.value)} className={cn("pl-9", TOUCH)} />
              </div>
            </div>
          )}
          {(list.filters ?? []).map((f) => (
            <div key={f.param} className="min-w-0 space-y-1 sm:w-44">
              <Label htmlFor={`${def.key}-${f.param}`}>{f.label}</Label>
              <Select value={filters[f.param] ?? ANY} onValueChange={(v) => setFilters((s) => ({ ...s, [f.param]: v }))}>
                <SelectTrigger id={`${def.key}-${f.param}`} className={TOUCH}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any</SelectItem>
                  {f.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}

      {read.error && read.data === undefined ? (
        <ZuErrorState error={read.error} onRetry={read.refresh} />
      ) : read.loading ? (
        <div aria-busy="true" aria-label={`Loading ${def.title}`}><SkeletonRows rows={5} /></div>
      ) : rows.length === 0 ? (
        filtering ? (
          <EmptyState
            icon={SearchX} title="Nothing matches" description="Clear the search and filters to see everything."
            action={<Button type="button" variant="secondary" size="sm" className={TOUCH} onClick={() => { setTerm(""); setFilters({}); }}>Clear filters</Button>}
          />
        ) : (
          <EmptyState icon={Inbox} title={`No ${def.title.toLowerCase()} yet`} description="Zuops has nothing here for this sub-account." />
        )
      ) : (
        <>
          {read.error && <Stale reason={read.error.reason} />}
          <Table className="min-w-[640px]" aria-label={def.title} aria-busy={read.refreshing || undefined}>
            <THead>
              <tr>{columns.map((c) => <TH key={c.key}>{c.label}</TH>)}</tr>
            </THead>
            <TBody>
              {rows.map((row, i) => (
                <TR key={String(row[rowIdKey] ?? i)} interactive onClick={() => setOpenRow(row)}>
                  {columns.map((c, ci) => (
                    <TD key={c.key} className={cn(ci === 0 && "font-semibold")}>
                      {ci === 0 ? (
                        <button
                          type="button" data-row-open={idOf(row) ?? `row-${i}`} onClick={(e) => { e.stopPropagation(); setOpenRow(row); }}
                          className="block max-w-64 truncate rounded-sm text-left text-bone outline-none hover:underline focus-visible:ring-2 focus-visible:ring-gold/40 max-sm:min-h-11"
                        >
                          {present(getPath(row, c.key))
                            ? <CellValue value={getPath(row, c.key)} format={c.format} noLink />
                            : rowName(row, "Open")}
                        </button>
                      ) : (
                        <CellValue value={getPath(row, c.key)} format={c.format} />
                      )}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}

      {list.paging && list.paging !== "none" && (rows.length > 0 || prev) && (
        <nav aria-label={`${def.title} pages`} className="flex flex-wrap items-center gap-2">
          <span className="mr-auto font-meta text-xs uppercase tracking-wide text-steel">
            {rows.length} on this page
          </span>
          <Button type="button" variant="secondary" size="sm" className={TOUCH} disabled={!prev} onClick={() => prev && setPage({ sig, at: prev })}>
            <ChevronLeft className="size-4" aria-hidden />Previous
          </Button>
          <Button type="button" variant="secondary" size="sm" className={TOUCH} disabled={!next} onClick={() => next && setPage({ sig, at: next })}>
            Next<ChevronRight className="size-4" aria-hidden />
          </Button>
        </nav>
      )}

      <DetailSheet
        def={def} row={openRow} rowIdKey={rowIdKey} onClose={() => setOpenRow(null)}
        opener={() => rowOpener(sectionRef.current, lastOpenedId.current)}
      />
    </section>
    </FocusHome.Provider>
  );
}

/* ---------- one record ---------- */

/** Row actions: `row` (the list row) gives the path value and the show rule,
 *  `record` (the full detail when loaded) names it and prefills edits. */
export function RowActions({ def, row, record, rowIdKey }: { def: ResourceDef; row: Obj; record?: Obj | null; rowIdKey: string }) {
  const source = record ?? row;
  // The show rule reads the freshest copy: the full record over the list row.
  const state = record ? { ...row, ...record } : row;
  const actions = (def.actions ?? []).filter((a) => a.scope === "row" && shows(a.show, state));
  if (actions.length === 0) return null;
  const invalidate = invalidateFor(def);
  // Keyed by operation, so when a write swaps "Switch on" for "Switch off"
  // (same operation) React keeps the same button and focus stays on it.
  const seen = new Map<string, number>();
  const keyed = actions.map((a) => {
    const n = seen.get(a.op) ?? 0;
    seen.set(a.op, n + 1);
    return { a, key: `${a.op}#${n}` };
  });
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Actions">
      {keyed.map(({ a, key }) => {
        const raw = getPath(row, a.pathFrom ?? rowIdKey);
        const pathValue = typeof raw === "string" || typeof raw === "number" ? String(raw) : null;
        const read = actionIsRead(a);
        return (
          <ResourceAction
            key={key} action={a}
            ctx={{ source, pathValue, invalidate, isRead: read, prefillFrom: read || a.prefill === false || !(a.fields ?? []).length ? null : source }}
          />
        );
      })}
    </div>
  );
}

function DetailSheet({ def, row, rowIdKey, onClose, opener }: {
  def: ResourceDef; row: Obj | null; rowIdKey: string; onClose: () => void; opener: () => HTMLElement | null;
}) {
  const home = React.useContext(FocusHome);
  const titleRef = React.useRef<HTMLDivElement | null>(null);
  const raw = row ? getPath(row, rowIdKey) : undefined;
  const id = typeof raw === "string" || typeof raw === "number" ? String(raw) : null;
  const detailOp = def.detail && row && id ? def.detail.op : null;
  const detail = useZuRead<unknown>(detailOp, detailOp ? { path: { [def.detail!.pathParam]: id! } } : undefined, { pollMs: 0 });
  const record = (detailOp ? unwrapSingle(detail.data) : null) ?? row;

  return (
    <Sheet open={!!row} onOpenChange={(v) => { if (!v) onClose(); }}>
      {/* Closing returns focus to the row's open button, found again by id after a re-read; else the panel heading. */}
      <SheetContent width="lg" onCloseAutoFocus={(e) => focusOnClose(e, opener, home)}>
        <FocusHome.Provider value={titleRef}>
        <SheetHeader>
          <div ref={titleRef} tabIndex={-1} className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-gold/40">
            <SheetTitle className="break-words">{rowName(row, def.title)}</SheetTitle>
          </div>
          <SheetDescription>{def.title}. Every field Zuops has for it.</SheetDescription>
        </SheetHeader>
        <SheetBody className="min-w-0 space-y-4">
          {detailOp && detail.error && <p role="alert" className="flex items-start gap-2 text-sm text-caution"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />Showing the list copy. {detail.error.reason}</p>}
          {detailOp && detail.loading && <p role="status" className="text-sm text-steel">Loading the full record from Zuops.</p>}
          {record && <ValueList value={record} root={detailOp ? detail.data ?? record : record} />}
        </SheetBody>
        {row && (def.actions ?? []).some((a) => a.scope === "row") && (
          <SheetFooter className="flex-wrap">
            <RowActions def={def} row={row} record={detailOp ? unwrapSingle(detail.data) : null} rowIdKey={rowIdKey} />
          </SheetFooter>
        )}
        </FocusHome.Provider>
      </SheetContent>
    </Sheet>
  );
}
