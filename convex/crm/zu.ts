/* The one HTTP client for the agency CRM (design D4). Pure: no Convex imports, so
   it is unit tested with a stub fetch. It never throws, never logs, and never puts
   the key anywhere but the Authorization header. Every failure comes back as a
   short reason a non-engineer can act on. */

export const ZU_BASE = "https://api.usezu.com";

/** F-B13: a local mock of Zuops for verifying write flows. Honored only for an exact
 *  loopback http address with a port; anything else is ignored. */
export const MOCK_URL = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;
/** The only Authorization a mock request ever carries; real keys are never read in mock mode. */
export const MOCK_KEY = "zu-mock";

/** The mock base when ZUOPS_CRM_MOCK_URL is a valid loopback address, else null. Call inside a handler. */
export function mockBase(): string | null {
  const raw = process.env.ZUOPS_CRM_MOCK_URL ?? "";
  return MOCK_URL.test(raw) ? raw : null;
}

/** Which base and keys a request uses, read from the environment (call inside a handler).
 *  Mock mode: the loopback base and MOCK_KEY for both keys; the real keys are never read.
 *  Otherwise: no base override, and the keys as set ("" when unset). */
export function zuTarget(): { mock: string | null; apiKey: string; adminKey: string } {
  const mock = mockBase();
  if (mock) return { mock, apiKey: MOCK_KEY, adminKey: MOCK_KEY };
  return { mock: null, apiKey: process.env.ZUOPS_CRM_API_KEY ?? "", adminKey: process.env.ZUOPS_CRM_ADMIN_KEY ?? "" };
}

/** ZUOPS_CRM_WRITES is exactly "on". Call inside a handler. */
export function zuWritesOn(): boolean {
  return process.env.ZUOPS_CRM_WRITES === "on";
}

export type ZuLimits ={ contactsLimit?: number; contactsUsed?: number; contactsRemaining?: number; rateRemaining?: number };

export type ZuResult =
  | { ok: true; status: number; data: unknown; limits: ZuLimits }
  | { ok: false; status: number; code: string; reason: string; retryAfter?: number; details?: unknown; limits: ZuLimits };

const TIMEOUT_MS = 20_000;
const REASON_MAX = 300;

/** Only `/v1/...`, nothing that could step out of it or smuggle a query. */
export function safePath(path: string): boolean {
  return (
    typeof path === "string" &&
    path.startsWith("/v1/") &&
    !path.includes("..") &&
    !path.includes("//") &&
    !path.includes("?") &&
    !path.includes("#") &&
    !/\s/.test(path) &&
    !path.includes("\\")
  );
}

function headerInt(h: Headers, name: string): number | undefined {
  const raw = h.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function limitsOf(h: Headers): ZuLimits {
  const out: ZuLimits = {};
  const pairs: Array<[keyof ZuLimits, string]> = [
    ["contactsLimit", "x-contacts-limit"],
    ["contactsUsed", "x-contacts-used"],
    ["contactsRemaining", "x-contacts-remaining"],
    ["rateRemaining", "x-ratelimit-remaining"],
  ];
  for (const [key, name] of pairs) {
    const n = headerInt(h, name);
    if (n !== undefined) out[key] = n;
  }
  return out;
}

type Rec = Record<string, unknown>;
const rec = (x: unknown): Rec => (x && typeof x === "object" && !Array.isArray(x) ? (x as Rec) : {});

/** A machine code such as `scope_denied` or `slot_full`. */
const isCode = (s: unknown): boolean => typeof s === "string" && /^[a-z][a-z0-9_.-]{1,63}$/i.test(s) && !/\s/.test(s);

/** Zuops's own words when they read as a sentence, capped. Codes are not sentences. */
function humanText(body: Rec): string | undefined {
  for (const k of ["message", "error"]) {
    const v = body[k];
    if (typeof v === "string") {
      const t = v.replace(/\s+/g, " ").trim();
      if (t.length >= 8 && t.includes(" ") && !isCode(t)) return t.length > REASON_MAX ? `${t.slice(0, REASON_MAX - 3)}...` : t;
    }
  }
  return undefined;
}

function retryAfterOf(h: Headers, body: Rec): number | undefined {
  const header = h.get("retry-after");
  if (header) {
    const n = Number(header);
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, Math.ceil((at - Date.now()) / 1000));
  }
  const fromBody = body.retry_after_seconds ?? rec(body.details).retry_after_seconds;
  return typeof fromBody === "number" && Number.isFinite(fromBody) && fromBody >= 0 ? Math.ceil(fromBody) : undefined;
}

const KNOWN_409: Record<string, string> = {
  slot_full: "That time is already taken. Pick another slot.",
  window_closed: "The 24 hour reply window for this conversation has closed. Wait for the person to write again.",
  idempotency_in_progress: "The same request is still running. Try again in a moment.",
  no_social_contact: "This lead has never messaged on that channel, so there is nothing to reply to.",
  channel_disabled: "That channel is switched off in Zuops.",
  needs_reconnect: "That account needs connecting again in Zuops.",
};

function failure(status: number, body: Rec, headers: Headers, limits: ZuLimits): Extract<ZuResult, { ok: false }> {
  const details = body.details !== undefined ? body.details : body.limit !== undefined ? { limit: body.limit } : undefined;
  const detailCode = rec(body.details).code;
  const bodyCode = [body.code, body.error, detailCode].find((c): c is string => typeof c === "string" && isCode(c));
  const human = humanText(body);
  const out = (code: string, fallback: string, extra: { retryAfter?: number } = {}) => {
    const r: Extract<ZuResult, { ok: false }> = { ok: false, status, code, reason: human ?? fallback, limits };
    if (extra.retryAfter !== undefined) r.retryAfter = extra.retryAfter;
    if (details !== undefined) r.details = details;
    return r;
  };

  if (status === 400) return out(bodyCode ?? "bad_request", "Zuops did not accept that request. Check the fields and try again.");
  if (status === 401) return out("unauthorized", "Zuops refused the API key. Ask the owner to create a new key in Zuops under Settings, API.");
  if (status === 402) return out("no_credits", "The Zuops account is out of credits, or the key's monthly budget is used up. Add credits or raise the budget in Zuops.");
  if (status === 403) {
    if (detailCode === "account_locked" || body.code === "account_locked" || body.error === "account_locked") {
      return out("account_locked", "The Zuops account is locked (paused, or its plan is unpaid). An admin opens Zuops to see why and unlock it.");
    }
    const code = bodyCode && bodyCode !== "forbidden" ? bodyCode : "scope_denied";
    return out(code, "This Zuops key is not allowed to do that. It needs a key with more access.");
  }
  if (status === 404) return out("not_found", "Zuops could not find that. It may have been deleted, or the link is wrong.");
  if (status === 409) {
    const code = bodyCode ?? "conflict";
    return out(code, KNOWN_409[code] ?? "That conflicts with something already in Zuops.");
  }
  if (status === 429) {
    const retryAfter = retryAfterOf(headers, body);
    const sms = body.code === "sms_limit" || body.error === "sms_limit" || detailCode === "sms_limit";
    if (sms) return out("sms_limit", "Today's messaging limit for this account is used up. It resets at midnight UTC.", { retryAfter });
    const wait = retryAfter !== undefined ? `Try again in ${retryAfter} seconds.` : "Try again in a minute.";
    return out("rate_limited", `Zuops is getting too many requests from this key. ${wait}`, { retryAfter });
  }
  if (status === 503) return out("unavailable", "Zuops could not check pricing or limits just now. Nothing was charged. Try again shortly.");
  if (status >= 500) return out("server_error", "Zuops had a problem on its side. Try again in a minute.");
  return out(bodyCode ?? "error", `Zuops answered ${status}.`);
}

export async function zuRequest(
  args: { key: string; method: string; path: string; query?: Record<string, string | number | boolean>; body?: unknown; idempotencyKey?: string; base?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ZuResult> {
  const empty: ZuLimits = {};
  if (!safePath(args.path)) return { ok: false, status: 0, code: "bad_path", reason: "That Zuops address is not allowed.", limits: empty };
  if (!args.key) return { ok: false, status: 0, code: "not_connected", reason: "Zuops is not connected on this deployment.", limits: empty };

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(args.query ?? {})) qs.set(k, String(v));
  const q = qs.toString();
  // Only the real host, or a loopback mock that passed MOCK_URL.
  const base = args.base !== undefined && MOCK_URL.test(args.base) ? args.base : ZU_BASE;
  const url = `${base}${args.path}${q ? `?${q}` : ""}`;

  const headers: Record<string, string> = { Authorization: `Bearer ${args.key}`, Accept: "application/json" };
  const hasBody = args.body !== undefined;
  if (hasBody) headers["Content-Type"] = "application/json";
  if (args.idempotencyKey) headers["Idempotency-Key"] = args.idempotencyKey;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: args.method.toUpperCase(),
      headers,
      body: hasBody ? JSON.stringify(args.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      ok: false,
      status: 0,
      code: "network",
      reason: timedOut ? "Zuops did not answer within 20 seconds. Try again." : "Could not reach Zuops. Check the connection and try again.",
      limits: empty,
    };
  }

  const limits = limitsOf(res.headers);
  let text = "";
  try {
    text = await res.text();
  } catch {
    return { ok: false, status: res.status, code: "network", reason: "The answer from Zuops was cut off. Try again.", limits };
  }

  let parsed: unknown = undefined;
  let isJson = false;
  if (text.trim() !== "") {
    try {
      parsed = JSON.parse(text);
      isJson = true;
    } catch {
      isJson = false;
    }
  }

  if (res.ok) {
    if (text.trim() === "") return { ok: true, status: res.status, data: null, limits };
    if (!isJson) return { ok: false, status: res.status, code: "bad_response", reason: "Zuops sent an answer Pulse could not read.", limits };
    const env = rec(parsed);
    // A 2xx that says it failed: read it like a 400, but report the real status.
    if (env.success === false) return { ...failure(400, env, res.headers, limits), status: res.status };
    return { ok: true, status: res.status, data: "data" in env ? (env.data ?? null) : parsed, limits };
  }

  return failure(res.status, isJson ? rec(parsed) : {}, res.headers, limits);
}
