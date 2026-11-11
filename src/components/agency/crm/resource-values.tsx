"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, Circle, Clock, Copy, EyeOff, ExternalLink, Minus, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { TOUCH, dateTime, money } from "./crm-ui";
import type { CellFormat, ColumnDef } from "./resource-config";
import {
  extractRows, getPath, humanize, isIsoDate, isObj, isSecretKey, isUrl, statusTone, statusWord, type Obj,
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
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 break-all text-info underline-offset-2 hover:underline">
      {children ?? href}
      <ExternalLink className="size-3 shrink-0" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function compact(v: unknown): string {
  if (Array.isArray(v)) return `${v.length} ${v.length === 1 ? "item" : "items"}`;
  if (isObj(v)) {
    const named = getPath(v, "name|label|title|full_name|id");
    return typeof named === "string" ? named : `${Object.keys(v).length} fields`;
  }
  return String(v);
}

/** One table cell. Unknown and nested values are shown compactly. */
export function CellValue({ value, format }: { value: unknown; format?: CellFormat }) {
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
      if (typeof value === "string" && isUrl(value)) return <ExtLink href={value}><span className="max-w-48 truncate">{value.replace(/^https?:\/\//, "")}</span></ExtLink>;
      return <span className="block max-w-72 truncate" title={typeof value === "string" ? value : undefined}>{compact(value)}</span>;
  }
}

const MAX_ITEMS = 50;

/** A value inside a definition list. */
function Value({ k, v, depth }: { k: string; v: unknown; depth: number }) {
  if (isSecretKey(k) && v !== null && v !== undefined && v !== "") {
    return <span className="inline-flex items-center gap-1 text-steel"><EyeOff className="size-3.5" aria-hidden />Hidden</span>;
  }
  if (v === undefined || v === null || v === "") return DASH;
  if (typeof v === "boolean") return <YesNo value={v} />;
  if (typeof v === "number") return <span className="tabular-nums">{v.toLocaleString("en-US")}</span>;
  if (typeof v === "string") {
    if (isUrl(v)) return <ExtLink href={v} />;
    if (isIsoDate(v) && v.length > 10) return <span className="tabular-nums">{dateTime(v)}</span>;
    if (/status|state|outcome/i.test(k) && v.length < 32) return <StatusBadge value={v} />;
    return <p className="whitespace-pre-wrap break-words">{v}</p>;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="text-steel">None</span>;
    if (v.every((x) => x === null || typeof x !== "object")) return <p className="break-words">{v.map((x) => String(x)).join(", ")}</p>;
    return (
      <details className="group">
        <summary className={cn("cursor-pointer select-none text-ash hover:text-bone", TOUCH, "max-sm:flex max-sm:items-center")}>{v.length} {v.length === 1 ? "item" : "items"}</summary>
        <ol className="mt-2 space-y-3 border-l border-graphite/50 pl-3">
          {v.slice(0, MAX_ITEMS).map((item, i) => (
            <li key={i}>{isObj(item) ? <ValueList value={item} depth={depth + 1} /> : String(item)}</li>
          ))}
          {v.length > MAX_ITEMS && <li className="text-steel">And {v.length - MAX_ITEMS} more</li>}
        </ol>
      </details>
    );
  }
  if (isObj(v)) {
    const n = Object.keys(v).length;
    if (n === 0) return <span className="text-steel">None</span>;
    return (
      <details>
        <summary className={cn("cursor-pointer select-none text-ash hover:text-bone", TOUCH, "max-sm:flex max-sm:items-center")}>{compact(v)}</summary>
        <div className="mt-2 border-l border-graphite/50 pl-3"><ValueList value={v} depth={depth + 1} /></div>
      </details>
    );
  }
  return <span>{String(v)}</span>;
}

/** Every field of one record as a definition list. */
export function ValueList({ value, depth = 0, only }: { value: Obj; depth?: number; only?: ColumnDef[] }) {
  if (depth > 4) return <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(value, null, 2)}</pre>;
  const entries: Array<[string, string, unknown]> = only
    ? only.map((c) => [c.key, c.label, getPath(value, c.key)])
    : Object.entries(value).filter(([k]) => k !== "workspace_id").map(([k, v]) => [k, humanize(k), v]);
  if (entries.length === 0) return <p className="text-sm text-steel">Nothing here.</p>;
  return (
    <dl className="grid min-w-0 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-[minmax(7rem,13rem)_minmax(0,1fr)]">
      {entries.map(([k, labelText, v]) => (
        <React.Fragment key={k}>
          <dt className="font-meta text-[0.6875rem] uppercase tracking-wide text-steel max-sm:mt-1">{labelText}</dt>
          <dd className="min-w-0 text-bone">
            {only?.find((c) => c.key === k)?.format && v !== undefined && v !== null
              ? <CellValue value={v} format={only.find((c) => c.key === k)!.format} />
              : <Value k={k.split("|")[0]} v={v} depth={depth} />}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** A read answer shown in a dialog: a table when it is a list of records, else
 *  the definition list. */
export function ResultView({ data }: { data: unknown }) {
  const rows = extractRows(data);
  if (rows.length > 0) {
    const keys = [...new Set(rows.slice(0, 20).flatMap((r) => Object.keys(r)))]
      .filter((k) => k !== "workspace_id" && !isSecretKey(k) && rows.some((r) => r[k] !== null && typeof r[k] !== "object"))
      .slice(0, 6);
    const rest = isObj(data) ? Object.fromEntries(Object.entries(data).filter(([, v]) => !Array.isArray(v))) : {};
    return (
      <div className="space-y-3">
        {Object.keys(rest).length > 0 && <ValueList value={rest} />}
        <Table className="min-w-[480px]" aria-label="Answer">
          <THead><tr>{keys.map((k) => <TH key={k}>{humanize(k)}</TH>)}</tr></THead>
          <TBody>
            {rows.slice(0, 100).map((r, i) => (
              <TR key={i}>{keys.map((k) => <TD key={k}><CellValue value={r[k]} format={/status|state|outcome/i.test(k) ? "badge" : /_at$/.test(k) ? "datetime" : undefined} /></TD>)}</TR>
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
