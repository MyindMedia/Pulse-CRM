/* Zuops: the booking calendar behind studiopulse.tech/demo. This module is READ ONLY
   on purpose. Pulse reads bookings, the calendar and the lead behind a booking; it
   never creates, moves or cancels anything in Zuops, so a bug here cannot message
   a lead. The API key (ZUOPS_API_KEY, a Convex env var) belongs to a Zuops account
   that owns more than one workspace, so every call is pinned to the workspace id
   an operator mapped to the agency, never one taken from the response or a webhook. */

import { normalizePhone } from "../lib/phone";

const ZUOPS_BASE = "https://api.zuops.com/functions/v1/api-gateway";

export type ZuopsResult = { ok: true; json: unknown } | { ok: false; reason: string };

export async function zuopsGet(path: string, params: Record<string, string | number>, fetchImpl: typeof fetch = fetch): Promise<ZuopsResult> {
  const key = process.env.ZUOPS_API_KEY;
  if (!key) return { ok: false, reason: "Zuops is off: ZUOPS_API_KEY is not set on this deployment." };
  if (!path.startsWith("/v1/") || path.includes("..")) return { ok: false, reason: "Bad Zuops path." };
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  try {
    const res = await fetchImpl(`${ZUOPS_BASE}${path}?${qs}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429) return { ok: false, reason: "Zuops is rate limiting us. It will retry on the next sync." };
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "Zuops refused the key (check its scopes: bookings:read, leads:read)." };
    if (!res.ok) return { ok: false, reason: `Zuops answered ${res.status}.` };
    const json = await res.json();
    if (json && typeof json === "object" && (json as { success?: boolean }).success === false) return { ok: false, reason: "Zuops reported an error." };
    return { ok: true, json };
  } catch {
    return { ok: false, reason: "Could not reach Zuops (timed out or network error)." };
  }
}

type Rec = Record<string, unknown>;
const rec = (x: unknown): Rec => (x && typeof x === "object" ? (x as Rec) : {});
const str = (x: unknown): string | undefined => (typeof x === "string" && x.trim() ? x.trim() : undefined);
const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined);

export type BookingStatus = "confirmed" | "cancelled" | "completed" | "no_show" | "other";

export type ZuopsBooking = {
  id: string;
  leadId?: string;
  calendarId?: string;
  title: string;
  startsAt: number;
  endsAt: number;
  timezone?: string;
  status: BookingStatus;
  location?: string;
  meetingUrl?: string;
};

const STATUS: Record<string, BookingStatus> = {
  confirmed: "confirmed", scheduled: "confirmed", booked: "confirmed", pending: "confirmed",
  cancelled: "cancelled", canceled: "cancelled", completed: "completed", no_show: "no_show", noshow: "no_show",
};

export function parseBookings(json: unknown): ZuopsBooking[] {
  const list = rec(rec(json).data).bookings;
  if (!Array.isArray(list)) return [];
  const out: ZuopsBooking[] = [];
  for (const raw of list) {
    const r = rec(raw);
    const id = str(r.id);
    const starts = Date.parse(String(r.starts_at ?? ""));
    const ends = Date.parse(String(r.ends_at ?? ""));
    if (!id || !Number.isFinite(starts) || !Number.isFinite(ends)) continue;
    out.push({
      id,
      leadId: str(r.lead_id),
      calendarId: str(r.calendar_id),
      title: (str(r.title) ?? "Pulse demo").slice(0, 200),
      startsAt: starts,
      endsAt: ends,
      timezone: str(r.timezone),
      status: STATUS[String(r.status ?? "").toLowerCase()] ?? "other",
      location: str(r.location)?.slice(0, 200),
      meetingUrl: str(r.meeting_url)?.slice(0, 500),
    });
  }
  return out;
}

export type ZuopsCalendar = {
  id: string;
  name: string;
  title?: string;
  slug?: string;
  durationMin: number;
  bufferMin: number;
  minNoticeMin: number;
  maxDaysAhead: number;
  timezone?: string;
  active: boolean;
  hours: Record<string, string[]>;
  locationLabel?: string;
};

export function parseCalendar(json: unknown, calendarId: string): ZuopsCalendar | null {
  const list = rec(rec(json).data).calendars;
  if (!Array.isArray(list)) return null;
  const c = list.map(rec).find((x) => str(x.id) === calendarId);
  if (!c) return null;
  const hours: Record<string, string[]> = {};
  for (const [day, windows] of Object.entries(rec(c.weekly_hours))) {
    hours[day] = Array.isArray(windows) ? windows.filter((w): w is string[] => Array.isArray(w) && w.length === 2).map((w) => `${w[0]}-${w[1]}`) : [];
  }
  return {
    id: calendarId,
    name: str(c.name) ?? "Calendar",
    title: str(c.title),
    slug: str(c.slug),
    durationMin: num(c.duration_minutes) ?? 30,
    bufferMin: num(c.buffer_minutes) ?? 0,
    minNoticeMin: num(c.min_notice_minutes) ?? 0,
    maxDaysAhead: num(c.max_days_ahead) ?? 14,
    timezone: str(c.timezone),
    active: c.is_active !== false,
    hours,
    locationLabel: str(c.location_label),
  };
}

export type ZuopsLead = {
  name?: string;
  email?: string;
  consent: { sms?: boolean; call?: boolean; email?: boolean };
  emailOptOut: boolean;
  /** Kept only so the confirmation call can dial it. E.164 when it parses. */
  phone?: string;
};

function leadPhone(l: Rec, cf: Rec): string | undefined {
  const raw = str(l.phone) ?? str(l.phone_number) ?? str(l.mobile) ?? str(cf.phone) ?? str(cf.phone_number);
  if (!raw) return undefined;
  const n = normalizePhone(raw);
  return n ?? undefined;
}

/** The few fields Pulse keeps from a Zuops lead. The phone is kept only for the
 *  confirmation call (on outreachBookings, never logged); no address or raw
 *  payload is stored. The three consent answers come from the intake form. */
export function parseLead(json: unknown): ZuopsLead | null {
  const data = rec(rec(json).data);
  const l = rec(data.lead ?? data);
  if (!str(l.id)) return null;
  const cf = rec(l.custom_fields);
  const bool = (k: string) => (typeof cf[k] === "boolean" ? (cf[k] as boolean) : undefined);
  return {
    name: str(l.full_name)?.slice(0, 120),
    email: str(l.email)?.toLowerCase().slice(0, 200),
    consent: { sms: bool("pulse_sms_marketing_consent"), call: bool("pulse_automated_call_consent"), email: bool("pulse_email_marketing_consent") },
    emailOptOut: l.email_opt_out === true,
    phone: leadPhone(l, cf),
  };
}

/* ------------------------------ webhooks ------------------------------ */

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** `X-Zuops-Signature: sha256=<hex hmac of the raw body>`, compared in constant time. */
export async function verifySignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header || !secret) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const got = m[1].toLowerCase();
  if (expected.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}
