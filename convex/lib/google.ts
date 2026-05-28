/* ============================================================
   Google OAuth + Gmail send helpers (P4). Studios connect their
   own Google account to send client email as their real Gmail.
   Requires GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET on the
   deployment, and the redirect URI registered in Google Cloud:
     <CONVEX_SITE_URL>/google/callback
   ============================================================ */

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events", // two-way studio calendar sync
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** The OAuth callback lands on the Convex HTTP endpoint (stable, server-side). */
export function googleRedirectUri(): string {
  const base = process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";
  return `${base}/google/callback`;
}

export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
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
  if (!res.ok) throw new Error(`Google token refresh failed (${res.status})`);
  return ((await res.json()) as TokenResponse).access_token;
}

/** Fetch the connected account's email address (id_token is base64url JSON). */
export function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return (json.email as string) ?? null;
  } catch {
    return null;
  }
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Send an email through the connected Gmail account via the Gmail API. */
export async function gmailSend(
  refreshToken: string,
  args: { from: string; to: string; subject: string; html: string },
): Promise<void> {
  const accessToken = await accessTokenFromRefresh(refreshToken);
  const mime = [
    `From: ${args.from}`,
    `To: ${args.to}`,
    `Subject: ${args.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    args.html,
  ].join("\r\n");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64url(mime) }),
  });
  if (!res.ok) throw new Error(`Gmail send failed (${res.status})`);
}

/* ============================================================
   Google Calendar - two-way session sync.
   ============================================================ */

export type GoogleCalendarEventBody = {
  summary: string;
  description?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  status?: "confirmed" | "tentative" | "cancelled";
};

/** Create (POST) or patch (PATCH) an event on the connected account's primary
 *  calendar. Returns the Google event id so the caller can persist it for
 *  future patches/deletes. */
export async function googleCalendarUpsertEvent(
  refreshToken: string,
  body: GoogleCalendarEventBody,
  eventId?: string,
): Promise<{ eventId: string }> {
  const accessToken = await accessTokenFromRefresh(refreshToken);
  const base = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  const url = eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
  const method = eventId ? "PATCH" : "POST";
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Google Calendar upsert failed (${res.status})`);
  const data = (await res.json()) as { id: string };
  return { eventId: data.id };
}

/** Best-effort delete - 404/410 are treated as already-gone (success). */
export async function googleCalendarDeleteEvent(
  refreshToken: string,
  eventId: string,
): Promise<void> {
  const accessToken = await accessTokenFromRefresh(refreshToken);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Google Calendar delete failed (${res.status})`);
  }
}
