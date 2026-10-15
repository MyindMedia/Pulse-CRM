import type { GoogleCalendarListEvent } from "./google";
import type { GoogleAttendee } from "./googleRoomMatch";

/* ============================================================
   The details of one event on the studio's Google calendar, as the
   pull stores them in `googleEvents` for the "From Google" review list.
   Pure. Studio-private: descriptions and guest emails never reach a
   public page and never leave the studio's own org.
   ============================================================ */

export const MAX_TITLE = 300;
export const MAX_LOCATION = 300;
export const MAX_DESCRIPTION = 2000;
export const MAX_ATTENDEES = 50;

export type EventDetails = {
  googleEventId: string;
  title: string;
  startTime: number;
  endTime: number;
  allDay: boolean;
  location?: string;
  description?: string;
  attendees: GoogleAttendee[];
  organizerEmail?: string;
  organizerName?: string;
  htmlLink?: string;
  status: "confirmed" | "tentative" | "cancelled";
  googleUpdatedAt?: number;
  recurringEventId?: string;
};

export type DetailsResult = { kind: "upsert"; details: EventDetails } | { kind: "cancel"; googleEventId: string } | { kind: "skip" };

/** Google start/end to epoch ms. `date` (all-day) is UTC midnight, matching
 *  googleCalendarSync.parseGoogleTime. */
function parseTime(t?: { dateTime?: string; date?: string }): number | null {
  if (!t) return null;
  const raw = t.dateTime ?? (t.date ? `${t.date}T00:00:00Z` : undefined);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Google descriptions are often HTML. Keep the words, drop the markup. */
export function plainText(html: string | undefined, max: number): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, k: string) => ENTITIES[k] ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function clip(s: string | undefined, max: number): string | undefined {
  const t = s?.trim();
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max) : t;
}

/** One raw Google event to the details row. Skips events Pulse wrote itself
 *  (tagged on push, or under a booking's own event id): those are already
 *  sessions. Free ("transparent") events are kept: they still describe a
 *  booking someone may want to import. */
export function mapEventDetails(raw: GoogleCalendarListEvent, pulseOwned: (id: string, raw: GoogleCalendarListEvent) => boolean): DetailsResult {
  if (!raw.id) return { kind: "skip" };
  if (pulseOwned(raw.id, raw)) return { kind: "skip" };
  if (raw.status === "cancelled") return { kind: "cancel", googleEventId: raw.id };
  const startTime = parseTime(raw.start);
  const endTime = parseTime(raw.end);
  if (startTime == null || endTime == null || endTime <= startTime) return { kind: "skip" };

  const attendees: GoogleAttendee[] = (raw.attendees ?? []).slice(0, MAX_ATTENDEES).map((a) => ({
    email: clip(a.email, 200),
    name: clip(a.displayName, 120),
    responseStatus: a.responseStatus,
    resource: a.resource ? true : undefined,
    organizer: a.organizer ? true : undefined,
    self: a.self ? true : undefined,
  }));
  const updated = raw.updated ? Date.parse(raw.updated) : NaN;
  return {
    kind: "upsert",
    details: {
      googleEventId: raw.id,
      title: clip(raw.summary, MAX_TITLE) ?? "(No title)",
      startTime,
      endTime,
      allDay: Boolean(raw.start?.date && !raw.start?.dateTime),
      location: clip(raw.location, MAX_LOCATION),
      description: plainText(raw.description, MAX_DESCRIPTION),
      attendees,
      organizerEmail: clip(raw.organizer?.email, 200),
      organizerName: clip(raw.organizer?.displayName, 120),
      htmlLink: raw.htmlLink?.startsWith("https://") ? clip(raw.htmlLink, 500) : undefined,
      status: raw.status === "tentative" ? "tentative" : "confirmed",
      googleUpdatedAt: Number.isNaN(updated) ? undefined : updated,
      recurringEventId: clip(raw.recurringEventId, 200),
    },
  };
}
