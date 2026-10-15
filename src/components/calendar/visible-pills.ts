/** Which bookings a month cell shows when it has room for only a few. A
 *  booking request waiting on approval always takes a slot first, so a new
 *  request from the public link never hides behind "+N more" on a busy day.
 *  The ones shown stay in time order. */
export function pickVisiblePills<T extends { _id: string; startTime: number; requestStatus?: string | null }>(
  dayList: T[],
  max: number,
): T[] {
  if (dayList.length <= max) return dayList;
  const pending = dayList.filter((s) => s.requestStatus === "pending");
  const rest = dayList.filter((s) => s.requestStatus !== "pending");
  return [...pending, ...rest].slice(0, max).sort((a, b) => a.startTime - b.startTime);
}
