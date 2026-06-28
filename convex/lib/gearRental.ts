/* ============================================================
   Gear-rental availability - pure, testable conflict logic.

   Premium gear can be rented a-la-carte as a booking add-on. A single
   physical unit must never be double-booked: if the one vintage mic is
   on an overlapping session, the next booking can't take it. This
   module is the pure rule layer behind that guarantee - it reasons over
   plain session/equipment data (already org-scoped by the caller) so it
   stays unit-testable and can never cross a tenant boundary.
   ============================================================ */

/** Minimal session shape the availability math needs. */
export type SessionWindow = {
  startTime: number;
  endTime: number;
  status: string;
  engineerId?: string;
  addOns?: { equipmentId: string }[];
};

/** Statuses that no longer hold a slot (room, engineer or gear). */
const RELEASED = new Set(["cancelled", "no_show"]);

/** True when two half-open intervals [aStart,aEnd) and [bStart,bEnd) overlap. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** How many units of one equipment item are committed to LIVE sessions that
 *  overlap [start,end). `excludeId` skips a session being edited in place. */
export function bookedUnits(
  equipmentId: string,
  start: number,
  end: number,
  sessions: SessionWindow[],
  excludeId?: string,
): number {
  let n = 0;
  for (const s of sessions) {
    if (excludeId && (s as { _id?: string })._id === excludeId) continue;
    if (RELEASED.has(s.status)) continue;
    if (!overlaps(s.startTime, s.endTime, start, end)) continue;
    if (s.addOns?.some((a) => a.equipmentId === equipmentId)) n++;
  }
  return n;
}

/** The studio's total stock of an item (defaults to 1 when unset). */
export function unitsOf(item: { quantity?: number }): number {
  return item.quantity && item.quantity > 0 ? Math.floor(item.quantity) : 1;
}

/** Whether an item can be rented onto a session in [start,end): it must be
 *  flagged rentable, in serviceable condition, and have a free unit. */
export function gearAvailable(
  item: { quantity?: number; status: string; rentable?: boolean },
  booked: number,
): boolean {
  if (!item.rentable) return false;
  if (item.status === "maintenance" || item.status === "retired") return false;
  return booked < unitsOf(item);
}

/** Whether a staff member is free in [start,end): not already engineering a
 *  live overlapping session. */
export function engineerAvailable(
  memberId: string,
  start: number,
  end: number,
  sessions: SessionWindow[],
  excludeId?: string,
): boolean {
  for (const s of sessions) {
    if (excludeId && (s as { _id?: string })._id === excludeId) continue;
    if (RELEASED.has(s.status)) continue;
    if (s.engineerId !== memberId) continue;
    if (overlaps(s.startTime, s.endTime, start, end)) return false;
  }
  return true;
}

/** Sum of selected add-on prices, in cents. */
export function addOnsTotalCents(items: { priceCents: number }[]): number {
  return items.reduce((sum, i) => sum + (i.priceCents || 0), 0);
}
