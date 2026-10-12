"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Brackets } from "@/components/shell/page-header-slot";

/* Building blocks for the hardware overview (kit sections 3 and 4). The
 * skins live in src/app/hardware.css; these only arrange them. */

/** A chassis: the raised graphite panel every overview card sits in. */
export function Chassis({
  className,
  grid,
  brackets = false,
  children,
  ...rest
}: React.HTMLAttributes<HTMLElement> & { grid?: boolean; brackets?: boolean }) {
  // Brackets belong to the hero chassis only (and the shell's sidebar and
  // top bar); the kit leaves every other chassis bare.
  return (
    <section className={cn("pl-card relative flex min-w-0 flex-1 flex-col px-6 pb-6 pt-5", grid && "pl-grid", className)} {...rest}>
      {brackets && <Brackets />}
      {children}
    </section>
  );
}

/** Chassis heading: optional kicker chip, h2 title, the short yellow bar,
 *  and actions on the right. */
export function ChassisTitle({
  kicker,
  title,
  bar = true,
  right,
}: {
  kicker?: React.ReactNode;
  title: React.ReactNode;
  bar?: boolean;
  right?: React.ReactNode;
}) {
  return (
    /* Actions stay beside the title while it keeps at least 8rem; past that
       they wrap under it rather than pushing off a phone screen. */
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-32">
        {kicker && <div className="mb-2.5">{kicker}</div>}
        <h2 className="truncate font-sans text-base font-bold! leading-[22px] tracking-[-0.01em] text-bone">{title}</h2>
        {bar && <span className="pl-bar mt-2.5 w-12" aria-hidden />}
      </div>
      {right && <div className="flex max-w-full items-center gap-2">{right}</div>}
    </div>
  );
}

/** A KPI readout in a well: label + LED, mono figure, then a signed change
 *  or a context line. `highlight` lights the LED and turns the figure yellow
 *  (one per screen). */
export function StatTile({
  label,
  value,
  highlight,
  foot,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  foot?: React.ReactNode;
}) {
  return (
    <div className="pl-well pl-stat min-w-0 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="pl-label truncate">{label}</span>
        <span className="pl-led" data-on={highlight ? "true" : undefined} aria-hidden />
      </div>
      <p
        className={cn(
          "pl-stat-figure mt-2.5 truncate font-mono text-[30px] font-medium leading-[34px] tracking-[-0.02em] tabular-nums",
          highlight ? "text-gold" : "text-bone",
        )}
      >
        {value}
      </p>
      <div className="pl-stat-foot mt-2.5 min-h-4 truncate font-mono text-xs leading-4 text-steel">{foot}</div>
    </div>
  );
}

/** A signed change with its arrow; the word "vs …" stays muted. Status never
 *  relies on colour alone: the sign and arrow carry it. */
export function Delta({ value, against }: { value: number | null | undefined; against?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const up = value >= 0;
  const pct = `${up ? "+" : "−"}${Math.abs(value * 100).toFixed(1)}%`;
  return (
    <span>
      <span className={up ? "text-positive" : "text-critical"}>
        {up ? "▲" : "▼"} {pct}
      </span>
      {against && <span className="text-steel"> vs {against}</span>}
    </span>
  );
}

/** Segmented keys in a well (Tabs / Segmented in the kit). */
export function KeyBank<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  function onKeyDown(e: React.KeyboardEvent, i: number) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }
  return (
    <div role="radiogroup" aria-label={label} className="pl-well inline-flex items-center gap-0.5 p-[3px]">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, i)}
            data-on={on ? "true" : undefined}
            onClick={() => onChange(o.value)}
            className={cn(
              "pl-bank-key flex h-[30px] items-center gap-1.5 rounded-[4px] px-3 font-sans text-[13px] font-bold transition-colors",
              !on && "text-mist hover:text-bone",
            )}
          >
            {on && <span className="pl-led" data-on="true" aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Progress groove: yellow for the focus, metal for context. */
export function Groove({
  value,
  tone = "metal",
  knob,
}: {
  value: number;
  tone?: "yellow" | "metal" | "copper";
  knob?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="pl-groove relative h-1.5" aria-hidden>
      <div className="pl-groove-fill absolute inset-y-0 left-0" data-tone={tone} style={{ width: `${pct}%` }} />
      {knob && <span className="pl-knob absolute top-1/2" style={{ left: `${pct}%` }} />}
    </div>
  );
}

/** Empty well: one caption line and at most one key (kit 5.4). */
export function EmptyWell({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="pl-well flex flex-1 flex-col items-center justify-center gap-3 px-4 py-6 text-center text-sm text-steel">
      <p>{children}</p>
      {action}
    </div>
  );
}

/* ── Formatting (kit section 9: exact figures, mono, signed changes) ── */

/** $1,250.00 with cents, or $48,250 without. */
export function usd(cents: number, opts?: { cents?: boolean }) {
  const withCents = opts?.cents ?? false;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: withCents ? 2 : 0,
    maximumFractionDigits: withCents ? 2 : 0,
  }).format(cents / 100);
}

/** 24-hour clock time: 15:00. */
export function hhmm(ts: number) {
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Elapsed time as 02:14:37. */
export function elapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/** The short month name for "vs Sep". */
export function lastMonthName(now = Date.now()) {
  const d = new Date(now);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleDateString("en-US", { month: "short" });
}

/** A clock that re-renders every `ms` (for the elapsed timer). Null until
 *  mounted, so the server render and the first client render agree. */
export function useNow(ms = 1000): number | null {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
