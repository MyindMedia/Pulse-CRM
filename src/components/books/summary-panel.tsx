"use client";

import * as React from "react";
import { ArrowRight } from "@untitledui/icons";
import { formatUsd } from "@/lib/books/money";
import { kpis, needsAttention, revenueMix, topExpenses, type Attention, type TabId } from "@/lib/books/view";
import type { BankRow, StatementsPayload } from "@/lib/books/types";
import { Money } from "./primitives";
import { cn } from "@/lib/utils";

/** Summary: four figures, what needs attention, revenue mix and top expenses.
   Every figure is an engine value. Bar widths are a visual scale only. */
export function SummaryPanel({
  statements,
  bank,
  onGo,
}: {
  statements: StatementsPayload;
  bank: BankRow[] | undefined;
  onGo: (a: Attention) => void;
}) {
  const figures = kpis(statements, bank);
  const attention = needsAttention(statements, bank);
  const mix = revenueMix(statements);
  const expenses = topExpenses(statements);
  const maxExpense = expenses.reduce((m, e) => Math.max(m, e.cents), 0);
  const maxRevenue = mix.reduce((m, r) => Math.max(m, r.cents), 0);

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

      <section aria-labelledby="books-attention" className="books-avoid-break">
        <h2 id="books-attention" className="font-grotesk text-base font-semibold text-bone">
          Needs attention
        </h2>
        {attention.length === 0 ? (
          <p className="mt-2 rounded-lg border border-positive/30 bg-positive/5 px-3.5 py-2.5 text-sm text-bone">
            Nothing needs attention. Every check passes and the statements match the journal.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-graphite/50 rounded-xl border border-graphite/60 bg-coal-2">
            {attention.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    a.tone === "critical" ? "bg-critical" : a.tone === "caution" ? "bg-caution" : "bg-info",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-bone">{a.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-steel">{a.detail}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onGo(a)}
                  className="books-no-print inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gold-bright hover:bg-gold/10 focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                >
                  {tabLabel(a.tab)}
                  <ArrowRight className="size-3.5" aria-hidden />
                  <span className="sr-only">for {a.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

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
