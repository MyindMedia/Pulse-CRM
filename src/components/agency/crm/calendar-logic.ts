/* Pure Calendar logic, unit tested in calendar-logic.test.ts: time zones, the
   agenda grouped by day, the 7 column week grid, open slots by day, appointment
   status words, business hours in words, the booking body and busy block checks.
   No React, no Convex. */

import type { Booking, Calendar, WeeklyHours } from "./calendar-types";

export const DAY_MS = 86_400_000;

function okZone(tz: string | null | undefined): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

/** "2026-11-12": the calendar date of an instant in a time zone (the browser's
 *  when none, or an unknown one, is given). */
export function dateKeyIn(ms: number, tz?: string | null): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: okZone(tz), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "2:00 PM" in a time zone. */
export function timeIn(ms: number, tz?: string | null): string {
  return new Date(ms).toLocaleTimeString("en-US", { timeZone: okZone(tz), hour: "numeric", minute: "2-digit" });
}

/** "PST" / "GMT-8" for a zone at an instant. */
export function zoneName(ms: number, tz?: string | null): string {
  const z = okZone(tz);
  if (!z) return "";
  const p = new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "short" }).formatToParts(new Date(ms));
  return p.find((x) => x.type === "timeZoneName")?.value ?? "";
}

function keyMs(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

/** "Thu, Nov 12" for a date key. */
export function dayLabel(key: string, withYear = false): string {
  return new Date(keyMs(key)).toLocaleDateString("en-US", {
    timeZone: "UTC", weekday: "short", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}),
  });
}

export function addDays(key: string, n: number): string {
  return new Date(keyMs(key) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Monday of the week holding this date key. */
export function weekStart(key: string): string {
  const dow = new Date(keyMs(key)).getUTCDay(); // 0 Sunday
  return addDays(key, dow === 0 ? -6 : 1 - dow);
}

const ms = (iso: string | null | undefined): number => {
  const v = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(v) ? v : NaN;
};

/** The appointments list window: today minus 7 days to today plus 60. */
export function bookingsWindow(now: number): { from: string; to: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return { from: new Date(start.getTime() - 7 * DAY_MS).toISOString(), to: new Date(start.getTime() + 61 * DAY_MS).toISOString() };
}

export type DayGroup<T> = { key: string; label: string; items: T[] };

/** Appointments by day, soonest first. Each one's day is read in its own zone. */
export function agendaDays(bookings: Booking[], now: number, fallbackTz?: string | null): DayGroup<Booking>[] {
  const sorted = bookings.filter((b) => Number.isFinite(ms(b.starts_at))).sort((a, b) => ms(a.starts_at) - ms(b.starts_at));
  const today = dateKeyIn(now, fallbackTz);
  const out = new Map<string, DayGroup<Booking>>();
  for (const b of sorted) {
    const key = dateKeyIn(ms(b.starts_at), b.timezone ?? fallbackTz);
    if (!out.has(key)) {
      const label = key === today ? `Today · ${dayLabel(key)}` : key === addDays(today, 1) ? `Tomorrow · ${dayLabel(key)}` : dayLabel(key, key.slice(0, 4) !== today.slice(0, 4));
      out.set(key, { key, label, items: [] });
    }
    out.get(key)!.items.push(b);
  }
  return [...out.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Seven columns from a Monday, each holding its appointments by start time. */
export function buildWeek(bookings: Booking[], startKey: string, fallbackTz?: string | null): DayGroup<Booking>[] {
  const cols: DayGroup<Booking>[] = Array.from({ length: 7 }, (_, i) => {
    const key = addDays(startKey, i);
    return { key, label: dayLabel(key), items: [] };
  });
  const byKey = new Map(cols.map((c) => [c.key, c]));
  for (const b of bookings) {
    const t = ms(b.starts_at);
    if (!Number.isFinite(t)) continue;
    byKey.get(dateKeyIn(t, b.timezone ?? fallbackTz))?.items.push(b);
  }
  for (const c of cols) c.items.sort((a, b) => ms(a.starts_at) - ms(b.starts_at));
  return cols;
}

export type SlotDay = { date: string; label: string; slots: Array<{ iso: string; label: string }> };

/** Open slots by day in the calendar's zone. Uses Zuops's `days` when given,
 *  else groups `slots` itself. */
export function slotDays(
  slots: string[] | null | undefined,
  days: Array<{ date: string; label?: string | null; slots?: string[] | null }> | null | undefined,
  tz?: string | null,
): SlotDay[] {
  const fmt = (iso: string) => ({ iso, label: timeIn(ms(iso), tz) });
  if (days && days.length) {
    return days
      .map((d) => ({ date: d.date, label: d.label || dayLabel(d.date), slots: (d.slots ?? []).filter((s) => Number.isFinite(ms(s))).map(fmt) }))
      .filter((d) => d.slots.length > 0);
  }
  const out = new Map<string, SlotDay>();
  for (const s of slots ?? []) {
    const t = ms(s);
    if (!Number.isFinite(t)) continue;
    const key = dateKeyIn(t, tz);
    if (!out.has(key)) out.set(key, { date: key, label: dayLabel(key), slots: [] });
    out.get(key)!.slots.push(fmt(s));
  }
  for (const d of out.values()) d.slots.sort((a, b) => ms(a.iso) - ms(b.iso));
  return [...out.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export type StatusTone = "positive" | "caution" | "critical" | "info" | "neutral";
export type StatusIcon = "confirmed" | "completed" | "no_show" | "cancelled" | "other";

export function statusInfo(status: string | null | undefined): { word: string; tone: StatusTone; icon: StatusIcon } {
  switch (status) {
    case "scheduled": case "confirmed": case "booked": return { word: "Confirmed", tone: "positive", icon: "confirmed" };
    case "completed": return { word: "Completed", tone: "info", icon: "completed" };
    case "no_show": return { word: "No show", tone: "caution", icon: "no_show" };
    case "cancelled": case "canceled": return { word: "Cancelled", tone: "critical", icon: "cancelled" };
    default: return { word: status ? status[0].toUpperCase() + status.slice(1).replace(/_/g, " ") : "Unknown", tone: "neutral", icon: "other" };
  }
}

/** A past appointment still marked confirmed: its outcome was never recorded. */
export function outcomeMissing(b: Booking, now: number): boolean {
  const end = ms(b.ends_at ?? b.starts_at);
  return Number.isFinite(end) && end < now && (b.status === "scheduled" || b.status === "confirmed");
}

export function minutesBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  const x = ms(a), y = ms(b);
  return Number.isFinite(x) && Number.isFinite(y) && y > x ? Math.round((y - x) / 60_000) : null;
}

export function lengthWord(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function meetingWord(type: string | null | undefined): string {
  switch (type) {
    case "phone": return "Phone call";
    case "video": case "google_meet": case "zoom": return "Video call";
    case "in_person": return "In person";
    case "customer_address": return "At the customer's address";
    case "custom": return "Custom";
    default: return type ? type[0].toUpperCase() + type.slice(1).replace(/_/g, " ") : "";
  }
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_NAME: Record<(typeof DAYS)[number], string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h)) return hhmm;
  const hr = ((h + 11) % 12) + 1;
  return `${hr}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 || h === 24 ? "AM" : "PM"}`;
}

/** Weekly hours in words: "Mon to Fri 9 AM to 5 PM; Sat, Sun closed". */
export function hoursSummary(hours: WeeklyHours | null | undefined): string {
  if (!hours) return "No hours set";
  const windows = (d: (typeof DAYS)[number]) =>
    (hours[d] ?? []).filter((p) => Array.isArray(p) && p.length >= 2).map((p) => `${clock(p[0])} to ${clock(p[1])}`).join(", ") || "closed";
  const runs: Array<{ from: number; to: number; text: string }> = [];
  DAYS.forEach((d, i) => {
    const text = windows(d);
    const last = runs[runs.length - 1];
    if (last && last.text === text && last.to === i - 1) last.to = i;
    else runs.push({ from: i, to: i, text });
  });
  if (runs.every((r) => r.text === "closed")) return "Closed every day";
  return runs
    .map((r) => {
      const days = r.from === r.to ? DAY_NAME[DAYS[r.from]] : r.to === r.from + 1 ? `${DAY_NAME[DAYS[r.from]]}, ${DAY_NAME[DAYS[r.to]]}` : `${DAY_NAME[DAYS[r.from]]} to ${DAY_NAME[DAYS[r.to]]}`;
      return `${days} ${r.text}`;
    })
    .join("; ");
}

/** A calendar with pricing options must have one picked before slots or booking. */
export function calendarOptions(c: Calendar | null | undefined) {
  return { options: c?.pricing?.options ?? [], addons: c?.pricing?.addons ?? [], needsOption: (c?.pricing?.options ?? []).length > 0 };
}

export type BookForm = {
  leadId: string | null;
  calendarId: string | null;
  optionId: string | null;
  addonIds: string[];
  slot: string | null;
  notify: boolean;
};

/** The body for POST /v1/bookings, or why it cannot be sent yet. */
export function bookBody(f: BookForm, calendar: Calendar | null | undefined): { body: Record<string, unknown> } | { error: string } {
  if (!f.leadId) return { error: "Pick the lead to book." };
  if (!f.calendarId || !calendar) return { error: "Pick a calendar." };
  const { needsOption } = calendarOptions(calendar);
  if (needsOption && !f.optionId) return { error: `Pick ${calendar.pricing?.options_label?.toLowerCase() || "an option"} first.` };
  if (!f.slot) return { error: "Pick an open time." };
  const body: Record<string, unknown> = { lead_id: f.leadId, calendar_id: f.calendarId, starts_at: f.slot, notify_lead: f.notify };
  if (f.optionId) body.option_id = f.optionId;
  if (f.optionId && f.addonIds.length) body.addon_ids = f.addonIds;
  if (calendar.timezone) body.timezone = calendar.timezone;
  return { body };
}

/** Today's date key in the browser, for the availability `from`. */
export function todayKey(now: number): string {
  return dateKeyIn(now);
}

/** Start and end (datetime-local values) of a busy block, checked: end after
 *  start, at most 31 days long. */
export function busyRange(startLocal: string, endLocal: string): { ok: true; starts_at: string; ends_at: string } | { ok: false; reason: string } {
  const a = startLocal ? new Date(startLocal).getTime() : NaN;
  const b = endLocal ? new Date(endLocal).getTime() : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { ok: false, reason: "Pick a start and an end." };
  if (b <= a) return { ok: false, reason: "The end must be after the start." };
  if (b - a > 31 * DAY_MS) return { ok: false, reason: "A busy block can be at most 31 days long." };
  return { ok: true, starts_at: new Date(a).toISOString(), ends_at: new Date(b).toISOString() };
}

/** Busy blocks per team member, by name; a two-person block shows under both. */
export function busyByMember<T extends { team_members?: Array<{ id?: string | null; email?: string | null; name?: string | null }> | null; starts_at?: string | null }>(
  blocks: T[],
): Array<{ key: string; name: string; blocks: T[] }> {
  const out = new Map<string, { key: string; name: string; blocks: T[] }>();
  for (const b of blocks) {
    const people = b.team_members?.length ? b.team_members : [{ id: null, email: null, name: null }];
    for (const p of people) {
      const key = p.id || p.email || "unknown";
      if (!out.has(key)) out.set(key, { key, name: p.name || p.email || "Unknown team member", blocks: [] });
      out.get(key)!.blocks.push(b);
    }
  }
  for (const g of out.values()) g.blocks.sort((a, b) => ms(a.starts_at) - ms(b.starts_at));
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
