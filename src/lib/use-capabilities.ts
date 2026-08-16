"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useHydrated } from "./use-hydrated";

/**
 * Read the current viewer's role + capabilities for capability-aware UI.
 * `can(cap)` mirrors the server engine: an exact match OR a `.own`-qualified
 * grant counts. While loading, `can` returns false and `loaded` is false, so
 * callers can choose to hold gated UI until the answer is known.
 *
 * This is presentation only - every gated query/mutation re-checks on the
 * server, so hiding a button is convenience, not the security boundary.
 */
export function useCapabilities() {
  /*
   * Convex answers over a websocket that can beat hydration, so the client's
   * first render would already know the capabilities while the server's HTML
   * was built without them. React then reports every capability-gated
   * attribute (`disabled`, `aria-*`) as a hydration mismatch. Holding
   * `loaded` false until hydration makes the two agree; consumers already
   * handle the loading state, so this costs one frame and nothing else.
   */
  const hydrated = useHydrated();
  const live = useQuery(api.access.myCapabilities, {});
  const data = hydrated ? live : undefined;
  const caps = React.useMemo(() => new Set(data?.capabilities ?? []), [data]);
  const can = React.useCallback(
    (cap: string) => caps.has(cap) || caps.has(`${cap}.own`),
    [caps],
  );
  return {
    role: data?.role ?? null,
    kind: data?.kind ?? null,
    can,
    loaded: data !== undefined,
    /** True only once loaded AND the viewer holds financial visibility. */
    canSeeFinancials: data !== undefined && (caps.has("invoices.read") || caps.has("insights.read")),
  };
}
