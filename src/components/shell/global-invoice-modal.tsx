"use client";

import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { InvoiceModal } from "@/components/payments/invoice-modal";
import { INVOICE_PARAM } from "@/lib/entity-href";
import { useOpenInvoice } from "@/lib/use-open-invoice";

/** One invoice modal for the whole app: `?invoice=<id>` on any route opens it
 *  in place, deep links included (it reads the param on first load). The
 *  invoice's own full page stands it down so the invoice never shows twice. */
function GlobalInvoiceModalInner() {
  const pathname = usePathname();
  const invoiceId = useSearchParams().get(INVOICE_PARAM);
  const openInvoice = useOpenInvoice();
  if (/^\/payments\/[^/]+$/.test(pathname)) return null;
  return <InvoiceModal invoiceId={invoiceId} onClose={() => openInvoice(null)} />;
}

export function GlobalInvoiceModal() {
  return (
    <Suspense fallback={null}>
      <GlobalInvoiceModalInner />
    </Suspense>
  );
}
