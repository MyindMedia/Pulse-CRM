"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ArrowLeft, Receipt, User, Music2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { InvoiceSheet } from "@/components/payments/invoice-sheet";
import { StatusTimeline } from "@/components/payments/status-timeline";
import { InvoiceActions } from "@/components/payments/invoice-actions";
import { InvoiceActivity } from "@/components/payments/invoice-activity";
import type { InvoiceDetail, ActivityRow } from "@/components/payments/types";

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const invoiceId = id as Id<"invoices">;

  const invoice = useQuery(api.invoices.get, { id: invoiceId }) as
    | InvoiceDetail
    | null
    | undefined;
  const activity = useQuery(api.activity.forEntity, {
    entityType: "invoice",
    entityId: id,
  }) as ActivityRow[] | undefined;

  const backLink = (
    <Button variant="ghost" size="sm" asChild>
      <Link href="/payments">
        <ArrowLeft className="size-4" />
        All payments
      </Link>
    </Button>
  );

  // Not found.
  if (invoice === null) {
    return (
      <div className="space-y-5">
        {backLink}
        <EmptyState
          icon={Receipt}
          title="Invoice not found"
          description="This invoice does not exist or has been deleted."
          action={
            <Button asChild>
              <Link href="/payments">Back to payments</Link>
            </Button>
          }
        />
      </div>
    );
  }

  // Loading.
  if (invoice === undefined) {
    return (
      <div className="space-y-5">
        {backLink}
        <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
          <Skeleton className="h-[36rem] w-full" />
          <div className="space-y-4">
            <Skeleton className="h-56 w-full" />
            <Skeleton className="h-44 w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        {backLink}
        <p className="font-mono text-xs text-ash-dim">{invoice.number}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        {/* The invoice document */}
        <div className="min-w-0">
          <InvoiceSheet invoice={invoice} />
        </div>

        {/* Side panel - timeline, actions, links, activity */}
        <aside className="space-y-4">
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
                id={invoice._id}
                number={invoice.number}
                status={invoice.status}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Linked records</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link
                href={`/roster/${invoice.artistId}`}
                className="flex items-center gap-2.5 rounded-md border border-hairline bg-coal-2 px-3 py-2.5 transition-colors hover:border-hairline-2 hover:bg-coal-3"
              >
                <span className="grid size-7 place-items-center rounded-md bg-coal-3 text-ash-dim">
                  <User className="size-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[0.625rem] font-mono uppercase tracking-wide text-ash-dim">
                    Client
                  </span>
                  <span className="block truncate text-sm font-medium text-bone">
                    {invoice.artist?.name ?? "Unknown"}
                  </span>
                </span>
              </Link>

              {invoice.songId && invoice.songTitle && (
                <Link
                  href={`/songs/${invoice.songId}`}
                  className="flex items-center gap-2.5 rounded-md border border-hairline bg-coal-2 px-3 py-2.5 transition-colors hover:border-hairline-2 hover:bg-coal-3"
                >
                  <span className="grid size-7 place-items-center rounded-md bg-coal-3 text-gold">
                    <Music2 className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[0.625rem] font-mono uppercase tracking-wide text-ash-dim">
                      Song
                    </span>
                    <span className="block truncate text-sm font-medium text-bone">
                      {invoice.songTitle}
                    </span>
                  </span>
                </Link>
              )}

              {invoice.sessionTitle && (
                <div className="flex items-center gap-2.5 rounded-md border border-hairline bg-coal-2 px-3 py-2.5">
                  <span className="grid size-7 place-items-center rounded-md bg-coal-3 text-ash-dim">
                    <Receipt className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[0.625rem] font-mono uppercase tracking-wide text-ash-dim">
                      Session
                    </span>
                    <span className="block truncate text-sm font-medium text-bone">
                      {invoice.sessionTitle}
                    </span>
                  </span>
                </div>
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
    </div>
  );
}
