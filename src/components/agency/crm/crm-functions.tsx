"use client";

import * as React from "react";
import { AlertTriangle, Eye, KeyRound, PenLine, RefreshCw, Search, SearchX, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingPanel } from "@/components/ui/feedback";
import { Input, Label } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { TOUCH } from "./crm-ui";
import {
  ALL, KINDS, KIND_LABEL, LEVEL_LABEL, NO_KIND, areaCounts, catalogStats, filterCatalog, groupByArea,
  type CatalogEntry, type CatalogFilter, type CatalogLevel,
} from "./functions-catalog";
import { KindIcon } from "./functions-kind";
import type { OpFormProps } from "./crm-op-form";
import { FocusHome, focusOnClose, rowOpener } from "./resource-focus";

/* Functions: every Zuops operation, searchable by name, path and area, filtered
   by area and access level, grouped by area with counts. Selecting one opens its
   form. This file stays light: the registry-built catalog and the form are
   loaded with import() on mount, so the registry is its own chunk (eval P-04).
   Every run goes through the same gated Convex action as the other tabs. */

type Loaded = { catalog: CatalogEntry[]; OpForm: React.ComponentType<OpFormProps> };

const LEVEL_ICON: Record<CatalogLevel, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  read: Eye, write: PenLine, admin: KeyRound,
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CrmFunctions() {
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    Promise.all([import("./crm-op-form-catalog"), import("./crm-op-form")])
      .then(([c, f]) => { if (live) setLoaded({ catalog: c.CATALOG, OpForm: f.OpForm }); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [attempt]);

  if (failed && !loaded) {
    return (
      <div role="alert">
        <EmptyState
          icon={AlertTriangle} title="Could not load the functions" description="Check your connection and try again."
          action={<Button type="button" variant="secondary" size="sm" className={TOUCH} onClick={() => { setFailed(false); setAttempt((n) => n + 1); }}><RefreshCw className="size-3.5" aria-hidden />Retry</Button>}
        />
      </div>
    );
  }
  if (!loaded) return <LoadingPanel label="Loading every Zuops function" />;
  return <Catalog catalog={loaded.catalog} OpForm={loaded.OpForm} />;
}

function Catalog({ catalog, OpForm }: Loaded) {
  const [q, setQ] = React.useState("");
  const query = useDebounced(q, 150);
  const [area, setArea] = React.useState<string>(ALL);
  const [lv, setLv] = React.useState<CatalogFilter["level"]>(ALL);
  const [kd, setKd] = React.useState<NonNullable<CatalogFilter["kind"]>>(ALL);
  const [openId, setOpenId] = React.useState<string | null>(null);
  // Focus goes back to the row that opened the form when it closes (U-10), or
  // to the heading when filtering since has removed that row.
  const lastOpened = React.useRef<string | null>(null);
  const sectionRef = React.useRef<HTMLElement | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const titleRef = React.useRef<HTMLDivElement | null>(null);

  const stats = React.useMemo(() => catalogStats(catalog), [catalog]);
  const areas = React.useMemo(() => Object.entries(areaCounts(catalog)).sort(([a], [b]) => a.localeCompare(b)), [catalog]);
  const shown = React.useMemo(() => filterCatalog(catalog, { q: query, area, level: lv, kind: kd }), [catalog, query, area, lv, kd]);
  const groups = React.useMemo(() => groupByArea(shown), [shown]);
  const open = openId ? catalog.find((e) => e.id === openId) ?? null : null;
  const filtering = query.trim() !== "" || area !== ALL || lv !== ALL || kd !== ALL;

  return (
    <section ref={sectionRef} className="space-y-4" aria-label="Zuops functions">
      <header className="space-y-1">
        <h2 ref={headingRef} tabIndex={-1} className="rounded-sm font-grotesk text-lg font-semibold text-bone outline-none focus-visible:ring-2 focus-visible:ring-gold/40">Functions</h2>
        <p className="text-sm text-steel">
          Every function Zuops offers, {stats.total} in {stats.areas} areas. Each runs through the same checks as the other tabs:
          writes are off where this deployment is read only, Full access functions need a Full access key, and anything that reaches people, changes automatic sending, uses credits, sends data outside the account or deletes asks you first.
        </p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1 space-y-1 sm:min-w-56">
          <Label htmlFor="crm-fn-search">Search functions</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel/70" aria-hidden />
            <Input id="crm-fn-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} className={cn("pl-9", TOUCH)} placeholder="Name, path or area" />
          </div>
        </div>
        <div className="min-w-0 space-y-1 sm:w-56">
          <Label htmlFor="crm-fn-area">Area</Label>
          <Select value={area} onValueChange={setArea}>
            <SelectTrigger id="crm-fn-area" className={TOUCH}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Every area ({stats.total})</SelectItem>
              {areas.map(([a, n]) => <SelectItem key={a} value={a}>{a} ({n})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1 sm:w-44">
          <Label htmlFor="crm-fn-level">Access level</Label>
          <Select value={lv} onValueChange={(v) => setLv(v as CatalogFilter["level"])}>
            <SelectTrigger id="crm-fn-level" className={TOUCH}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any level</SelectItem>
              {(["read", "write", "admin"] as const).map((l) => <SelectItem key={l} value={l}>{LEVEL_LABEL[l]} ({stats.byLevel[l]})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1 sm:w-60">
          <Label htmlFor="crm-fn-kind">Asks first because it</Label>
          <Select value={kd} onValueChange={(v) => setKd(v as NonNullable<CatalogFilter["kind"]>)}>
            <SelectTrigger id="crm-fn-kind" className={TOUCH}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any</SelectItem>
              {KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]} ({stats.byKind[k]})</SelectItem>)}
              <SelectItem value={NO_KIND}>Never asks first ({stats.byKind.none})</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p role="status" aria-live="polite" className="font-meta text-xs uppercase tracking-wide text-steel">
        {filtering ? `Showing ${shown.length} of ${stats.total}` : `${stats.total} functions`}
      </p>

      {groups.length === 0 ? (
        <EmptyState
          icon={SearchX} title="No function matches" description="Try another word, or clear the filters."
          action={<Button type="button" variant="secondary" size="sm" className={TOUCH} onClick={() => { setQ(""); setArea(ALL); setLv(ALL); setKd(ALL); }}>Clear filters</Button>}
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.area} aria-labelledby={`fn-area-${slug(g.area)}`} className="space-y-2">
              <h3 id={`fn-area-${slug(g.area)}`} className="font-meta text-xs font-semibold uppercase tracking-wide text-ash">
                {g.area} <span className="text-steel">({g.entries.length})</span>
              </h3>
              <ul className="divide-y divide-hairline overflow-hidden rounded-xl border border-graphite/50">
                {g.entries.map((e) => <Row key={e.id} entry={e} onOpen={() => { lastOpened.current = e.id; setOpenId(e.id); }} />)}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Sheet open={!!open} onOpenChange={(v) => { if (!v) setOpenId(null); }}>
        <SheetContent width="lg" onCloseAutoFocus={(e) => focusOnClose(e, () => rowOpener(sectionRef.current, lastOpened.current), headingRef)}>
          {open && (
            <FocusHome.Provider value={titleRef}>
              <SheetHeader>
                <div ref={titleRef} tabIndex={-1} className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-gold/40">
                  <SheetTitle className="break-words">{open.summary}</SheetTitle>
                </div>
                <SheetDescription className="break-all font-mono text-xs">{open.id}</SheetDescription>
              </SheetHeader>
              <SheetBody className="min-w-0">
                <OpForm key={open.id} opId={open.id} />
              </SheetBody>
            </FocusHome.Provider>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function Row({ entry, onOpen }: { entry: CatalogEntry; onOpen: () => void }) {
  const LevelIcon = LEVEL_ICON[entry.level];
  return (
    <li>
      <button
        type="button" onClick={onOpen} data-row-open={entry.id}
        className="flex w-full min-w-0 flex-col gap-1.5 px-4 py-3 text-left outline-none transition-colors hover:bg-coal-2 focus-visible:bg-coal-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold/40 sm:flex-row sm:items-center sm:gap-3"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-bone">{entry.summary}</span>
          <span className="block break-all font-mono text-xs text-steel"><span className="text-ash">{entry.method}</span> {entry.path}</span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          <Badge tone={entry.level === "read" ? "info" : entry.level === "write" ? "positive" : "gold"}>
            <LevelIcon className="size-3" aria-hidden />{LEVEL_LABEL[entry.level]}
          </Badge>
          {entry.kind && <Badge tone={entry.kind === "delete" ? "critical" : "caution"}><KindIcon kind={entry.kind} />{KIND_LABEL[entry.kind]}</Badge>}
          {!entry.kind && entry.dependsOnBody && <Badge tone="caution"><SlidersHorizontal className="size-3" aria-hidden />Asks first for some values</Badge>}
        </span>
      </button>
    </li>
  );
}
