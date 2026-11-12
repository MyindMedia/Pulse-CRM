"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, Circle, Clock, Copy, EyeOff, ExternalLink, Minus, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { TOUCH, dateTime, money, plural } from "./crm-ui";
import type { CellFormat, ColumnDef } from "./resource-config";
import {
  answerPairs, autoColumns, extractRows, getPath, humanize, isIdKey, isIsoDate, isObj, isSecretKey, isUrl, leadWithMeaning, nameForId,
  statusTone, statusWord, summaryParts, weeklyHours, type Obj,
} from "./resource-utils";

/* How Zuops values look on screen: table cells, a definition list for one
   record (nested objects collapsible, long text wrapped, links open in a new
   tab and are never played inline), and a Copy button. */

const DASH = <span className="text-steel/70">–</span>;

const TONE_ICON = { positive: CheckCircle2, caution: Clock, critical: XCircle, info: Circle, neutral: Minus } as const;

export function StatusBadge({ value }: { value: unknown }) {
  const tone = statusTone(value);
  const Icon = TONE_ICON[tone];
  return (
    <Badge tone={tone}>
      <Icon className="size-3" aria-hidden />
      {statusWord(value)}
    </Badge>
  );
}

function YesNo({ value }: { value: boolean }) {
  return value
    ? <span className="inline-flex items-center gap-1 text-positive"><CheckCircle2 className="size-3.5" aria-hidden /><span className="text-bone">Yes</span></span>
    : <span className="inline-flex items-center gap-1 text-steel"><XCircle className="size-3.5" aria-hidden />No</span>;
}

export function ExtLink({ href, children }: { href: string; children?: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 break-all rounded-sm text-info underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-gold/40 max-sm:min-h-11">
      {children ?? href}
      <ExternalLink className="size-3 shrink-0" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function compact(v: unknown): string {
  if (Array.isArray(v)) {
    if (v.length > 0 && v.length <= 5 && v.every((x) => typeof x === "string" || typeof x === "number")) return v.join(", ");
    return plural(v.length, "item");
  }
  if (isObj(v)) {
    const { title, rest } = summaryParts(v, 2);
    if (title) return title;
    if (rest.length) return rest.map(([k, x]) => `${k}: ${x}`).join(", ");
    return plural(Object.keys(v).length, "field");
  }
  return String(v);
}

/** Answers as compact "label: value" pairs (form submissions). */
function Pairs({ value, max = 4 }: { value: unknown; max?: number }) {
  const pairs = answerPairs(value);
  if (pairs.length === 0) return DASH;
  return (
    <span className="block max-w-96 space-y-0.5">
      {pairs.slice(0, max).map(([k, v], i) => (
        <span key={i} className="block truncate" title={`${k}: ${v}`}><span className="text-steel">{k}:</span> {v}</span>
      ))}
      {pairs.length > max && <span className="block text-xs text-steel">And {plural(pairs.length - max, "more answer", "more answers")} in the record</span>}
    </span>
  );
}

/** What an id is, from its key: default_calendar_id -> "Calendar id". */
export function idLabel(key: string): string {
  const base = key.replace(/_?ids?$/, "").split("_").filter(Boolean).pop();
  return base ? `${base[0].toUpperCase()}${base.slice(1)} id` : "Id";
}

/** An id nothing at hand can name: muted, monospaced and labelled plainly. */
function IdText({ value, k = "id" }: { value: string; k?: string }) {
  return <span className="break-all font-mono text-xs text-steel"><span className="font-sans">{idLabel(k)} </span>{value}</span>;
}

/** One table cell. Unknown and nested values are shown compactly. */
export function CellValue({ value, format, noLink }: { value: unknown; format?: CellFormat; noLink?: boolean }) {
  if (value === undefined || value === null || value === "") return DASH;
  switch (format) {
    case "badge":
      return <StatusBadge value={value} />;
    case "bool":
      return <YesNo value={value === true || value === "true" || value === 1} />;
    case "money":
      return <span className="tabular-nums">{typeof value === "number" ? money(value) : String(value)}</span>;
    case "number":
      return <span className="tabular-nums">{typeof value === "number" ? value.toLocaleString("en-US") : compact(value)}</span>;
    case "percent": {
      if (typeof value !== "number") return <span>{String(value)}</span>;
      const pct = value <= 1 ? value * 100 : value;
      return <span className="tabular-nums">{`${Math.round(pct * 10) / 10}%`}</span>;
    }
    case "pairs":
      return <Pairs value={value} />;
    case "count":
      return <span className="tabular-nums">{Array.isArray(value) ? value.length : typeof value === "number" ? value : isObj(value) ? Object.keys(value).length : 1}</span>;
    case "date":
    case "datetime": {
      const ms = typeof value === "string" || typeof value === "number" ? Date.parse(String(value)) : NaN;
      if (!Number.isFinite(ms)) return <span>{compact(value)}</span>;
      return (
        <span className="whitespace-nowrap tabular-nums">
          {format === "date" ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : dateTime(ms)}
        </span>
      );
    }
    default:
      if (typeof value === "boolean") return <YesNo value={value} />;
      if (typeof value === "string" && isUrl(value) && !noLink) return <ExtLink href={value}><span className="max-w-48 truncate">{value.replace(/^https?:\/\//, "")}</span></ExtLink>;
      return <span className="block max-w-72 truncate" title={typeof value === "string" ? value : undefined}>{compact(value)}</span>;
  }
}

const MAX_ITEMS = 50;

/** Nested objects up to this many keys are shown open; bigger ones fold. */
const OPEN_FIELDS = 12;

const flatList = (v: unknown[]) => v.every((x) => x === null || typeof x !== "object");
const pairList = (v: unknown[]) => v.every((x) => Array.isArray(x) && flatList(x));

/** A list of records as compact sub-rows: name first, then a few plain values. */
function SubRows({ items, root, depth }: { items: Obj[]; root: unknown; depth: number }) {
  return (
    <ul className="space-y-1.5">
      {items.slice(0, MAX_ITEMS).map((item, i) => {
        const { title, rest } = summaryParts(item, 3);
        const nested = Object.entries(item).some(([, x]) => x !== null && typeof x === "object");
        return (
          <li key={i} className="min-w-0 break-words border-l border-graphite/50 pl-3">
            {title && <span className="font-semibold text-bone">{title}</span>}
            {rest.length > 0 && <span className="text-ash">{title ? ". " : ""}{rest.map(([k, x]) => `${k}: ${x}`).join(". ")}</span>}
            {!title && rest.length === 0 && <span className="text-steel">Nothing to show</span>}
            {nested && depth < 3 && (
              <details className="mt-1">
                <summary className={cn("cursor-pointer select-none text-xs text-steel hover:text-bone", TOUCH, "max-sm:flex max-sm:items-center")}>Everything in it</summary>
                <div className="mt-2"><ValueList value={item} depth={depth + 1} root={root} /></div>
              </details>
            )}
          </li>
        );
      })}
      {items.length > MAX_ITEMS && <li className="text-steel">And {(items.length - MAX_ITEMS).toLocaleString("en-US")} more</li>}
    </ul>
  );
}

/** A value inside a definition list. `root` is the whole answer, used to put a
 *  name on an id when the answer carries one. */
function Value({ k, v, depth, root }: { k: string; v: unknown; depth: number; root: unknown }) {
  if (isSecretKey(k) && v !== null && v !== undefined && v !== "" && typeof v !== "object") {
    return <span className="inline-flex items-center gap-1 text-steel"><EyeOff className="size-3.5" aria-hidden />Hidden</span>;
  }
  if (v === undefined || v === null || v === "") return DASH;
  if (typeof v === "boolean") return <YesNo value={v} />;
  if (typeof v === "number") return <span className="tabular-nums">{v.toLocaleString("en-US")}</span>;
  if (typeof v === "string") {
    if (isIdKey(k)) {
      const name = nameForId(root, k, v);
      return name ? <span>{name}</span> : <IdText value={v} k={k} />;
    }
    if (isUrl(v)) return <ExtLink href={v} />;
    if (isIsoDate(v) && v.length > 10) return <span className="tabular-nums">{dateTime(v)}</span>;
    if (/status|state|outcome/i.test(k) && v.length < 32) return <StatusBadge value={v} />;
    return <p className="whitespace-pre-wrap break-words">{v}</p>;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="text-steel">None</span>;
    if (isIdKey(k.replace(/s$/, "")) && v.every((x) => typeof x === "string")) {
      return <span className="flex flex-wrap gap-x-2 gap-y-1">{(v as string[]).map((x, i) => { const n = nameForId(root, "", x); return n ? <span key={i}>{n}{i < v.length - 1 ? "," : ""}</span> : <IdText key={i} value={x} k={k} />; })}</span>;
    }
    if (flatList(v)) return <p className="break-words">{v.map((x) => (typeof x === "boolean" ? (x ? "Yes" : "No") : String(x))).join(", ")}</p>;
    if (pairList(v)) return <p className="break-words">{(v as unknown[][]).map((x) => x.map(String).join(" to ")).join(", ")}</p>;
    if (v.every(isObj)) return <SubRows items={v as Obj[]} root={root} depth={depth} />;
    return <p className="break-words">{v.map((x) => compact(x)).join(", ")}</p>;
  }
  if (isObj(v)) {
    const n = Object.keys(v).length;
    if (n === 0) return <span className="text-steel">None</span>;
    const hours = weeklyHours(v);
    if (hours) {
      return (
        <dl className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3 gap-y-1">
          {hours.map(([day, text]) => (
            <React.Fragment key={day}>
              <dt className="text-steel">{day}</dt>
              <dd className={cn("tabular-nums", text === "Closed" && "text-steel")}>{text}</dd>
            </React.Fragment>
          ))}
        </dl>
      );
    }
    if (n <= OPEN_FIELDS) return <div className="border-l border-graphite/50 pl-3"><ValueList value={v} depth={depth + 1} root={root} /></div>;
    return (
      <details>
        <summary className={cn("cursor-pointer select-none text-ash hover:text-bone", TOUCH, "max-sm:flex max-sm:items-center")}>Show {plural(n, "field")}</summary>
        <div className="mt-2 border-l border-graphite/50 pl-3"><ValueList value={v} depth={depth + 1} root={root} /></div>
      </details>
    );
  }
  return <span>{String(v)}</span>;
}

/** Every field of one record as a definition list. */
export function ValueList({ value, depth = 0, only, root }: { value: Obj; depth?: number; only?: ColumnDef[]; root?: unknown }) {
  if (depth > 4) return <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(value, null, 2)}</pre>;
  const all = root ?? value;
  const entries: Array<[string, string, unknown]> = only
    ? only.map((c) => [c.key, c.label, getPath(value, c.key)])
    : [
        ...Object.entries(value).filter(([k]) => k !== "workspace_id" && !isIdKey(k)),
        ...Object.entries(value).filter(([k]) => k !== "workspace_id" && isIdKey(k)),
      ].map(([k, v]) => [k, isIdKey(k) && k !== "id" ? humanize(k.replace(/_id$/, "")) : humanize(k), v]);
  if (entries.length === 0) return <p className="text-sm text-steel">Nothing here.</p>;
  return (
    <dl className="grid min-w-0 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-[minmax(7rem,13rem)_minmax(0,1fr)]">
      {entries.map(([k, labelText, v]) => (
        <React.Fragment key={k}>
          <dt className="font-meta text-[0.6875rem] uppercase tracking-wide text-steel max-sm:mt-1">{labelText}</dt>
          <dd className="min-w-0 text-bone">
            {only?.find((c) => c.key === k)?.format && v !== undefined && v !== null
              ? <CellValue value={v} format={only.find((c) => c.key === k)!.format} />
              : <Value k={k.split("|")[0]} v={v} depth={depth} root={all} />}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** A read answer shown in a dialog: a table when it is a list of records
 *  (the config's columns when it names them, else the rows' plain values with
 *  ids left out), else the definition list. */
export function ResultView({ data, columns }: { data: unknown; columns?: ColumnDef[] }) {
  const rows = extractRows(data);
  if (rows.length > 0) {
    const cols: ColumnDef[] = columns
      ? leadWithMeaning(columns).filter((c, i) => i === 0 || rows.some((r) => { const x = getPath(r, c.key); return x !== undefined && x !== null && x !== ""; }))
      : autoColumns(rows).map((k) => ({ key: k, label: humanize(k), format: /status|state|outcome/i.test(k) ? "badge" : /_at$/.test(k) ? "datetime" : undefined }));
    const rest = isObj(data) ? Object.fromEntries(Object.entries(data).filter(([, v]) => !Array.isArray(v))) : {};
    return (
      <div className="space-y-3">
        {Object.keys(rest).length > 0 && <ValueList value={rest} />}
        <Table className="min-w-[480px]" aria-label="Answer">
          <THead><tr>{cols.map((c) => <TH key={c.key}>{c.label}</TH>)}</tr></THead>
          <TBody>
            {rows.slice(0, 100).map((r, i) => (
              <TR key={i}>{cols.map((c) => <TD key={c.key} className="align-top"><CellValue value={getPath(r, c.key)} format={c.format} /></TD>)}</TR>
            ))}
          </TBody>
        </Table>
        {rows.length > 100 && <p className="text-xs text-steel">Showing the first 100 of {rows.length}.</p>}
      </div>
    );
  }
  if (isObj(data)) return <ValueList value={data} />;
  if (data === undefined || data === null) return <p className="text-sm text-steel">Done. Zuops sent nothing back to show.</p>;
  return <p className="whitespace-pre-wrap break-words text-sm">{String(data)}</p>;
}

/** Copy to the clipboard from inside the click; if the browser refuses, select
 *  the text so the person can copy it by hand. */
export function CopyButton({ text, targetRef, label = "Copy" }: { text: string; targetRef?: React.RefObject<HTMLElement | null>; label?: string }) {
  const selectTarget = () => {
    const el = targetRef?.current;
    if (!el) return;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.focus();
      el.select();
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };
  const click = () => {
    const fallback = () => {
      selectTarget();
      toast.message("Selected. Press Command C or Control C to copy.");
    };
    try {
      const p = navigator.clipboard?.writeText(text);
      if (!p) { fallback(); return; }
      p.then(() => toast.success("Copied"), fallback);
    } catch {
      fallback();
    }
  };
  return (
    <Button type="button" variant="secondary" size="sm" className={TOUCH} onClick={click}>
      <Copy className="size-3.5" aria-hidden />
      {label}
    </Button>
  );
}
