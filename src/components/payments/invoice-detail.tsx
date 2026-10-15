"use client";

import Link from "next/link";
import type { Id } from "@convex/_generated/dataModel";
import { Receipt, User, Music2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InvoiceSheet } from "@/components/payments/invoice-sheet";
import { StatusTimeline } from "@/components/payments/status-timeline";
import { InvoiceActions } from "@/components/payments/invoice-actions";
import { InvoiceActivity } from "@/components/payments/invoice-activity";
import type { InvoiceDetail, ActivityRow } from "@/components/payments/types";
import { SessionLink, DRILL_FOCUS } from "@/components/shell/entity-link";
import { cn } from "@/lib/utils";

const LINK_ROW =
  "flex items-center gap-2.5 rounded-md border border-graphite/50 bg-coal-2 px-3 py-2.5 transition-colors hover:border-graphite/60 hover:bg-coal-3";

/** Everything about one invoice: the document itself, then its lifecycle,
 *  actions, linked records and activity. The full page (/payments/[id]) and
 *  the centered invoice modal both render this, so they never drift. */
export function InvoiceDetailView({
  invoice,
  activity,
  onDeleted,
}: {
  invoice: InvoiceDetail;
  activity: ActivityRow[] | undefined;
  onDeleted?: () => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {/* The invoice document */}
      <div className="min-w-0">
        <InvoiceSheet invoice={invoice} />
      </div>

      {/* Side panel: timeline, actions, links, activity */}
      <aside className="min-w-0 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Lifecycle</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusTimeline status={invoice.status} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <InvoiceActions
              id={invoice._id as Id<"invoices">}
              number={invoice.number}
              status={invoice.status}
              amountCents={invoice.amountCents}
              onDeleted={onDeleted}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Linked records</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href={`/roster/${invoice.artistId}`} data-drill="artist" className={cn(DRILL_FOCUS, LINK_ROW)}>
              <span className="grid size-7 place-items-center rounded-md bg-coal-3 text-steel/70">
                <User className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">Client</span>
                <span className="block truncate text-sm font-medium text-bone">{invoice.artist?.name ?? "Unknown"}</span>
              </span>
            </Link>

            {invoice.songId && invoice.songTitle && (
              <Link href={`/songs/${invoice.songId}`} data-drill="song" className={cn(DRILL_FOCUS, LINK_ROW)}>
                <span className="grid size-7 place-items-center rounded-md bg-coal-3 text-gold">
                  <Music2 className="size-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">Song</span>
                  <span className="block truncate text-sm font-medium text-bone">{invoice.songTitle}</span>
                </span>
              </Link>
            )}

            {invoice.sessionId && (
              <SessionLink sessionId={invoice.sessionId} className={LINK_ROW}>
                <span className="grid size-7 place-items-center rounded-md bg-coal-3 text-gold-dim">
                  <Receipt className="size-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                    Session{invoice.serviceType ? ` · ${invoice.serviceType}` : ""}
                  </span>
                  <span className="block truncate text-sm font-medium text-bone">
                    {invoice.sessionTitle || "Open booking"}
                  </span>
                </span>
              </SessionLink>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <InvoiceActivity rows={activity} />
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
