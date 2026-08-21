"use client";

import * as React from "react";
import { Search, X, Filter } from "lucide-react";
import { SERVICE_TINT, SERVICE_LABEL, STALE_AFTER_DAYS, daysSince, type Opportunity } from "./constants";
import { cn } from "@/lib/utils";

/* Filtering the board.

   Thirty-five deals across six columns is more than anyone reads at once. The
   three questions actually asked of a pipeline are "whose is this", "what kind
   of work", and "what have I dropped", so those are the three filters.

   Everything runs client-side against data already loaded. A filter that costs
   a round trip stops feeling like a filter. */

export type PipelineFilter = {
  query: string;
  services: string[];
  clients: string[];
  staleOnly: boolean;
};

export const EMPTY_FILTER: PipelineFilter = {
  query: "",
  services: [],
  clients: [],
  staleOnly: false,
};

export function filterDeals(deals: Opportunity[], f: PipelineFilter): Opportunity[] {
  const q = f.query.trim().toLowerCase();
  return deals.filter((d) => {
    if (q && !`${d.title} ${d.artistName}`.toLowerCase().includes(q)) return false;
    if (f.services.length && !f.services.includes(d.serviceType)) return false;
    if (f.clients.length && !f.clients.includes(d.artistName)) return false;
    if (f.staleOnly && daysSince(d.updatedAt) < STALE_AFTER_DAYS) return false;
    return true;
  });
}

export function isFiltering(f: PipelineFilter): boolean {
  return Boolean(f.query.trim() || f.services.length || f.clients.length || f.staleOnly);
}

export function PipelineFilters({
  deals,
  value,
  onChange,
}: {
  deals: Opportunity[];
  value: PipelineFilter;
  onChange: (f: PipelineFilter) => void;
}) {
  // Only offer what is actually on the board. A filter for a service nobody
  // sells is a dead end.
  const services = React.useMemo(
    () => [...new Set(deals.map((d) => d.serviceType))].sort(),
    [deals],
  );
  const clients = React.useMemo(
    () => [...new Set(deals.map((d) => d.artistName))].sort(),
    [deals],
  );
  const staleCount = React.useMemo(
    () => deals.filter((d) => daysSince(d.updatedAt) >= STALE_AFTER_DAYS).length,
    [deals],
  );

  const toggle = (key: "services" | "clients", v: string) => {
    const list = value[key];
    onChange({
      ...value,
      [key]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v],
    });
  };

  const active = isFiltering(value);
  const shown = filterDeals(deals, value).length;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-steel/60" />
          <input
            value={value.query}
            onChange={(e) => onChange({ ...value, query: e.target.value })}
            placeholder="Search deals or clients"
            aria-label="Search the pipeline"
            className="w-full rounded-md border border-graphite/60 bg-coal/40 py-2 pl-9 pr-3 text-sm text-bone outline-none placeholder:text-steel/50 focus:border-gold"
          />
        </label>

        {/* The single most useful filter on the board: what have I dropped. */}
        <button
          type="button"
          onClick={() => onChange({ ...value, staleOnly: !value.staleOnly })}
          aria-pressed={value.staleOnly}
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2 font-meta text-[0.65rem] uppercase tracking-[0.06em] transition-colors",
            value.staleOnly
              ? "border-caution bg-caution/12 text-caution"
              : "border-graphite/60 text-steel hover:border-graphite hover:text-bone",
          )}
        >
          Needs a nudge
          <span className="font-mono tabular-nums">{staleCount}</span>
        </button>

        {active && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTER)}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-2 font-meta text-[0.65rem] uppercase tracking-[0.06em] text-steel transition-colors hover:text-bone"
          >
            <X className="size-3.5" />
            Clear
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Filter className="size-3 shrink-0 text-steel/50" aria-hidden />
        {services.map((sv) => {
          const on = value.services.includes(sv);
          return (
            <button
              key={sv}
              type="button"
              onClick={() => toggle("services", sv)}
              aria-pressed={on}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.7rem] transition-colors",
                on
                  ? "border-transparent text-bone"
                  : "border-graphite/60 text-steel hover:text-bone",
              )}
              style={on ? { background: `${SERVICE_TINT[sv] ?? "#8892A6"}33`, borderColor: SERVICE_TINT[sv] } : undefined}
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: SERVICE_TINT[sv] ?? "#8892A6" }}
                aria-hidden
              />
              {SERVICE_LABEL[sv] ?? sv}
            </button>
          );
        })}

        {clients.length > 1 && (
          <select
            value=""
            onChange={(e) => e.target.value && toggle("clients", e.target.value)}
            aria-label="Filter by client"
            className="rounded-full border border-graphite/60 bg-coal/40 px-2.5 py-1 text-[0.7rem] text-steel outline-none focus:border-gold"
          >
            <option value="">Client…</option>
            {clients.filter((c) => !value.clients.includes(c)).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}

        {value.clients.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => toggle("clients", c)}
            className="flex items-center gap-1.5 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-[0.7rem] text-bone"
          >
            {c}
            <X className="size-3" />
          </button>
        ))}
      </div>

      {active && (
        <p aria-live="polite" className="text-[0.7rem] text-steel/70">
          Showing {shown} of {deals.length} deals. The totals above still count every deal.
        </p>
      )}
    </div>
  );
}
