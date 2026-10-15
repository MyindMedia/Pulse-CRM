"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useQueries } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { Value } from "convex/values";
import { api } from "@convex/_generated/api";
import { queryKey } from "@/lib/boot-cache";
import { useBootSnapshotStore } from "@/lib/boot-snapshot";
import { useOptionalUser } from "@/lib/use-optional-clerk";
import { periodBounds, savedPeriod } from "@/components/dashboard/hw/period";

/* Fewer round trips on a cold dashboard load.

   The shell holds the page back until the plan check (agencyBilling.myBilling)
   answers, and only then did the dashboard's tiles mount and ask for their
   data: two round trips back to back, plus a third for arrival prep. This
   subscribes the dashboard's queries in the SAME websocket batch as the plan
   check, so their answers are already in the Convex client's cache when the
   tiles mount and read them.

   It stays mounted for as long as the dashboard is open: dropping these
   subscriptions in the same commit the tiles add theirs would make the client
   discard the answers and ask again. useQueries hands back errors instead of
   throwing, so a query this person may not run (or a billing-locked studio)
   costs nothing here; the tiles themselves still render through the normal
   error handling. Mounted only after the session is confirmed. */

type Prefetch = { key: string; query: FunctionReference<"query">; args: Record<string, Value>; capability?: string };

/** Mirrors the widget registry's default overview and each tile's own args. */
function dashboardQueries(): Prefetch[] {
  const b = periodBounds(savedPeriod());
  return [
    { key: "caps", query: api.access.myCapabilities, args: {} },
    { key: "theme", query: api.theme.get, args: {} },
    { key: "today", query: api.today.today, args: {} },
    { key: "overview", query: api.dashboard.overview, args: {} },
    { key: "kpis", query: api.dashboard.periodKpis, args: { start: b.start, end: b.end, prevStart: b.prevStart, prevEnd: b.prevEnd } },
    { key: "stripe", query: api.stripeConnect.status, args: {} },
    { key: "onboarding", query: api.onboarding.mine, args: {} },
    { key: "upcoming", query: api.sessions.upcoming, args: { limit: 12 } },
    { key: "prep", query: api.arrivalPrep.forUpcoming, args: { limit: 12 } },
    { key: "revenue", query: api.dashboard.revenueSeries, args: { range: "30d" }, capability: "invoices.read" },
    { key: "rooms", query: api.reports.roomUtilization, args: {}, capability: "insights.read" },
    { key: "ops", query: api.opsActions.list, args: { limit: 3 }, capability: "ops.action.approve" },
    { key: "deposits", query: api.payments.recentDeposits, args: { limit: 6 }, capability: "invoices.read" },
  ];
}

/** Which registry tile each gated prefetch feeds (for the saved layout). */
const TILE_FOR: Record<string, string> = { revenue: "revenue", rooms: "rooms", ops: "ops", deposits: "deposits" };

const CAPS_REQUEST = { caps: { query: api.access.myCapabilities, args: {} } };

export function DashboardPrefetch() {
  const pathname = usePathname();
  if (pathname !== "/dashboard") return null;
  return <PrefetchQueries />;
}

function PrefetchQueries() {
  const store = useBootSnapshotStore();
  const { user } = useOptionalUser();
  const userId = user?.id ?? "anon";
  const [requests] = React.useState(() => dashboardQueries());
  // useQueries, not useQuery: an error here must never throw into the shell.
  const capsResult = useQueries(CAPS_REQUEST).caps as { capabilities?: string[] } | Error | undefined;
  const liveCaps = capsResult instanceof Error ? undefined : capsResult;

  const queries = React.useMemo(() => {
    // Capability-gated tiles are fetched only once this person is known to
    // hold the capability: from the live answer (it rides in the first batch)
    // or, before that, from last visit's boot cache. An engineer's browser
    // never asks for deposits.
    const cachedCaps = store?.get(queryKey(getFunctionName(api.access.myCapabilities), {})) as
      | { capabilities?: string[] }
      | undefined;
    const caps = new Set((liveCaps ?? cachedCaps)?.capabilities ?? []);
    // Tiles this person removed from their layout are not fetched.
    let hidden = new Set<string>();
    try {
      const raw = localStorage.getItem(`pulse:dash-layout:v2:${userId}`);
      const saved = raw ? (JSON.parse(raw) as { hidden?: unknown }) : null;
      if (saved && Array.isArray(saved.hidden)) hidden = new Set(saved.hidden.filter((k): k is string => typeof k === "string"));
    } catch {
      hidden = new Set();
    }
    const out: Record<string, { query: FunctionReference<"query">; args: Record<string, Value> }> = {};
    for (const r of requests) {
      if (r.capability && !(caps.has(r.capability) || caps.has(`${r.capability}.own`))) continue;
      const tile = TILE_FOR[r.key];
      if (tile && hidden.has(tile)) continue;
      out[r.key] = { query: r.query, args: r.args };
    }
    return out;
  }, [requests, store, userId, liveCaps]);

  useQueries(queries);
  return null;
}
