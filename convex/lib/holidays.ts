/* Studio closures: Sundays + US public holidays. Shared by the demo seeder and
   the schedule grid so both agree on what's a closed day. */

export const HOLIDAYS: { name: string; ymd: string }[] = [
  { name: "New Year's Day", ymd: "2026-01-01" },
  { name: "MLK Day", ymd: "2026-01-19" },
  { name: "Presidents' Day", ymd: "2026-02-16" },
  { name: "Memorial Day", ymd: "2026-05-25" },
  { name: "Juneteenth", ymd: "2026-06-19" },
  { name: "Independence Day", ymd: "2026-07-04" },
  { name: "Labor Day", ymd: "2026-09-07" },
  { name: "Thanksgiving", ymd: "2026-11-26" },
  { name: "Christmas Day", ymd: "2026-12-25" },
];

const HOLIDAY_BY_YMD = new Map(HOLIDAYS.map((h) => [h.ymd, h.name]));

/** Local YYYY-MM-DD for a timestamp. */
export function ymd(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Holiday name for a timestamp, or null. */
export function holidayName(ts: number): string | null {
  return HOLIDAY_BY_YMD.get(ymd(ts)) ?? null;
}

/** Why the studio is closed that day, or null if it's a working day. */
export function closureReason(ts: number): string | null {
  if (new Date(ts).getDay() === 0) return "Sunday";
  return holidayName(ts);
}
