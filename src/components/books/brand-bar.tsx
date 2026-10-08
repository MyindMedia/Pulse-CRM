"use client";

import * as React from "react";
import { periodLabel } from "@/lib/books/money";

export type BooksBrand = { name: string; logoUrl: string | null; accentColor: string | null };

/** Logo, studio name, the legal entity line under it, and the period. Used at
 *  the top of every tab on screen, and as the repeating header when printed. */
export function BrandBar({
  brand,
  entityName,
  period,
  section,
}: {
  brand: BooksBrand;
  entityName: string | null;
  period: string;
  section?: string;
}) {
  return (
    <header className="books-print-brand flex items-center gap-4">
      {brand.logoUrl ? (
        // A dark chip behind the logo, so a light or transparent mark stays
        // visible on white paper when printed.
        <span className="books-logo-chip books-print-keep inline-flex shrink-0 items-center rounded-md bg-obsidian px-2.5 py-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={brand.logoUrl}
            alt={`${brand.name} logo`}
            className="h-9 w-auto max-w-44 object-contain object-left"
          />
        </span>
      ) : (
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-lg bg-gold font-grotesk text-lg font-semibold text-gold-ink"
        >
          {brand.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="min-w-0">
        <p className="overline">{section ? `${section} · ${periodLabel(period)}` : `Books · ${periodLabel(period)}`}</p>
        <p className="books-brand-name truncate font-grotesk text-xl font-semibold tracking-tight text-bone">{brand.name}</p>
        {entityName && <p className="truncate text-xs text-steel">{entityName}</p>}
      </div>
    </header>
  );
}

/** Wraps a tab in the print frame: brand header repeats on each page, the
 *  footer says who prepared it. On screen the frame is plain blocks. */
export function PrintFrame({
  brand,
  entityName,
  period,
  section,
  children,
}: {
  brand: BooksBrand;
  entityName: string | null;
  period: string;
  section: string;
  children: React.ReactNode;
}) {
  return (
    <table className="books-frame">
      <thead className="books-frame-head">
        <tr>
          <th scope="col" className="books-frame-head pb-3 text-left font-normal">
            <BrandBar brand={brand} entityName={entityName} period={period} section={section} />
          </th>
        </tr>
      </thead>
      <tfoot className="books-frame-foot">
        <tr>
          <td className="books-frame-foot">
            Prepared in Pulse · {brand.name} · {section} · {periodLabel(period)}
          </td>
        </tr>
      </tfoot>
      <tbody>
        <tr>
          <td>{children}</td>
        </tr>
      </tbody>
    </table>
  );
}
