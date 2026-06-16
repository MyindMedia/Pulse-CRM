"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

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
  const data = useQuery(api.access.myCapabilities, {});
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
