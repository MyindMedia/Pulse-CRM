"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Plus, Receipt } from "lucide-react";
import { PageHeader, Section } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { MoneySummary, type InvoiceSummary } from "@/components/payments/money-summary";
import { StatusFilter, type StatusFilterValue } from "@/components/payments/status-filter";
import { InvoiceTable } from "@/components/payments/invoice-table";
import { CreateInvoiceDialog } from "@/components/payments/create-invoice-dialog";
import type { InvoiceRow } from "@/components/payments/types";

function PaymentsView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filter, setFilter] = React.useState<StatusFilterValue>("all");
  const [createOpen, setCreateOpen] = React.useState(false);

  // Auto-open the create dialog when the URL carries ?new=1. Split into a
  // render-time check (state) and an effect that strips the param.
  const newParam = searchParams.get("new");
  const [prevNewParam, setPrevNewParam] = React.useState(newParam);
  if (prevNewParam !== newParam) {
    setPrevNewParam(newParam);
    if (newParam === "1") setCreateOpen(true);
  }
  React.useEffect(() => {
    if (searchParams.get("new") === "1") router.replace("/payments");
  }, [searchParams, router]);

  // Always pull the unfiltered list - filtering + counts happen client-side
  // so the segmented control can show live per-status counts.
  const invoices = useQuery(api.invoices.list, {}) as InvoiceRow[] | undefined;
  const summary = useQuery(api.invoices.summary) as InvoiceSummary | undefined;

  const counts = React.useMemo<Partial<Record<StatusFilterValue, number>>>(() => {
    if (!invoices) return {};
    const acc: Partial<Record<StatusFilterValue, number>> = { all: invoices.length };
    for (const inv of invoices) {
      acc[inv.status] = (acc[inv.status] ?? 0) + 1;
    }
    return acc;
  }, [invoices]);

  const rows = React.useMemo(() => {
    if (!invoices) return [];
    return filter === "all" ? invoices : invoices.filter((i) => i.status === filter);
  }, [invoices, filter]);

  return (
    <div className="space-y-7">
      <PageHeader
        overline="Finance"
        title="Payments"
        description="Every invoice the studio has raised - what is collected, what is outstanding, and what still needs chasing."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Create invoice
          </Button>
        }
      />

      <MoneySummary summary={summary} />

      <Section
        title="Invoices"
        trailing={
          <StatusFilter value={filter} onChange={setFilter} counts={counts} />
        }
      >
        {invoices === undefined ? (
          <SkeletonRows rows={6} />
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No invoices yet"
            description="Raise your first invoice to start tracking studio income."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                Create invoice
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="Nothing in this view"
            description="No invoices match the selected status filter."
            action={
              <Button variant="outline" onClick={() => setFilter("all")}>
                Show all invoices
              </Button>
            }
          />
        ) : (
          <InvoiceTable rows={rows} />
        )}
      </Section>

      <CreateInvoiceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

/* useSearchParams() must sit under a Suspense boundary for static export. */
export default function PaymentsPage() {
  return (
    <React.Suspense fallback={null}>
      <PaymentsView />
    </React.Suspense>
  );
}
