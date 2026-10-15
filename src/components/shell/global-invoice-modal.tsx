"use client";

import { Suspense, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";

/* Loaded the first time a invoice is opened (or deep-linked), not on every
   cold load of every page; then kept mounted so closing animates. */
const InvoiceModal = dynamic(() => import("@/components/payments/invoice-modal").then((m) => m.InvoiceModal), { ssr: false });
import { INVOICE_PARAM } from "@/lib/entity-href";
import { useOpenInvoice } from "@/lib/use-open-invoice";

/** One invoice modal for the whole app: `?invoice=<id>` on any route opens it
 *  in place, deep links included (it reads the param on first load). The
 *  invoice's own full page stands it down so the invoice never shows twice. */
function GlobalInvoiceModalInner() {
  const pathname = usePathname();
  const invoiceId = useSearchParams().get(INVOICE_PARAM);
  const openInvoice = useOpenInvoice();
  const [armed, setArmed] = useState(false);
  if (invoiceId && !armed) setArmed(true);
  if (/^\/payments\/[^/]+$/.test(pathname)) return null;
  if (!armed) return null;
  return <InvoiceModal invoiceId={invoiceId} onClose={() => openInvoice(null)} />;
}

export function GlobalInvoiceModal() {
  return (
    <Suspense fallback={null}>
      <GlobalInvoiceModalInner />
    </Suspense>
  );
}
