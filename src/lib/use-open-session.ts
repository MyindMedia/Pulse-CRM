"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { withSessionParam } from "@/lib/entity-href";

/** Opens (or with null, closes) a booking's sheet on the current page by
 *  setting `?session=<id>`. The shell's global sheet reads the param, so any
 *  page can open any booking in place. Other params are kept and the page does
 *  not scroll. The search is read at call time, so the callback never goes
 *  stale and the hook needs no Suspense boundary. */
export function useOpenSession() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (sessionId: string | null) => {
      const search = typeof window === "undefined" ? "" : window.location.search;
      router.replace(`${pathname}${withSessionParam(search, sessionId)}`, { scroll: false });
    },
    [router, pathname],
  );
}
