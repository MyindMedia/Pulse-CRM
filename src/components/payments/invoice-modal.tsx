"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ExternalLink, Receipt } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { categoryMeta } from "@/components/payments/category";
import { InvoiceDetailView } from "@/components/payments/invoice-detail";
import type { InvoiceDetail, ActivityRow } from "@/components/payments/types";
import { money, longDate } from "@/lib/format";
import { meta, INVOICE_STATUS } from "@/lib/labels";

/** One invoice in a centered modal: the document, lifecycle, actions, linked
 *  records and activity, the same as its full page. Opened from anywhere
 *  through `?invoice=<id>` (GlobalInvoiceModal). */
export function InvoiceModal({
  invoiceId,
  onClose,
}: {
  invoiceId: string | null;
  onClose: () => void;
}) {
  const open = invoiceId !== null;
  const invoice = useQuery(
    api.invoices.get,
    invoiceId ? { id: invoiceId as Id<"invoices"> } : "skip",
  ) as InvoiceDetail | null | undefined;
  const activity = useQuery(
    api.activity.forEntity,
    invoiceId ? { entityType: "invoice", entityId: invoiceId } : "skip",
  ) as ActivityRow[] | undefined;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent width="xl" aria-describedby={undefined}>
        {invoice === undefined ? (
          <>
            <SheetHeader>
              <SheetTitle className="sr-only">Loading invoice</SheetTitle>
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-32" />
            </SheetHeader>
            <SheetBody>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <Skeleton className="h-[28rem] w-full" />
                <div className="space-y-4">
                  <Skeleton className="h-40 w-full" />
                  <Skeleton className="h-32 w-full" />
                </div>
              </div>
            </SheetBody>
          </>
        ) : invoice === null ? (
          <>
            <SheetHeader>
              <SheetTitle>Invoice not found</SheetTitle>
            </SheetHeader>
            <SheetBody>
              <EmptyState
                icon={Receipt}
                title="Invoice not found"
                description="This invoice does not exist, was deleted, or you do not have access to it."
              />
            </SheetBody>
          </>
        ) : (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={meta(INVOICE_STATUS, invoice.status).tone}>
                  {meta(INVOICE_STATUS, invoice.status).label}
                </Badge>
                {(() => {
                  const c = categoryMeta(invoice.category);
                  const Icon = c.icon;
                  return (
                    <Badge tone={c.tone}>
                      <Icon className="size-3" />
                      {c.label}
                    </Badge>
                  );
                })()}
              </div>
              <SheetTitle>
                Invoice {invoice.number}
                {invoice.artist?.name ? ` · ${invoice.artist.name}` : ""}
              </SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-meta tabular-nums text-bone">{money(invoice.amountCents)}</span>
                <span>Due {longDate(invoice.dueDate)}</span>
                <Button variant="ghost" size="sm" asChild className="-ml-2 h-auto px-2 py-0.5 text-xs">
                  <Link href={`/payments/${invoice._id}`}>
                    <ExternalLink className="size-3" />
                    Open full page
                  </Link>
                </Button>
              </SheetDescription>
            </SheetHeader>
            <SheetBody>
              <InvoiceDetailView invoice={invoice} activity={activity} onDeleted={onClose} />
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
