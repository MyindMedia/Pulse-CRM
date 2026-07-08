/* Pure timesheet math for the staff Time Clock screen. Mirrors payroll
   semantics: an entry belongs to the window its clock-IN falls in, and a
   still-open entry accrues up to `now`. */

export type EntryLite = { clockInAt: number; clockOutAt?: number | null };

/** Total clocked ms for entries whose clock-in falls in [start, end). */
export function clockedMs(entries: EntryLite[], start: number, end: number, now: number): number {
  let total = 0;
  for (const e of entries) {
    if (e.clockInAt < start || e.clockInAt >= end) continue;
    total += Math.max(0, (e.clockOutAt ?? now) - e.clockInAt);
  }
  return total;
}

/** Local midnight for the day containing `now`. */
export function startOfToday(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** Local midnight of the most recent Monday (start of the work week). */
export function startOfWeek(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime();
}

/** "6h 32m" (or "45m" under an hour) - durations in lists and stat tiles. */
export function fmtDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** "2:14:09" - the live ticking readout on the punch button. */
export function fmtTicker(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(sec)}`;
}
