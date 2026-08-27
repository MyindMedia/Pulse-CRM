/** Pure range arithmetic for the Results page's "Last N days" chips.
 *
 *  `from` and `to` must always describe the same instant read once, not two
 *  separate `Date.now()` calls that can drift apart across a render or
 *  between two state updates. Every caller snapshots `now` a single time (at
 *  mount, or when a chip is clicked) and passes it in here; nothing in this
 *  module reads the clock itself, which is what makes it trivial to test
 *  against a fixed instant and impossible to make it thrash a `useQuery`
 *  subscription by handing it a moving target.
 *
 *  This mirrors how the marketing calendar page derives its own `from`/`to`
 *  window (`monthBounds` in `calendar-math.ts`, memoized on `[year, month]`
 *  rather than the current instant) - a pure function of the selection, not
 *  of the render. */

export const DAY_MS = 86_400_000;

export type RangeDays = 7 | 30 | 90;

export type RangeOption = { label: string; days: RangeDays };

export const RANGE_OPTIONS: readonly RangeOption[] = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

/** The [from, to] window covering the last `days` days, ending at `now`. */
export function computeRange(now: number, days: number): { from: number; to: number } {
  return { from: now - days * DAY_MS, to: now };
}
