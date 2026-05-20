"use client";

import Link from "next/link";
import { Disc3, Music2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { money, longDate } from "@/lib/format";
import { meta, INVOICE_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { InvoiceDetail } from "./types";

/** A document-styled rendering of an invoice - header, bill-to, line items, total. */
export function InvoiceSheet({ invoice }: { invoice: InvoiceDetail }) {
  const st = meta(INVOICE_STATUS, invoice.status);
  const paid = invoice.status === "paid";
  const overdue = invoice.status === "overdue";

  return (
    <Card className="relative overflow-hidden">
      {/* Paid stamp */}
      {paid && (
        <div
          aria-hidden
          className="pointer-events-none absolute right-6 top-20 -rotate-12 select-none sm:right-12"
        >
          <span className="rounded-md border-[3px] border-positive px-4 py-1.5 font-display text-2xl font-extrabold uppercase tracking-[0.2em] text-positive opacity-80">
            Paid
          </span>
        </div>
      )}

      {/* Top accent rule */}
      <div className="h-1 w-full bg-gold" />

      <div className="space-y-8 p-6 sm:p-8">
        {/* Studio header + invoice meta */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-md bg-gold text-gold-ink">
              <Disc3 className="size-6" />
            </span>
            <div>
              <p className="font-display text-lg font-bold tracking-tight text-bone">
                Pulse Studio
              </p>
              <p className="text-xs text-ash-dim">Lumen Recording Co.</p>
            </div>
          </div>
          <div className="text-right">
            <p className="overline">Invoice</p>
            <p className="font-mono text-base font-semibold text-bone">{invoice.number}</p>
            <div className="mt-1.5 flex justify-end">
              <Badge tone={st.tone}>{st.label}</Badge>
            </div>
          </div>
        </div>

        {/* Bill-to + dates */}
        <div className="grid gap-6 border-y border-hairline py-6 sm:grid-cols-3">
          <div>
            <p className="overline mb-1.5">Billed to</p>
            {invoice.artist ? (
              <Link
                href={`/roster/${invoice.artistId}`}
                className="font-display text-sm font-semibold text-bone hover:text-gold hover:underline"
              >
                {invoice.artist.name}
              </Link>
            ) : (
              <p className="font-display text-sm font-semibold text-bone">Unknown client</p>
            )}
            {invoice.artist?.email && (
              <p className="font-mono text-xs text-ash-dim">{invoice.artist.email}</p>
            )}
            {invoice.songTitle && (
              <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-ash">
                <Music2 className="size-3 text-gold" />
                {invoice.songTitle}
              </p>
            )}
          </div>
          <div>
            <p className="overline mb-1.5">Issued</p>
            <p className="font-mono text-sm text-bone">{longDate(invoice._creationTime)}</p>
          </div>
          <div>
            <p className="overline mb-1.5">Due</p>
            <p
              className={cn(
                "font-mono text-sm",
                overdue ? "font-semibold text-critical" : "text-bone",
              )}
            >
              {longDate(invoice.dueDate)}
            </p>
            {overdue && (
              <p className="text-[0.6875rem] font-medium text-critical">Past due</p>
            )}
            {paid && invoice.paidAt && (
              <p className="text-[0.6875rem] font-medium text-positive">
                Settled {longDate(invoice.paidAt)}
              </p>
            )}
          </div>
        </div>

        {/* Line items */}
        <div>
          <div className="overflow-hidden rounded-md border border-hairline">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-ink-2">
                <tr>
                  <th className="px-4 py-2.5 text-left font-mono text-[0.625rem] font-medium uppercase tracking-wide text-ash-dim">
                    Description
                  </th>
                  <th className="px-4 py-2.5 text-right font-mono text-[0.625rem] font-medium uppercase tracking-wide text-ash-dim">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {invoice.lineItems.map((li, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3 text-bone">{li.label}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-bone">
                      {money(li.amountCents)}
                    </td>
                  </tr>
                ))}
                {invoice.lineItems.length === 0 && (
                  <tr>
                    <td
                      colSpan={2}
                      className="px-4 py-6 text-center text-sm text-ash-dim"
                    >
                      No line items on this invoice.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="mt-4 flex justify-end">
            <div className="w-full max-w-xs space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ash">Subtotal</span>
                <span className="font-mono tabular-nums text-ash">
                  {money(invoice.amountCents)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-hairline pt-2">
                <span className="font-display text-sm font-semibold text-bone">
                  Total due
                </span>
                <span className="font-display text-xl font-bold tabular-nums text-gold">
                  {money(invoice.amountCents)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <p className="border-t border-hairline pt-5 text-xs leading-relaxed text-ash-dim">
          Payment is due by the date above. Thank you for working with Pulse Studio.
        </p>
      </div>
    </Card>
  );
}
