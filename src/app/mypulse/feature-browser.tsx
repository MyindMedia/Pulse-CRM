"use client";

import * as React from "react";
import { ChevronRight, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Section, Tier } from "./features";

/* The collapsible feature browser.
 *
 * Data arrives as props from the server component, so it is only serialized
 * for a visitor who has already cleared the gate. This file ships to every
 * visitor; it just holds no facts about the product.
 *
 * A rep on a call needs one thing above all: to answer "do you do X?" in
 * under three seconds. So the search box filters every section at once and
 * opens whatever matched, rather than making them remember which of fourteen
 * headings owns the answer. */

const TIERS: Tier[] = ["Studio", "Pro", "Label"];

const TIER_CLASS: Record<Tier, string> = {
  Studio: "border-hairline-2 bg-coal-3 text-steel",
  Pro: "border-gold-dim/60 bg-gold/10 text-gold",
  Label: "border-bone/25 bg-bone/10 text-bone",
};

function norm(s: string) {
  return s.toLowerCase();
}

export function FeatureBrowser({ sections }: { sections: Section[] }) {
  const [query, setQuery] = React.useState("");
  const [tier, setTier] = React.useState<Tier | null>(null);
  // Closed by default: fourteen open sections is a scroll, not a page.
  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  const q = norm(query.trim());

  const filtered = React.useMemo(() => {
    return sections
      .map((s) => {
        const sectionHit = q.length > 0 && norm(s.title).includes(q);
        const items = s.items.filter((f) => {
          if (tier && f.tier !== tier) return false;
          if (!q) return true;
          return sectionHit || norm(f.name).includes(q) || norm(f.desc).includes(q);
        });
        return { ...s, items };
      })
      .filter((s) => s.items.length > 0);
  }, [sections, q, tier]);

  const total = filtered.reduce((n, s) => n + s.items.length, 0);
  const searching = q.length > 0;

  // While searching, every surviving section is open - hunting through
  // collapsed headings for your own search results is a bad joke.
  const isOpen = (id: string) => (searching ? true : Boolean(open[id]));

  const setAll = (value: boolean) =>
    setOpen(Object.fromEntries(sections.map((s) => [s.id, value])));

  return (
    <div>
      {/* Toolbar. Sticky so the search box is reachable from anywhere in a
          list this long. */}
      <div className="sticky top-0 z-20 -mx-5 border-b border-hairline bg-ink/92 px-5 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ash-dim" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search every feature. Try payroll, splits, no-show."
              aria-label="Search features"
              className="h-10 w-full rounded-lg border border-hairline-2 bg-coal-2 pl-9 pr-9 text-sm text-bone outline-none placeholder:text-ash-dim focus:border-gold"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-ash hover:bg-coal-3 hover:text-bone"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {TIERS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTier((cur) => (cur === t ? null : t))}
                aria-pressed={tier === t}
                className={cn(
                  "h-8 rounded-lg border px-2.5 font-meta text-[11px] uppercase tracking-[0.1em] transition-colors",
                  tier === t
                    ? "border-gold bg-gold/15 text-gold"
                    : "border-hairline-2 text-ash hover:border-graphite hover:text-bone",
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span className="font-meta text-[11px] uppercase tracking-[0.1em] text-ash-dim">
              {total} shown
            </span>
            <button
              type="button"
              onClick={() => setAll(true)}
              className="font-meta text-[11px] uppercase tracking-[0.1em] text-ash transition-colors hover:text-gold"
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={() => setAll(false)}
              className="font-meta text-[11px] uppercase tracking-[0.1em] text-ash transition-colors hover:text-gold"
            >
              Collapse
            </button>
          </div>
        </div>
      </div>

      {filtered.length === 0 && (
        <p className="mt-10 text-sm text-ash">
          Nothing matches <span className="text-bone">{query}</span>. If a prospect asked
          for it, check the roadmap section at the bottom before you promise anything.
        </p>
      )}

      <div className="mt-6 space-y-2.5">
        {filtered.map((s) => {
          const openNow = isOpen(s.id);
          return (
            <section
              key={s.id}
              id={s.id}
              className="scroll-mt-24 overflow-hidden rounded-chrome border border-hairline bg-coal-2/60"
            >
              <h3>
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [s.id]: !openNow }))}
                  aria-expanded={openNow}
                  className="group flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-coal-3/40 sm:px-5"
                >
                  <ChevronRight
                    className={cn(
                      "mt-0.5 size-4 shrink-0 text-ash-dim transition-transform duration-200 group-hover:text-gold",
                      openNow && "rotate-90 text-gold",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-[0.95rem] font-semibold tracking-tight text-bone">
                        {s.title}
                      </span>
                      <span className="font-meta text-[11px] uppercase tracking-[0.12em] text-ash-dim">
                        {s.items.length} {s.items.length === 1 ? "feature" : "features"}
                      </span>
                    </span>
                    <span className="mt-1 block max-w-2xl text-sm leading-relaxed text-ash">
                      {s.note}
                    </span>
                  </span>
                </button>
              </h3>

              {openNow && (
                <ul className="border-t border-hairline/70">
                  {s.items.map((f) => (
                    <li
                      key={f.name}
                      className="flex flex-col gap-1.5 border-b border-hairline/40 px-4 py-3.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4 sm:px-5"
                    >
                      <span className="w-full shrink-0 text-sm font-medium text-bone sm:w-56">
                        {f.name}
                      </span>
                      <span className="flex-1 text-sm leading-relaxed text-ash">
                        {f.desc}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 self-start rounded-md border px-1.5 py-0.5 font-meta text-[10px] uppercase tracking-[0.1em]",
                          TIER_CLASS[f.tier],
                        )}
                      >
                        {f.tier}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
