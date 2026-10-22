/* ============================================================
   Off-peak room pricing (openspec/changes/off-peak-and-google-reviews).

   A room can carry windows like "Mon-Thu 9:00 to 14:00, 25% off", read in
   the STUDIO's timezone. A booking is priced hour by hour: an hour whose
   local start falls inside a window pays that window's rate, every other
   hour pays the room rate, so a booking that crosses a window edge is only
   discounted for the hours it actually spends off-peak.

   Pure on purpose: `booking.createBooking` charges with it and the booking
   page shows the price with it (through the @convex/lib alias), so the two
   can never disagree.
   ============================================================ */

export type OffPeakWindow = {
  /** 0 = Sunday ... 6 = Saturday, studio time. */
  days: number[];
  /** Whole hours, studio time. startHour inclusive, endHour exclusive. */
  startHour: number;
  endHour: number;
  /** Percent off the room rate, 1 to 90. */
  pct: number;
};

export const OFF_PEAK_MAX_WINDOWS = 6;
const HOUR = 3_600_000;

/** Why a window is unusable, or null when it is fine. Shown to the owner. */
export function offPeakWindowError(w: OffPeakWindow): string | null {
  if (!w.days.length) return "Pick at least one day.";
  if (w.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return "Days must be Sunday to Saturday.";
  if (!Number.isInteger(w.startHour) || !Number.isInteger(w.endHour)) return "Use whole hours.";
  if (w.startHour < 0 || w.endHour > 24 || w.startHour >= w.endHour) return "The window must end after it starts.";
  if (!Number.isFinite(w.pct) || w.pct < 1 || w.pct > 90) return "Discount must be between 1% and 90%.";
  return null;
}

/** Weekday (0 = Sunday) and hour (0-23) of an instant, in a studio's zone. */
export function localWeekdayHour(ts: number, tz: string): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(ts));
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd), hour };
}

/** The best (largest) discount covering the hour starting at `ts`, or 0. */
export function offPeakPctAt(windows: OffPeakWindow[] | undefined, ts: number, tz: string): number {
  if (!windows?.length) return 0;
  const { weekday, hour } = localWeekdayHour(ts, tz);
  let best = 0;
  for (const w of windows) {
    if (offPeakWindowError(w)) continue;
    if (w.days.includes(weekday) && hour >= w.startHour && hour < w.endHour) best = Math.max(best, w.pct);
  }
  return best;
}

/**
 * Room time for a booking, hour by hour. `durationHours` may be fractional;
 * the last partial hour is priced by the window covering its start.
 * Returns the full price, the off-peak price and how many hours were discounted.
 */
export function offPeakRoomCents(args: {
  hourlyRateCents: number;
  windows: OffPeakWindow[] | undefined;
  startTime: number;
  durationHours: number;
  tz: string;
}): { fullCents: number; cents: number; offPeakHours: number } {
  const { hourlyRateCents, windows, startTime, durationHours, tz } = args;
  const fullCents = Math.round(hourlyRateCents * durationHours);
  if (!windows?.length || durationHours <= 0) return { fullCents, cents: fullCents, offPeakHours: 0 };
  let cents = 0;
  let offPeakHours = 0;
  for (let h = 0; h < durationHours; h++) {
    const share = Math.min(1, durationHours - h);
    const pct = offPeakPctAt(windows, startTime + h * HOUR, tz);
    if (pct > 0) offPeakHours += share;
    cents += hourlyRateCents * share * (1 - pct / 100);
  }
  return { fullCents, cents: Math.round(cents), offPeakHours };
}

/**
 * Off-peak or promo code, never both: the client pays whichever total is
 * lower. The promo applies to room + add-ons (today's rule); off-peak to
 * room time only. A tie goes to off-peak so the code is not spent for nothing.
 */
export function bestOfOffPeakAndPromo(args: {
  roomFullCents: number;
  roomOffPeakCents: number;
  addOnCents: number;
  promoPct: number | null;
}): { rateCents: number; applied: "off_peak" | "promo" | "none"; offPeakSavingsCents: number } {
  const { roomFullCents, roomOffPeakCents, addOnCents, promoPct } = args;
  const list = roomFullCents + addOnCents;
  const offPeakTotal = roomOffPeakCents + addOnCents;
  const promoTotal = promoPct != null ? Math.round((list * (100 - promoPct)) / 100) : list;
  if (offPeakTotal < list && offPeakTotal <= promoTotal) {
    return { rateCents: offPeakTotal, applied: "off_peak", offPeakSavingsCents: list - offPeakTotal };
  }
  if (promoPct != null) return { rateCents: promoTotal, applied: "promo", offPeakSavingsCents: 0 };
  return { rateCents: list, applied: "none", offPeakSavingsCents: 0 };
}

/** "Mon-Thu 9am-2pm, 25% off" for the booking page and settings. */
export function describeWindow(w: OffPeakWindow): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const sorted = [...new Set(w.days)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(j - i >= 2 ? `${names[sorted[i]]}-${names[sorted[j]]}` : sorted.slice(i, j + 1).map((d) => names[d]).join(", "));
    i = j;
  }
  const h = (n: number) => (n === 0 || n === 24 ? "12am" : n === 12 ? "12pm" : n < 12 ? `${n}am` : `${n - 12}pm`);
  return `${runs.join(", ")} ${h(w.startHour)}-${h(w.endHour)}, ${w.pct}% off`;
}
