/* Calendar module - shared types, date math and session helpers. */

export type Session = {
  _id: string;
  title: string;
  artistId: string;
  artistName: string;
  songId?: string;
  songTitle?: string;
  serviceType: string;
  roomId?: string;
  roomName?: string;
  engineerId?: string;
  engineerName?: string;
  startTime: number;
  endTime: number;
  status: "tentative" | "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show";
  rateCents: number;
  depositCents: number;
  depositPaid: boolean;
  intakeCompleted: boolean;
  notes?: string;
};

export const SESSION_SERVICE_TYPES = [
  "recording",
  "mixing",
  "mastering",
  "production",
  "consultation",
  "rehearsal",
  "writing",
] as const;

/** Status → swatch color (matches SESSION_STATUS badge tones). */
export const STATUS_COLOR: Record<string, string> = {
  tentative: "var(--color-ash-dim)",
  confirmed: "var(--color-info)",
  in_progress: "var(--color-gold)",
  completed: "var(--color-positive)",
  cancelled: "var(--color-hairline-2)",
  no_show: "var(--color-critical)",
};

export function statusColor(status: string): string {
  return STATUS_COLOR[status] ?? "var(--color-ash-dim)";
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Local-midnight timestamp for a given day. */
export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Midnight of the Sunday starting this timestamp's week (local time). */
export function startOfWeek(ts: number): number {
  const d = new Date(startOfDay(ts));
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

/**
 * The 42-cell grid (6 weeks) for a month, starting on Sunday.
 * Returns each cell's midnight timestamp.
 */
export function monthGridDays(year: number, month: number): number[] {
  const first = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - first.getDay());
  const days: number[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i).getTime());
  }
  return days;
}

/** Inclusive [from, to] window covering the full visible month grid. */
export function monthGridRange(year: number, month: number): { from: number; to: number } {
  const days = monthGridDays(year, month);
  return { from: days[0], to: days[days.length - 1] + 86_399_999 };
}

/** Build a local datetime timestamp from a `yyyy-mm-dd` date and `HH:MM` time. */
export function combineDateTime(dateStr: string, timeStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

/** `yyyy-mm-dd` for an `<input type="date">`, in local time. */
export function toDateInputValue(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
