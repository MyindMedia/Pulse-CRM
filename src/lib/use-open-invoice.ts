"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { withInvoiceParam, withSessionParam } from "@/lib/entity-href";

/** Opens (or with null, closes) an invoice's modal on the current page by
 *  setting `?invoice=<id>`. The shell's global invoice modal reads the param,
 *  so any page can open any invoice in place, the same way `useOpenSession`
 *  opens a booking. Other params are kept and the page does not scroll. One
 *  detail modal at a time: opening an invoice closes an open booking. */
export function useOpenInvoice() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (invoiceId: string | null) => {
      const here = typeof window === "undefined" ? "" : window.location.search;
      const search = invoiceId ? withSessionParam(here, null) : here;
      router.replace(`${pathname}${withInvoiceParam(search, invoiceId)}`, { scroll: false });
    },
    [router, pathname],
  );
}
