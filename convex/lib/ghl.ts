/* GHL (LeadConnector) client for the Social Planner. Resolved PER ORG so a
   studio can be moved to its own GHL sub-account by setting orgs.ghl; the
   default is the platform location Pulse already uses for SMS. Returns null
   when unconfigured so every caller degrades to simulated mode. */

export type GhlCtx = { locationId: string; token: string; userId: string };
export type Platform =
  | "google" | "facebook" | "instagram" | "linkedin" | "tiktok"
  | "tiktok-business" | "youtube" | "pinterest" | "threads" | "bluesky";

export const PLATFORMS: Platform[] = [
  "google", "facebook", "instagram", "linkedin", "tiktok",
  "tiktok-business", "youtube", "pinterest", "threads", "bluesky",
];

const BASE = "https://services.leadconnectorhq.com";
const UA = "Pulse/1.0 (+https://pulse.myindsound.com)";

export function ghlFromEnv(
  org: { ghl?: { locationId: string; tokenRef: string } } | null,
): GhlCtx | null {
  const userId = process.env.GHL_SOCIAL_USER_ID ?? "";
  if (org?.ghl) {
    const token = process.env[org.ghl.tokenRef] ?? "";
    if (!token || !org.ghl.locationId || !userId) return null;
    return { locationId: org.ghl.locationId, token, userId };
  }
  const token = process.env.GHL_API_KEY ?? "";
  const locationId = process.env.GHL_LOCATION_ID ?? "";
  if (!token || !locationId || !userId) return null;
  return { locationId, token, userId };
}

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; status: number; message: string };

export async function ghlFetch<T>(
  g: GhlCtx,
  path: string,
  init: { method?: string; body?: unknown; version?: string } = {},
): Promise<Ok<T> | Err> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${g.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Version: init.version ?? "2021-07-28",
        "User-Agent": UA,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      const message =
        (json as { message?: string | string[] } | null)?.message ?? `GHL ${res.status}`;
      return { ok: false, status: res.status, message: Array.isArray(message) ? message.join("; ") : String(message) };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : "network error" };
  }
}

/* The OAuth start endpoint is a redirect endpoint, not a JSON endpoint.
   GHL answers with HTTP 302 and the OAuth URL in the Location header, so
   this needs its own fetch with manual redirect handling instead of going
   through ghlFetch (which follows redirects and expects a JSON body).
   A 200 with a JSON { url } or { redirectUrl } body is kept as a fallback
   in case some platform ever answers that way instead of redirecting. */
export async function startOAuth(g: GhlCtx, platform: Platform, reconnect = false) {
  const q = new URLSearchParams({ locationId: g.locationId, userId: g.userId });
  if (reconnect) q.set("reconnect", "true");
  let res: Response;
  try {
    res = await fetch(`${BASE}/social-media-posting/oauth/${platform}/start?${q.toString()}`, {
      method: "GET",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${g.token}`,
        Accept: "application/json",
        Version: "2021-07-28",
        "User-Agent": UA,
      },
    });
  } catch {
    return null;
  }
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    return location ? { url: location } : null;
  }
  if (res.status < 200 || res.status >= 300) return null;
  const text = await res.text();
  let json: { url?: string; redirectUrl?: string } | null = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  const url = json?.url ?? json?.redirectUrl;
  return url ? { url } : null;
}

export type GhlChoice = { id: string; name: string; type?: string; avatar?: string };

/** Unused by the connect flow as of the roster-based rewrite in
 *  convex/marketing/accounts.ts: proven live against production, the PIT
 *  this app runs under is not authorised for this endpoint's scope ("The
 *  token is not authorized for this scope."), and fixing that needs the
 *  account owner to log into the GHL UI - not something Pulse can do for
 *  itself. Left in place, not deleted, in case that scope is ever granted:
 *  attachOAuthAccount below still calls the sibling POST on this same path
 *  as the fallback for any account not already on the plain accounts
 *  roster (listAccounts), so the oauth path is not fully dead either way. */
export async function listOAuthAccounts(g: GhlCtx, platform: Platform, accountId: string): Promise<GhlChoice[]> {
  const r = await ghlFetch<{ results?: { pages?: GhlChoice[]; accounts?: GhlChoice[]; profiles?: GhlChoice[] } }>(
    g, `/social-media-posting/oauth/${g.locationId}/${platform}/accounts/${accountId}`,
  );
  if (!r.ok) return [];
  const res = r.data.results ?? {};
  return res.pages ?? res.accounts ?? res.profiles ?? [];
}

export async function attachOAuthAccount(
  g: GhlCtx, platform: Platform, accountId: string, choice: { id: string; name: string; type?: string },
) {
  const r = await ghlFetch<{ results?: { id?: string; name?: string; avatar?: string } }>(
    g, `/social-media-posting/oauth/${g.locationId}/${platform}/accounts/${accountId}`,
    { method: "POST", body: { originId: choice.id, name: choice.name, type: choice.type ?? "page" } },
  );
  if (!r.ok) return null;
  const a = r.data.results ?? {};
  return { id: a.id ?? accountId, name: a.name ?? choice.name, avatar: a.avatar };
}

export type GhlPostInput = {
  accountIds: string[];
  summary: string;
  media: { url: string; type: string }[];
  scheduleDate: string;            // ISO, UTC
  type: "post" | "story" | "reel";
  followUpComment?: string;
  gmbPostDetails?: { title?: string; offerDetails?: { couponCode?: string; redeemOnlineUrl?: string; termsConditions?: string }; startDate?: string; endDate?: string };
  tiktokPostDetails?: { privacyLevel: "PUBLIC_TO_EVERYONE" | "SELF_ONLY"; promoteOtherBrand?: boolean; enableComment?: boolean };
};

export async function createScheduledPost(g: GhlCtx, input: GhlPostInput): Promise<{ id: string } | { error: string }> {
  const r = await ghlFetch<{ results?: { post?: { _id?: string; id?: string } } }>(
    g, `/social-media-posting/${g.locationId}/posts`,
    { method: "POST", body: { ...input, status: "scheduled", userId: g.userId } },
  );
  if (!r.ok) return { error: r.message };
  const id = r.data.results?.post?._id ?? r.data.results?.post?.id;
  return id ? { id } : { error: "GHL returned no post id" };
}

export async function deletePost(g: GhlCtx, ghlPostId: string): Promise<boolean> {
  const r = await ghlFetch(g, `/social-media-posting/${g.locationId}/posts/${ghlPostId}`, { method: "DELETE" });
  return r.ok;
}

export type GhlPostSummary = { _id: string; status: string; publishedAt?: string; error?: string };

export async function listPosts(
  g: GhlCtx, input: { accountIds: string[]; fromDate: string; toDate: string },
): Promise<GhlPostSummary[]> {
  const r = await ghlFetch<{ results?: { posts?: GhlPostSummary[] } }>(
    g, `/social-media-posting/${g.locationId}/posts/list`,
    { method: "POST", body: { type: "all", accounts: input.accountIds.join(","), fromDate: input.fromDate, toDate: input.toDate, skip: 0, limit: 200 } },
  );
  return r.ok ? (r.data.results?.posts ?? []) : [];
}

export async function accountStats(
  g: GhlCtx, accountIds: string[],
): Promise<Record<string, { followers?: number; reach?: number }>> {
  const r = await ghlFetch<{ results?: Record<string, { followers?: number; reach?: number }> }>(
    g, `/social-media-posting/statistics`,
    { method: "POST", body: { locationId: g.locationId, accountIds } },
  );
  return r.ok ? (r.data.results ?? {}) : {};
}

export type GhlAccountStatus = {
  id: string;
  oauthId?: string;
  name?: string;
  avatar?: string;
  platform?: string;
  type?: string;
  expire?: string;
  isExpired?: boolean;
  deleted?: boolean;
};

/** Full roster of every account GHL currently has on file for this
 *  location, expiry and deletion flags included. Used by the account-health
 *  sweep to tell a live authorisation from an expired, deleted or revoked
 *  one.
 *
 *  GHL nests the roster as `results.accounts`, not `results` itself -
 *  `results` also carries a sibling `groups` array this caller has no use
 *  for.
 *
 *  Returns null, never [], when the call itself failed or came back in a
 *  shape this cannot trust (a non-2xx, a network error, or a missing/
 *  malformed `results.accounts` array) - a caller that treated null the same
 *  as an empty list would read "GHL is unreachable" as "every account is
 *  gone," which is exactly the failure mode the sweep must not have. */
export async function listAccounts(g: GhlCtx): Promise<GhlAccountStatus[] | null> {
  const r = await ghlFetch<{ results?: { accounts?: GhlAccountStatus[] } }>(g, `/social-media-posting/${g.locationId}/accounts`);
  if (!r.ok) return null;
  const accounts = r.data?.results?.accounts;
  return Array.isArray(accounts) ? accounts : null;
}
