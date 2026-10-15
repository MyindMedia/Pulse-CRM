"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ArrowLeft, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { InvoiceDetailView } from "@/components/payments/invoice-detail";
import { Badge } from "@/components/ui/badge";
import { categoryMeta } from "@/components/payments/category";
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
        <div className="flex items-center gap-2">
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
          <p className="font-meta text-xs text-steel/70">{invoice.number}</p>
        </div>
      </div>

      <InvoiceDetailView invoice={invoice} activity={activity} />
    </div>
  );
}
