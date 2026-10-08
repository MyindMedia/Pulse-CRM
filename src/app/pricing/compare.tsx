"use client";

import * as React from "react";
import { Check, ChevronDown, Minus } from "@untitledui/icons";
import { PRICING, TIERS } from "@convex/lib/pricing";
import type { ComparisonGroup } from "./model";

/* The Compare plans table. Each group is a <details> (as before) and each
   feature row is a disclosure: a real <button> with aria-expanded and
   aria-controls that opens a panel under the row saying what the feature is,
   what it does and which plan has it. Several rows can be open at once, and
   each group has an Expand all / Collapse all control.

   The panel sits in a second table row that spans all four columns, so the
   fixed column widths never move. It animates with grid-template-rows
   (0fr to 1fr), which gives a smooth height change with no measuring, and
   the animation is switched off under prefers-reduced-motion. A closed panel
   is `invisible`, so it is out of the tab order and hidden from screen
   readers until it opens. */

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";
const focusRingInset =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold";

function CompareGroupCard({ group, defaultOpen }: { group: ComparisonGroup; defaultOpen: boolean }) {
  const uid = React.useId();
  const [open, setOpen] = React.useState<ReadonlySet<number>>(() => new Set());
  const allOpen = open.size === group.rows.length;

  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const toggleAll = () =>
    setOpen(allOpen ? new Set() : new Set(group.rows.map((_, i) => i)));

  return (
    <details
      open={defaultOpen}
      className="group overflow-hidden rounded-chrome border border-hairline-2 bg-coal/70 open:border-gold/40"
    >
      <summary
        className={`flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 sm:px-5 [&::-webkit-details-marker]:hidden ${focusRing}`}
      >
        <span className="font-grotesk text-base font-semibold text-bone">
          {group.title}
          <span className="ml-2 font-meta text-xs font-normal uppercase tracking-[0.06em] text-steel">
            {group.rows.length} {group.rows.length === 1 ? "feature" : "features"}
          </span>
        </span>
        <ChevronDown
          className="size-5 shrink-0 text-gold transition-transform duration-200 motion-reduce:transition-none group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-2 sm:px-5">
        <p className="font-grotesk text-xs text-steel">Tap a feature to see what it is and what it does.</p>
        <button
          type="button"
          onClick={toggleAll}
          className={`shrink-0 rounded-chrome px-2 py-1 font-meta text-xs font-medium uppercase tracking-[0.06em] text-gold transition-colors hover:text-gold-bright ${focusRing}`}
        >
          {allOpen ? "Collapse all" : "Expand all"}
          <span className="sr-only"> in {group.title}</span>
        </button>
      </div>
      <table className="w-full table-fixed border-collapse text-left font-grotesk text-sm">
        <caption className="sr-only">{group.title}, by plan</caption>
        <thead>
          <tr className="border-t border-hairline bg-coal-2">
            <th scope="col" className="px-4 py-2.5 font-meta text-xs font-medium uppercase tracking-[0.06em] text-steel sm:px-5">
              Feature
            </th>
            {TIERS.map((t) => (
              <th
                key={t}
                scope="col"
                className={`w-16 px-1 py-2.5 text-center text-xs font-semibold sm:w-28 sm:text-sm ${PRICING[t].highlight ? "text-gold" : "text-bone"}`}
              >
                {PRICING[t].name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {group.rows.map((r, ri) => {
            const isOpen = open.has(ri);
            const btnId = `${uid}-b${ri}`;
            const panelId = `${uid}-p${ri}`;
            return (
              <React.Fragment key={`${r.name}-${ri}`}>
                <tr className="border-t border-hairline/70">
                  <th scope="row" className="p-0 font-normal text-bone">
                    <button
                      type="button"
                      id={btnId}
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => toggle(ri)}
                      className={`flex w-full items-center justify-start gap-2 px-4 py-3 text-left transition-colors hover:text-gold sm:px-5 ${focusRingInset}`}
                    >
                      <span>{r.name}</span>
                      <ChevronDown
                        className={`size-4 shrink-0 text-gold transition-transform duration-200 motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`}
                        aria-hidden
                      />
                    </button>
                  </th>
                  {TIERS.map((t) => (
                    <td key={t} className="px-1 py-3 text-center">
                      {r.included[t] ? (
                        <>
                          <Check className="mx-auto size-5 text-gold" aria-hidden />
                          <span className="sr-only">Included</span>
                        </>
                      ) : (
                        <>
                          <Minus className="mx-auto size-4 text-slate" aria-hidden />
                          <span className="sr-only">Not included</span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td colSpan={TIERS.length + 1} className="p-0">
                    <div
                      id={panelId}
                      role="region"
                      aria-labelledby={btnId}
                      className={`grid transition-[grid-template-rows,visibility] duration-200 ease-out motion-reduce:transition-none ${isOpen ? "visible grid-rows-[1fr]" : "invisible grid-rows-[0fr]"}`}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <div className="space-y-3 border-t border-hairline/70 bg-coal-2 px-4 py-4 sm:px-5">
                          <div>
                            <p className="font-meta text-xs font-medium uppercase tracking-[0.06em] text-steel">What it is</p>
                            <p className="mt-1 text-sm leading-relaxed text-mist">{r.detail.what}</p>
                          </div>
                          <div>
                            <p className="font-meta text-xs font-medium uppercase tracking-[0.06em] text-steel">What it does</p>
                            <p className="mt-1 text-sm leading-relaxed text-mist">{r.detail.does}</p>
                          </div>
                          <div>
                            <p className="font-meta text-xs font-medium uppercase tracking-[0.06em] text-steel">Which plans</p>
                            <p className="mt-1 text-sm leading-relaxed text-mist">{r.detail.tiers}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}

export function CompareGroups({ groups }: { groups: ComparisonGroup[] }) {
  return (
    <div className="mt-10 space-y-3">
      {groups.map((g, gi) => (
        <CompareGroupCard key={g.id} group={g} defaultOpen={gi === 0} />
      ))}
    </div>
  );
}
