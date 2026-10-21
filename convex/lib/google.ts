/* ============================================================
   Google OAuth + Gmail send helpers (P4). Studios connect their
   own Google account to send client email as their real Gmail.
   Requires GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET on the
   deployment, and the redirect URI registered in Google Cloud:
     GOOGLE_REDIRECT_URI, or <CONVEX_SITE_URL>/google/callback when unset.
   Production uses https://studiopulse.tech/google/callback, which a Next.js
   route forwards to the Convex endpoint (docs/plans/google-calendar-setup.md).
   ============================================================ */

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events", // two-way studio calendar sync
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly", // pick which calendar
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** Scopes for a team member's personal calendar: no Gmail send. */
const MEMBER_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

/** The OAuth redirect URI. GOOGLE_REDIRECT_URI wins (production sets it to
 *  https://studiopulse.tech/google/callback, a domain Google can verify);
 *  otherwise the Convex HTTP endpoint. Sent on both the consent URL and the
 *  code exchange, so the two always match. */
export function googleRedirectUri(): string {
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const base = process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";
  return `${base}/google/callback`;
}

export function googleAuthUrl(state: string, level: "studio" | "member" = "studio"): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: (level === "member" ? MEMBER_SCOPES : SCOPES).join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
};

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  return (await res.json()) as TokenResponse;
}

/** Google refused the stored refresh token. `invalidGrant` means the grant is
 *  gone for good (the owner revoked access, the password changed, or the OAuth
 *  app is in Testing mode and the 7-day token expired): the only fix is to
 *  connect again, so callers clear the token and show "Reconnect Google". */
export class GoogleAuthError extends Error {
  constructor(
    message: string,
    readonly invalidGrant: boolean,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

/** Marker stored in the sync-error field once a token is cleared, so the UI
 *  can tell "never connected" from "needs reconnect". */
export const RECONNECT_REQUIRED = "reconnect_required";

export function isInvalidGrant(err: unknown): boolean {
  return err instanceof GoogleAuthError && err.invalidGrant;
}

export async function accessTokenFromRefresh(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    let reason = "";
    try {
      reason = String(((await res.json()) as { error?: string }).error ?? "");
    } catch {
      /* body was not JSON */
    }
    throw new GoogleAuthError(`Google token refresh failed (${res.status}${reason ? ` ${reason}` : ""})`, reason === "invalid_grant");
  }
  return ((await res.json()) as TokenResponse).access_token;
}

/** Fetch the connected account's email address (id_token is base64url JSON). */
export function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const json = JSON.parse(new TextDecoder().decode(bytes));
    return (json.email as string) ?? null;
  } catch {
    return null;
  }
}

/* No Node `Buffer` here: this module runs in Convex's default runtime, where
   Buffer is undefined. Tests run under Node, so a Buffer call stays green in
   vitest and throws in production (every Gmail send failed that way). */
function utf8ToBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64url(input: string): string {
  return utf8ToBase64(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 2047 encoded-word for a header that holds non-ASCII text. */
function encodeHeader(value: string): string {
  return /[^\x20-\x7e]/.test(value) ? `=?UTF-8?B?${utf8ToBase64(value)}?=` : value;
}

/** Build the raw RFC 822 message. Without a known address the From header is
 *  left out and Gmail fills in the connected account. */
export function gmailMime(args: { from?: string; to: string; subject: string; html: string }): string {
  return [
    ...(args.from?.includes("@") ? [`From: ${args.from}`] : []),
    `To: ${args.to}`,
    `Subject: ${encodeHeader(args.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    args.html,
  ].join("\r\n");
}

/** Send an email through the connected Gmail account via the Gmail API. */
export async function gmailSend(
  refreshToken: string,
  args: { from?: string; to: string; subject: string; html: string },
): Promise<void> {
  const accessToken = await accessTokenFromRefresh(refreshToken);
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64url(gmailMime(args)) }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Gmail send failed (${res.status}) ${detail}`.trim());
  }
}

/* ============================================================
   Google Calendar - two-way session sync.
   ============================================================ */

export type GoogleCalendarEventBody = {
  summary: string;
  /** Unset leaves the event's own description alone on a PATCH (events
   *  imported from Google keep what the studio wrote there). */
  description?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  status?: "confirmed" | "tentative" | "cancelled";
  /** "opaque" = shows as busy (the default); room blocks and bookings use it. */
  transparency?: "opaque" | "transparent";
  // Tags events Pulse creates so the inbound pull can skip them (no loop).
  extendedProperties?: { private?: Record<string, string> };
};

/** Marker written onto every Pulse-pushed event's private extended props, and
 *  read back during the inbound pull to skip our own events. */
export const PULSE_ORIGIN_TAG = "pulse";

export type GoogleCalendarListEvent = {
  id: string;
  status?: string; // "confirmed" | "tentative" | "cancelled"
  transparency?: string; // "transparent" = shows as free
  summary?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
  // Details the studio calendar pull keeps for the "From Google" review list.
  // All come back on events.list under the existing calendar.events scope.
  location?: string;
  description?: string;
  htmlLink?: string;
  updated?: string;
  recurringEventId?: string;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: {
    email?: string;
    displayName?: string;
    responseStatus?: string;
    resource?: boolean;
    organizer?: boolean;
    self?: boolean;
  }[];
};

/** Events collection URL of one calendar (primary when none is chosen). */
export function calendarBase(calendarId?: string): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || "primary")}/events`;
}

export type GoogleCalendarSummary = { id: string; name: string; primary: boolean; accessRole: string };

/** The connected account's calendars. Throws GoogleScopeMissing on a 403 so the
 *  UI can ask to reconnect (accounts connected before calendar picking existed
 *  never granted the calendar-list scope). */
export class GoogleScopeMissing extends Error {}

export async function googleCalendarList(refreshToken: string): Promise<GoogleCalendarSummary[]> {
  const accessToken = await accessTokenFromRefresh(refreshToken);
  const out: GoogleCalendarSummary[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: "250", minAccessRole: "writer" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`https://www.googleapis.com/calendar/v3/users/me/calendarList?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 403) throw new GoogleScopeMissing("calendar list scope not granted");
    if (!res.ok) throw new Error(`Google calendar list failed (${res.status})`);
    const data = (await res.json()) as {
      items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean; accessRole?: string }[];
      nextPageToken?: string;
    };
    for (const c of data.items ?? []) {
      out.push({
        id: c.id,
        name: c.summaryOverride || c.summary || c.id,
        primary: Boolean(c.primary),
        accessRole: c.accessRole ?? "writer",
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

/** Incremental list of the connected account's chosen-calendar events (primary by default).
 *  Pass `syncToken` for a delta pull; omit it (with `timeMin`) for a full pull.
 *  Returns the page of events plus the `nextSyncToken` to persist for next time.
 *  Throws `GoogleSyncTokenExpired` on a 410 so the caller can reset + full-pull. */
export class GoogleSyncTokenExpired extends Error {}

export async function googleCalendarListEvents(
  refreshToken: string,
  opts: { syncToken?: string; timeMin?: string; calendarId?: string },
): Promise<{ events: GoogleCalendarListEvent[]; nextSyncToken: string | null }> {
  const accessToken = await accessTokenFromRefresh(refreshToken);
  const events: GoogleCalendarListEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;

  // Google paginates; a full sync may span several pages before the syncToken.
  do {
    const params = new URLSearchParams({ singleEvents: "true", maxResults: "250" });
    if (opts.syncToken) params.set("syncToken", opts.syncToken);
    else if (opts.timeMin) params.set("timeMin", opts.timeMin);
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(
      `${calendarBase(opts.calendarId)}?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (res.status === 410) throw new GoogleSyncTokenExpired("syncToken expired");
    if (!res.ok) throw new Error(`Google Calendar list failed (${res.status})`);
    const data = (await res.json()) as {
      items?: GoogleCalendarListEvent[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };
    if (data.items) events.push(...data.items);
    pageToken = data.nextPageToken;
    if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
  } while (pageToken);

  return { events, nextSyncToken };
}

/** Write an event onto the connected account's primary calendar under a
 *  known id, creating it when it is not there yet. The id is chosen by Pulse
 *  (googleCalendar.pulseEventId), so two pushes racing for a new booking land
 *  on one event instead of two. Returns the id the event lives under: a fresh
 *  one only when Google refuses to reuse the id of an event it has deleted. */
export async function googleCalendarUpsertEvent(
  refreshToken: string,
  body: GoogleCalendarEventBody,
  eventId: string,
  calendarId?: string,
): Promise<{ eventId: string }> {
  const accessToken = await accessTokenFromRefresh(refreshToken);
  const base = calendarBase(calendarId);
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  const patch = () =>
    fetch(`${base}/${encodeURIComponent(eventId)}`, { method: "PATCH", headers, body: JSON.stringify(body) });
  const insert = (withId: boolean) =>
    fetch(base, { method: "POST", headers, body: JSON.stringify(withId ? { ...body, id: eventId } : body) });
  const gone = (r: Response) => r.status === 404 || r.status === 410;

  let res = await patch();
  if (gone(res)) {
    res = await insert(true);
    if (res.status === 409) {
      // The id exists: a concurrent push made it, or it belongs to a deleted event.
      res = await patch();
      if (gone(res)) res = await insert(false);
    }
  }
  if (!res.ok) throw new Error(`Google Calendar upsert failed (${res.status})`);
  const data = (await res.json()) as { id: string };
  return { eventId: data.id };
}

/** Best-effort delete - 404/410 are treated as already-gone (success). */
export async function googleCalendarDeleteEvent(
  refreshToken: string,
  eventId: string,
  calendarId?: string,
): Promise<void> {
  const accessToken = await accessTokenFromRefresh(refreshToken);
  const res = await fetch(
    `${calendarBase(calendarId)}/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Google Calendar delete failed (${res.status})`);
  }
}
