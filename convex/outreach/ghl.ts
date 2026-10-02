/* Read-only GoHighLevel calendar access for the Outreach tab.

   The agency's mapped location and calendar come from operator-verified
   settings; nothing the browser sends picks which calendar is read. Only GET
   requests to the GHL API host are made. The API key is a Convex environment
   variable and never leaves the server. */

export const GHL_BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-04-15";
const TIMEOUT_MS = 12_000;

export type CalendarInfo = {
  id: string; name: string; active: boolean; durationMin: number | null; widgetSlug: string | null; formId: string | null; autoConfirm: boolean;
};
export type SlotDay = { date: string; count: number; first: string | null };
export type Appointment = { id: string; title: string; start: number; end: number; status: string; contactName: string | null };

export type GhlResult<T> = { ok: true; data: T } | { ok: false; reason: string };

export async function ghlGet(path: string, key: string): Promise<GhlResult<unknown>> {
  if (!path.startsWith("/")) return { ok: false, reason: "Bad path" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GHL_BASE}${path}`, {
      method: "GET", signal: ctl.signal,
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json", Version: VERSION },
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: `GHL refused the key (HTTP ${res.status})` };
    if (res.status === 429) return { ok: false, reason: "GHL rate limit, try again shortly" };
    if (!res.ok) return { ok: false, reason: `GHL returned HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.name === "AbortError" ? "GHL timed out" : "Could not reach GHL" };
  } finally {
    clearTimeout(timer);
  }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Normalises slot units to minutes ("mins", "hours"). */
export function durationMinutes(duration: unknown, unit: unknown): number | null {
  const d = num(duration);
  if (d === null) return null;
  return typeof unit === "string" && /hour/i.test(unit) ? Math.round(d * 60) : d;
}

export function summarizeCalendar(raw: unknown, expectedId: string, expectedLocation: string): GhlResult<CalendarInfo> {
  const c = (raw as { calendar?: Record<string, unknown> } | null)?.calendar;
  if (!c || typeof c !== "object") return { ok: false, reason: "GHL did not return a calendar" };
  if (c.id !== expectedId) return { ok: false, reason: "GHL returned a different calendar than the one mapped" };
  if (c.locationId !== expectedLocation) return { ok: false, reason: "The calendar belongs to a different GHL location than the one mapped" };
  return {
    ok: true,
    data: {
      id: expectedId, name: str(c.name) ?? "Unnamed calendar", active: c.isActive === true,
      durationMin: durationMinutes(c.slotDuration, c.slotDurationUnit), widgetSlug: str(c.widgetSlug), formId: str(c.formId),
      autoConfirm: c.autoConfirm === true,
    },
  };
}

/** GHL returns { "YYYY-MM-DD": { slots: ["2026-10-02T09:00:00-07:00", ...] }, traceId }. */
export function summarizeSlots(raw: unknown): SlotDay[] {
  const out: SlotDay[] = [];
  if (!raw || typeof raw !== "object") return out;
  for (const [date, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const slots = (v as { slots?: unknown } | null)?.slots;
    if (!Array.isArray(slots)) continue;
    out.push({ date, count: slots.length, first: typeof slots[0] === "string" ? slots[0] : null });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function summarizeEvents(raw: unknown, calendarId: string): Appointment[] {
  const events = (raw as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) return [];
  const out: Appointment[] = [];
  for (const e of events as Array<Record<string, unknown>>) {
    if (e.calendarId !== calendarId) continue;
    const start = Date.parse(String(e.startTime ?? ""));
    const end = Date.parse(String(e.endTime ?? ""));
    const id = str(e.id);
    if (!id || !Number.isFinite(start)) continue;
    out.push({
      id, title: str(e.title) ?? "Appointment", start, end: Number.isFinite(end) ? end : start,
      status: str(e.appointmentStatus) ?? str(e.status) ?? "unknown",
      contactName: str(e.contactName) ?? str((e.contact as { name?: unknown } | undefined)?.name),
    });
  }
  return out.sort((a, b) => a.start - b.start);
}
