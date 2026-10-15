"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** `/pipeline?deal=<id>` opens that deal's sheet, so a deal shown anywhere
 *  else in the app (dashboard, artist page, insights) can drill into it. The
 *  param is dropped once read, so closing the sheet stays closed. */
function DealParamInner({ onOpen }: { onOpen: (id: string) => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const deal = params.get("deal");
  useEffect(() => {
    if (!deal) return;
    onOpen(deal);
    const rest = new URLSearchParams(params.toString());
    rest.delete("deal");
    const qs = rest.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [deal, onOpen, params, pathname, router]);
  return null;
}

export function DealParamOpener({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <Suspense fallback={null}>
      <DealParamInner onOpen={onOpen} />
    </Suspense>
  );
}
