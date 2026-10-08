/* Pure rules for the confirmation call: no database, no network, no clock.
   Every gate fails closed. See openspec/changes/confirmation-calls/design.md. */

import { normalizePhone } from "../lib/phone";
import { isValidTimezone } from "../lib/tz";
import { areaCodeZones, isUsTimezone } from "./areaCodes";

export type CallSettings = {
  enabled: boolean;
  mode: "dry_run" | "live";
  delayMinutes: number;
  windowStart: string; // "HH:MM" in the callee's zone (the phone's area code, and the booking's zone too)
  windowEnd: string;
  windowDays: number[]; // 0 = Sunday ... 6 = Saturday
  timezone: string; // agency default zone: the cap's calendar day
  dailyCap: number;
  maxDurationMinutes: number;
  killSwitch: boolean;
  allowTestBookings: boolean;
  fromNumber: string;
  voice?: string;
  enabledAt?: number;
};

/* Everything is OFF and in dry run until an owner says otherwise. */
export const DEFAULT_SETTINGS: CallSettings = {
  enabled: false,
  mode: "dry_run",
  delayMinutes: 5,
  windowStart: "09:00",
  windowEnd: "20:00",
  windowDays: [0, 1, 2, 3, 4, 5, 6],
  timezone: "America/Los_Angeles",
  dailyCap: 5,
  maxDurationMinutes: 5,
  killSwitch: false,
  allowTestBookings: false,
  fromNumber: "+14086921713",
};

/** The booking must start at least this many minutes after the delay, or the call is pointless. */
export const MIN_LEAD_BUFFER_MIN = 5;
const MIN = 60_000;

export type BookingFacts = {
  /** True once the Zuops lead behind the booking has been read (consent and phone are current). */
  leadSynced: boolean;
  /** Raw consent.call as stored. Only the boolean `true` counts. */
  consentCall: unknown;
  status: string;
  startsAt: number;
  /** Convex _creationTime of the booking row: when Pulse first saw it. */
  firstSeenAt: number;
  timezone?: string;
  phone?: string;
  name?: string;
  email?: string;
};

export type Facts = {
  optedOut: boolean;
  suppressed: boolean;
  /** Calls already dialed today (agency zone), counted per the cap rules. */
  usedToday: number;
  /** When this call becomes due (first seen + delay). */
  scheduledFor: number;
};

export type Decision =
  | { kind: "ok"; trail: string[]; calleeTz: string; phone: string }
  | { kind: "wait"; reason: string; trail: string[] }
  | { kind: "skip"; reason: string; trail: string[] }
  | { kind: "cancel"; reason: string; trail: string[] };

export const NANP = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

/** E.164 North American number, or null. The calling-window rules here are US rules. */
export function usPhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const n = normalizePhone(raw);
  return n && NANP.test(n) ? n : null;
}

export function maskPhone(phone: string | undefined | null): string {
  if (!phone) return "no number";
  const d = phone.replace(/\D/g, "");
  if (d.length < 10) return "***";
  const cc = d.length > 10 ? d.slice(0, d.length - 10) : "1";
  return `+${cc} ${d.slice(-10, -7)}-***-${d.slice(-4)}`;
}

const TEST_WORDS = /\b(test|testing|tester|asdf|qwerty|fake|dummy|sample|lorem|john doe|jane doe)\b/i;
const TEST_EMAIL = /(^test[a-z0-9._+-]*@|@(example\.(com|org|net)|test\.com|mailinator\.com)$)/i;

/** Does this booking look like someone testing the form rather than a real lead? */
export function looksLikeTest(name?: string, email?: string): boolean {
  const n = (name ?? "").trim();
  if (n.length < 2) return true;
  if (TEST_WORDS.test(n)) return true;
  return Boolean(email && TEST_EMAIL.test(email.trim()));
}

const WDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Local minutes since midnight, weekday and calendar day for a moment in a zone. */
export function localParts(ts: number, tz: string): { minutes: number; dow: number; ymd: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ts));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    dow: WDAY[get("weekday")] ?? 0,
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

export function parseHHMM(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function inWindow(ts: number, tz: string, s: Pick<CallSettings, "windowStart" | "windowEnd" | "windowDays">): boolean {
  const start = parseHHMM(s.windowStart);
  const end = parseHHMM(s.windowEnd);
  if (start === null || end === null || start >= end) return false; // a bad window never opens
  const l = localParts(ts, tz);
  return s.windowDays.includes(l.dow) && l.minutes >= start && l.minutes < end;
}

/** The agency calendar day a moment falls on, for the daily cap. */
export function capDay(ts: number, tz: string): string {
  return localParts(ts, tz).ymd;
}

/** Decide what to do with one booking right now. */
export function evaluate(b: BookingFacts, s: CallSettings, f: Facts, now: number): Decision {
  const trail: string[] = [];
  const skip = (reason: string): Decision => ({ kind: "skip", reason, trail: [...trail, `skip:${reason}`] });

  if (b.status === "cancelled") return { kind: "cancel", reason: "booking_cancelled", trail: ["booking cancelled"] };
  if (b.status !== "confirmed") return skip("not_confirmed");
  trail.push("status=confirmed");

  // Consent arrives with the lead. Until the lead is read, "no consent" would be a guess.
  if (!b.leadSynced) return { kind: "wait", reason: "awaiting_lead", trail: [...trail, "wait:awaiting_lead"] };
  if (b.consentCall !== true) return skip("no_consent");
  trail.push("consent.call=true");

  if (b.firstSeenAt < (s.enabledAt ?? Infinity)) return skip("predates_enable");
  trail.push("booked after calls were enabled");

  if (f.optedOut) return skip("opted_out");
  if (f.suppressed) return skip("suppressed");
  trail.push("not on the opt-out or suppression list");

  if (!s.allowTestBookings && looksLikeTest(b.name, b.email)) return skip("test_booking");
  trail.push(s.allowTestBookings ? "test names allowed" : "name does not look like a test");

  const need = (s.delayMinutes + MIN_LEAD_BUFFER_MIN) * MIN;
  if (b.startsAt - now < need) return skip("too_close");
  trail.push(`starts in ${Math.round((b.startsAt - now) / MIN)} min (needs ${s.delayMinutes + MIN_LEAD_BUFFER_MIN})`);

  const phone = usPhone(b.phone);
  if (!b.phone) return { kind: "wait", reason: "no_phone", trail: [...trail, "wait:no_phone"] };
  if (!phone) return skip("invalid_phone");
  trail.push("phone is a valid US number");

  /* The booking's zone is typed by whoever booked, so it never decides alone when
     a phone rings. The number's area code does; a booking zone, when given, must
     also be a US zone and the window must hold there as well. */
  const zones = areaCodeZones(phone);
  if (!zones) return skip("unknown_area_code");
  if (b.timezone && !(isValidTimezone(b.timezone) && isUsTimezone(b.timezone))) return skip("non_us_timezone");
  trail.push(`area code zone ${zones.join(" / ")}`);

  if (f.scheduledFor > now) return { kind: "wait", reason: "not_due", trail: [...trail, "wait:not_due"] };
  trail.push(`due (delay ${s.delayMinutes} min)`);

  const tz = b.timezone || zones[0];
  const check = [...new Set([...zones, tz])];
  const closed = check.find((z) => !inWindow(now, z, s));
  if (closed) return { kind: "wait", reason: "outside_window", trail: [...trail, `wait:outside_window (${closed})`] };
  trail.push(`inside window ${s.windowStart}-${s.windowEnd} ${check.join(", ")}`);

  if (f.usedToday >= s.dailyCap) return { kind: "wait", reason: "daily_cap", trail: [...trail, `wait:daily_cap ${f.usedToday}/${s.dailyCap}`] };
  trail.push(`daily cap ${f.usedToday}/${s.dailyCap}`);

  return { kind: "ok", trail, calleeTz: tz, phone };
}

/** Validate an owner edit. Returns an error message or null. */
export function validateSettings(s: Partial<CallSettings>): string | null {
  if (s.delayMinutes !== undefined && !(Number.isInteger(s.delayMinutes) && s.delayMinutes >= 1 && s.delayMinutes <= 120)) return "Delay must be 1 to 120 minutes";
  if (s.dailyCap !== undefined && !(Number.isInteger(s.dailyCap) && s.dailyCap >= 1 && s.dailyCap <= 100)) return "Daily cap must be 1 to 100";
  if (s.maxDurationMinutes !== undefined && !(Number.isInteger(s.maxDurationMinutes) && s.maxDurationMinutes >= 1 && s.maxDurationMinutes <= 15)) return "Max call length must be 1 to 15 minutes";
  if (s.timezone !== undefined && !isValidTimezone(s.timezone)) return "Unknown time zone";
  const a = s.windowStart !== undefined ? parseHHMM(s.windowStart) : undefined;
  const z = s.windowEnd !== undefined ? parseHHMM(s.windowEnd) : undefined;
  if (a === null || z === null) return "Window times must look like 09:00";
  if (a !== undefined && z !== undefined && a >= z) return "The window must end after it starts";
  if (s.windowDays !== undefined && (s.windowDays.length === 0 || s.windowDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) return "Pick at least one calling day";
  if (s.fromNumber !== undefined && !/^\+[1-9]\d{7,14}$/.test(s.fromNumber)) return "From number must be E.164, like +14086921713";
  return null;
}

/** Phrases a person says to stop calls. Over-matching is deliberate. */
const STOP = /\b(stop calling|do not call|don'?t call|do not contact|don'?t contact|take me off|remove me|remove my number|unsubscribe|stop contacting|never call|no more calls|put me on the do not call)\b/i;

/** Did the callee ask not to be called again? Looks at Bland's disposition and the callee's own lines. */
export function isOptOut(payload: Record<string, unknown>): boolean {
  if (typeof payload.disposition_tag === "string" && payload.disposition_tag.toUpperCase() === "DO_NOT_CONTACT") return true;
  const tr = payload.transcripts;
  if (Array.isArray(tr)) {
    for (const t of tr) {
      const r = t as { user?: unknown; text?: unknown };
      if (r.user === "user" && typeof r.text === "string" && STOP.test(r.text)) return true;
    }
  } else if (typeof payload.concatenated_transcript === "string") {
    for (const line of payload.concatenated_transcript.split(/\n/)) {
      if (/^\s*user:/i.test(line) && STOP.test(line)) return true;
    }
  }
  return false;
}

/** "Thursday, October 9 at 2:30 PM PDT", in the callee's zone. */
export function formatDemoTime(ts: number, tz: string): string {
  const d = new Date(ts);
  const day = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: tz });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz, timeZoneName: "short" });
  return `${day} at ${time}`;
}
