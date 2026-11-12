/* Lead names for appointments without a request per lead (R3-I3). First open
   reads ONE list_leads page (limit 200) as an id to name map; a name on the
   booking itself wins; any other lead shows "Lead" and its id tail until its
   appointment is opened, which reads that one lead. */

import type { Booking } from "./calendar-types";
import type { Lead } from "./zu-types";

export const LEAD_NAME_PAGE = 200;

export function nameFromLead(l: Pick<Lead, "full_name" | "email" | "phone"> | null | undefined): string | null {
  return l?.full_name || l?.email || l?.phone || null;
}

/** The name a booking carries itself, if any. */
export function bookingLeadName(b: Pick<Booking, "lead_name" | "lead">): string | null {
  return b.lead_name || b.lead?.full_name || b.lead?.email || null;
}

/** id to name, from the bookings' own names and one page of leads. */
export function leadNameMap(
  leads: Array<Pick<Lead, "id" | "full_name" | "email" | "phone">> | null | undefined,
  bookings: Array<Pick<Booking, "lead_id" | "lead_name" | "lead">>,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of leads ?? []) {
    const n = nameFromLead(l);
    if (l.id && n) m.set(l.id, n);
  }
  for (const b of bookings) {
    const n = bookingLeadName(b);
    if (b.lead_id && n) m.set(b.lead_id, n);
  }
  return m;
}
