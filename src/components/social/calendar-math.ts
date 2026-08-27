/* Pure month-grid arithmetic for the marketing calendar, no date-fns per the
   brief. Everything here reads and writes the platform Date object's own
   (browser-local) timezone: the grid the owner sees, the `from`/`to` bounds
   handed to `posts.list`, and the day a given post's chip lands in must all
   agree on one clock, or a post could render in a different cell than the
   window that fetched it. A post's own chosen posting timezone (composer's
   `timezone` field) is irrelevant here - this is display bucketing, not the
   authoritative schedule. */

export type MonthGridCell = {
  ts: number;
  day: number;
  inMonth: boolean;
  isToday: boolean;
};

function dayKeyLocal(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Which local day (by key) a timestamp falls on - how the calendar buckets
 *  a post's `scheduledFor` into a grid cell. */
export function dayKeyFor(ts: number): string {
  return dayKeyLocal(ts);
}

/** Inclusive local-time window covering every millisecond of `year`-`month`
 *  (0-indexed), for `posts.list({ from, to })`. */
export function monthBounds(year: number, month: number): { from: number; to: number } {
  const from = new Date(year, month, 1, 0, 0, 0, 0).getTime();
  const to = new Date(year, month + 1, 0, 23, 59, 59, 999).getTime();
  return { from, to };
}

/** 7-column, week-row grid for `year`-`month` (0-indexed): weeks start
 *  Sunday and are padded with the trailing days of the surrounding months so
 *  every row has all seven columns and the grid always covers full weeks. */
export function monthGrid(year: number, month: number, now = Date.now()): MonthGridCell[][] {
  const startWeekday = new Date(year, month, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
  const todayKey = dayKeyLocal(now);

  const cells: MonthGridCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const date = new Date(year, month, 1 + (i - startWeekday));
    cells.push({
      ts: date.getTime(),
      day: date.getDate(),
      inMonth: date.getMonth() === month,
      isToday: dayKeyLocal(date.getTime()) === todayKey,
    });
  }

  const weeks: MonthGridCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
