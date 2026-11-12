"use client";

import * as React from "react";
import { useZuFetch } from "./use-zu";
import { CAL_OP } from "./calendar-ops";
import type { Booking } from "./calendar-types";
import type { Lead, LeadResponse } from "./zu-types";

/* Lead names for the appointments on screen, without reading the whole lead
   list up front (F-U3): a name on the booking wins; otherwise one get_lead per
   lead in view, at most LEAD_NAME_CONCURRENCY at a time, each asked once per
   tab (the read store caches the answers in memory). */

export const LEAD_NAME_CONCURRENCY = 8;

export function nameFromLead(l: Pick<Lead, "full_name" | "email" | "phone"> | null | undefined): string | null {
  return l?.full_name || l?.email || l?.phone || null;
}

/** The name a booking carries itself, if any. */
export function bookingLeadName(b: Pick<Booking, "lead_name" | "lead">): string | null {
  return b.lead_name || b.lead?.full_name || b.lead?.email || null;
}

/** Which lead ids to ask for next: not named, not already asked, in order,
 *  leaving at most `max` requests in flight. */
export function nextLeadIds(ids: string[], named: ReadonlySet<string>, asked: ReadonlySet<string>, inFlight: number, max = LEAD_NAME_CONCURRENCY): string[] {
  const room = Math.max(0, max - inFlight);
  const out: string[] = [];
  for (const id of ids) {
    if (out.length >= room) break;
    if (!id || named.has(id) || asked.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

export function useLeadNames(bookings: Booking[]): (id: string) => string | null {
  const fetchZu = useZuFetch();
  const [names, setNames] = React.useState<ReadonlyMap<string, string>>(() => new Map());
  const asked = React.useRef(new Set<string>());
  const inFlight = React.useRef(0);
  const [tick, setTick] = React.useState(0);

  const own = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bookings) {
      const n = b.lead_id ? bookingLeadName(b) : null;
      if (b.lead_id && n) m.set(b.lead_id, n);
    }
    return m;
  }, [bookings]);
  const ids = React.useMemo(() => [...new Set(bookings.map((b) => b.lead_id).filter((x): x is string => !!x))], [bookings]);

  React.useEffect(() => {
    const named = new Set([...own.keys(), ...names.keys()]);
    const next = nextLeadIds(ids, named, asked.current, inFlight.current);
    for (const id of next) {
      asked.current.add(id);
      inFlight.current += 1;
      void fetchZu<LeadResponse>(CAL_OP.lead, { path: { lead_id: id } }).then(({ data }) => {
        inFlight.current -= 1;
        const n = nameFromLead(data?.lead);
        if (n) setNames((m) => new Map(m).set(id, n));
        setTick((t) => t + 1);
      });
    }
  }, [ids, own, names, fetchZu, tick]);

  return React.useCallback((id: string) => own.get(id) ?? names.get(id) ?? null, [own, names]);
}
