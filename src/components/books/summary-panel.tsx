"use client";

import * as React from "react";
import { ArrowRight } from "@untitledui/icons";
import { formatUsd } from "@/lib/books/money";
import { aboutNotes, attentionCards, kpis, needsAttention, revenueMix, topExpenses, type Attention, type TabId } from "@/lib/books/view";
import type { BankRow, StatementsPayload } from "@/lib/books/types";
import { Money } from "./primitives";
import { cn } from "@/lib/utils";

/** Summary: four figures, what needs attention, revenue mix and top expenses.
   Every figure is an engine value. Bar widths are a visual scale only. */
export function SummaryPanel({
  statements,
  bank,
  onGo,
  printAll = false,
}: {
  statements: StatementsPayload;
  bank: BankRow[] | undefined;
  onGo: (a: Attention) => void;
  /** Full-book print: list every item and the notes, no disclosure. */
  printAll?: boolean;
}) {
  const figures = kpis(statements, bank);
  const cards = attentionCards(statements, bank);
  const all = needsAttention(statements, bank);
  const notes = aboutNotes(statements);
  const mix = revenueMix(statements);
  const expenses = topExpenses(statements);
  const maxExpense = expenses.reduce((m, e) => Math.max(m, e.cents), 0);
  const maxRevenue = mix.reduce((m, r) => Math.max(m, r.cents), 0);

  const itemList = (items: Attention[]) => (
    <ul className="divide-y divide-graphite/50 rounded-xl border border-graphite/60 bg-coal-2">
      {items.map((a) => (
        <li key={a.id} className="flex items-start gap-3 px-4 py-3">
          <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", a.tone === "critical" ? "bg-critical" : a.tone === "caution" ? "bg-caution" : "bg-info")} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-bone">{a.title}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-steel">{a.detail}</p>
          </div>
          <LinkButton onClick={() => onGo(a)} label={tabLabel(a.tab)} sr={a.title} />
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {figures.map((k) => {
          const differs = k.reportedCents !== null && k.reportedCents !== k.journalCents;
          return (
            <div key={k.id} className="books-avoid-break rounded-xl border border-graphite/60 bg-coal-2 p-4">
              <dt className="overline">{k.label}</dt>
              <dd className="mt-2 font-grotesk text-2xl font-semibold tracking-tight text-bone tabular-nums sm:text-[1.75rem]">
                {formatUsd(k.journalCents)}
              </dd>
              <dd className="mt-1 text-xs text-steel">{k.note}</dd>
              {k.reportedCents !== null && (
                <dd className="mt-2 border-t border-graphite/50 pt-2 text-xs text-steel">
                  Statements: <Money cents={k.reportedCents} usd className="text-bone" />
                  {differs && <span className="ml-1 text-caution">(differs)</span>}
                </dd>
              )}
            </div>
          );
        })}
      </dl>

      <section aria-labelledby="books-attention" className="space-y-3">
        <h2 id="books-attention" className="font-grotesk text-base font-semibold text-bone">
          Needs attention
        </h2>
        {cards.length === 0 ? (
          <p className="rounded-lg border border-positive/30 bg-positive/5 px-3.5 py-2.5 text-sm text-bone">
            Nothing needs attention. Every check passes and the statements match the journal.
          </p>
        ) : (
          <ul className="grid gap-2">
            {cards.map((c) => (
              <li key={c.id} className="books-avoid-break flex items-center gap-3 rounded-xl border border-graphite/60 bg-coal-2 px-4 py-3">
                <span aria-hidden className={cn("size-2 shrink-0 rounded-full", c.tone === "critical" ? "bg-critical" : "bg-caution")} />
                <p className="min-w-0 flex-1 text-sm text-bone">{c.text}</p>
                <LinkButton
                  onClick={() => onGo({ id: c.id, tone: c.tone, title: c.text, detail: c.text, tab: c.tab, filter: c.filter })}
                  label={tabLabel(c.tab)}
                  sr={c.text}
                />
              </li>
            ))}
          </ul>
        )}

        {all.length > 0 &&
          (printAll ? (
            itemList(all)
          ) : (
            <details className="books-no-print group rounded-lg">
              <summary className="cursor-pointer select-none rounded-md px-1 py-1.5 text-sm text-gold-bright hover:underline focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none">
                Show all ({all.length})
              </summary>
              <div className="mt-2">{itemList(all)}</div>
            </details>
          ))}
      </section>

      {notes.length > 0 && (
        <details className="text-sm text-steel" open={printAll}>
          <summary className="cursor-pointer select-none text-xs text-steel hover:text-bone">About these books ({notes.length})</summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 leading-relaxed">
            {notes.map((n) => (
              <li key={n.code + n.message.slice(0, 20)}>{n.message}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="books-stack grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="books-mix" className="books-avoid-break rounded-xl border border-graphite/60 bg-coal-2 p-4">
          <h2 id="books-mix" className="font-grotesk text-base font-semibold text-bone">
            Revenue mix
          </h2>
          <ul className="mt-3 space-y-3">
            {mix.map((r) => (
              <BarRow key={r.key} label={r.label} cents={r.cents} scale={maxRevenue} />
            ))}
            {mix.length === 0 && <li className="text-sm text-steel">No revenue this month.</li>}
          </ul>
        </section>
        <section aria-labelledby="books-top" className="books-avoid-break rounded-xl border border-graphite/60 bg-coal-2 p-4">
          <h2 id="books-top" className="font-grotesk text-base font-semibold text-bone">
            Top expenses
          </h2>
          <ul className="mt-3 space-y-3">
            {expenses.map((e) => (
              <BarRow key={e.key} label={e.label} cents={e.cents} scale={maxExpense} />
            ))}
            {expenses.length === 0 && <li className="text-sm text-steel">No expenses this month.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

function LinkButton({ onClick, label, sr }: { onClick: () => void; label: string; sr: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="books-no-print inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gold-bright hover:bg-gold/10 focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
    >
      {label}
      <ArrowRight className="size-3.5" aria-hidden />
      <span className="sr-only">for {sr}</span>
    </button>
  );
}

function tabLabel(tab: TabId): string {
  switch (tab) {
    case "journal":
      return "Journal";
    case "balanceSheet":
      return "Balance Sheet";
    case "incomeStatement":
      return "Income";
    case "cashFlow":
      return "Cash Flow";
    case "checks":
      return "Checks";
    default:
      return "Open";
  }
}

function BarRow({ label, cents, scale }: { label: string; cents: number; scale: number }) {
  const pct = scale > 0 ? Math.max(2, Math.round((cents / scale) * 100)) : 0;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-bone">{label}</span>
        <Money cents={cents} usd className="shrink-0 text-bone" />
      </div>
      <div className="books-bar mt-1.5 h-1.5 overflow-hidden rounded-full bg-coal-3" aria-hidden>
        <div className="books-bar-fill h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
      </div>
    </li>
  );
}
