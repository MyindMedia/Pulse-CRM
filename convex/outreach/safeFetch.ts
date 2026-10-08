/* Fetching a studio's public website on behalf of an agency user. The URL is
   user-supplied, so this refuses anything that could reach the server's own
   network, follows redirects by hand (re-checking every hop), respects
   robots.txt, and caps time and size. */

const PRIVATE_V4 = [
  /^10\./, /^127\./, /^0\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^22[4-9]\./, /^2[3-5]\d\./,
];

export function isPublicHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return !PRIVATE_V4.some((re) => re.test(h));
  if (h.includes(":")) return false; // any IPv6 literal: refuse
  if (/^\d+$/.test(h) || /^0x/i.test(h)) return false; // integer / hex IPv4 tricks
  return h.includes(".");
}

export type SafeUrl = { ok: true; url: URL } | { ok: false; reason: string };

export function checkUrl(raw: string): SafeUrl {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, reason: "Not a valid URL" }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, reason: "Only http and https are allowed" };
  if (u.username || u.password) return { ok: false, reason: "URLs with credentials are not allowed" };
  if (u.port && u.port !== "80" && u.port !== "443") return { ok: false, reason: "Only ports 80 and 443 are allowed" };
  if (!isPublicHostname(u.hostname)) return { ok: false, reason: "Host is not a public website" };
  return { ok: true, url: u };
}

export const USER_AGENT = "PulseOutreachBot/1.0 (+https://studiopulse.tech; contact info@studiopulse.tech)";
const MAX_BYTES = 1_500_000;
/* RFC 9309 asks crawlers to follow at least five redirect hops for robots.txt. */
const MAX_REDIRECTS = 5;

/** Timing knobs. Mutable so tests can drop the backoff to zero. */
export const fetchTuning = { timeoutMs: 8_000, backoffMs: 500 };

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, MAX_BYTES);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) { await reader.cancel(); break; }
    chunks.push(value);
  }
  const buf = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(buf);
}

/** Why a request failed. "policy" is our own refusal (SSRF guard, content type). */
export type FailKind = "policy" | "http" | "redirects" | "dns" | "refused" | "tls" | "timeout" | "network";

export type Fetched =
  | { ok: true; url: string; html: string; status: number; downgraded: boolean }
  | { ok: false; reason: string; kind: FailKind; status?: number; detail?: string; downgraded?: boolean };

const FAIL_TEXT: Record<"dns" | "refused" | "tls" | "timeout" | "network", string> = {
  dns: "Domain does not resolve (no DNS record)",
  refused: "Connection refused",
  tls: "TLS certificate error",
  timeout: "Timed out",
  network: "Network error",
};

/** Turns a thrown fetch error into a kind. Node's undici puts an errno code on
 *  `cause`; the Convex runtime puts the underlying reqwest/hyper text in the
 *  message. Both shapes are read. */
export function classifyFetchError(e: unknown): { kind: "dns" | "refused" | "tls" | "timeout" | "network"; detail: string } {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    if (cur instanceof Error || (typeof cur === "object" && cur !== null)) {
      const o = cur as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
      for (const v of [o.name, o.code, o.message]) if (typeof v === "string") parts.push(v);
      cur = o.cause;
    } else { parts.push(String(cur)); break; }
  }
  const detail = parts.join(" | ").slice(0, 300);
  const t = detail.toLowerCase();
  if (/aborterror|timeouterror|timed out|timeout/.test(t)) return { kind: "timeout", detail };
  if (/enotfound|eai_again|eai_noname|dns error|failed to lookup|name or service not known|nodename nor servname|no such host|name resolution/.test(t)) return { kind: "dns", detail };
  if (/econnrefused|connection refused/.test(t)) return { kind: "refused", detail };
  if (/cert|tls|ssl|handshake|self[- ]signed|unable_to_verify/.test(t)) return { kind: "tls", detail };
  return { kind: "network", detail };
}

/* Worth trying again: the server or the path to it may be briefly unwell.
   DNS misses, refused connections and bad certificates do not fix themselves
   in a second, so those fail fast. */
function isTransient(r: Extract<Fetched, { ok: false }>): boolean {
  if (r.kind === "timeout" || r.kind === "network") return true;
  return r.kind === "http" && r.status !== undefined && (r.status === 429 || r.status >= 500);
}

export type GetOptions = {
  accept?: string;
  /** Extra attempts after the first, for transient failures only. */
  retries?: number;
  /** When an https:// address cannot be connected to at all, try the same
   *  address over http:// (some small studio sites never set up TLS). */
  httpFallback?: boolean;
};

/** One GET with no retry. Redirects are followed by hand and every hop is
 *  re-validated against the SSRF guard. */
async function getOnce(raw: string, accept: string): Promise<Fetched> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const chk = checkUrl(current);
    if (!chk.ok) return { ok: false, reason: chk.reason, kind: "policy" };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), fetchTuning.timeoutMs);
    try {
      const res = await fetch(chk.url.href, {
        redirect: "manual", signal: ctl.signal,
        headers: { "User-Agent": USER_AGENT, Accept: accept },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, reason: "Redirect without a location", kind: "http", status: res.status };
        current = new URL(loc, chk.url).href;
        continue;
      }
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, kind: "http", status: res.status };
      const type = res.headers.get("content-type") ?? "";
      if (accept.startsWith("text/html") && type && !/html|xml|text/i.test(type)) return { ok: false, reason: "Not an HTML page", kind: "policy" };
      return { ok: true, url: chk.url.href, html: await readCapped(res), status: res.status, downgraded: false };
    } catch (e) {
      const c = ctl.signal.aborted ? { kind: "timeout" as const, detail: "aborted by our timer" } : classifyFetchError(e);
      return { ok: false, reason: FAIL_TEXT[c.kind], kind: c.kind, detail: c.detail };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, reason: "Too many redirects", kind: "redirects" };
}

async function getWithRetry(raw: string, accept: string, retries: number): Promise<Fetched> {
  let r = await getOnce(raw, accept);
  for (let attempt = 0; attempt < retries && !r.ok && isTransient(r); attempt++) {
    await sleep(fetchTuning.backoffMs * 2 ** attempt);
    r = await getOnce(raw, accept);
  }
  return r;
}

/** A polite, guarded GET of a public page. */
export async function safeGet(raw: string, opts: GetOptions = {}): Promise<Fetched> {
  const accept = opts.accept ?? "text/html,application/xhtml+xml";
  const retries = opts.retries ?? 1;
  const r = await getWithRetry(raw, accept, retries);
  if (r.ok || !opts.httpFallback || !/^https:\/\//i.test(raw)) return r;
  if (r.kind !== "refused" && r.kind !== "tls" && r.kind !== "network") return r;
  const plain = await getWithRetry(raw.replace(/^https:/i, "http:"), accept, retries);
  // The plain-http server answered (even with a 404): that is the real answer.
  const answered = plain.ok || plain.kind === "http" || plain.kind === "redirects" || plain.kind === "policy";
  return answered ? { ...plain, downgraded: true } : r;
}

/** Minimal robots.txt check for our user agent and "*". */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  const groups: Array<{ agents: string[]; disallow: string[]; allow: string[] }> = [];
  let cur: { agents: string[]; disallow: string[]; allow: string[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], disallow: [], allow: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (cur && (key === "disallow" || key === "allow")) {
      lastWasAgent = false;
      (key === "disallow" ? cur.disallow : cur.allow).push(val);
    } else lastWasAgent = false;
  }
  const mine = groups.filter((g) => g.agents.some((a) => a.includes("pulseoutreachbot")));
  const star = groups.filter((g) => g.agents.includes("*"));
  const use = mine.length ? mine : star;
  let best: { len: number; allowed: boolean } | null = null;
  for (const g of use) {
    for (const [list, allowed] of [[g.disallow, false], [g.allow, true]] as const) {
      for (const rule of list) {
        if (rule === "" ) continue;
        if (path.startsWith(rule) && (!best || rule.length >= best.len)) best = { len: rule.length, allowed };
      }
    }
  }
  return best ? best.allowed : true;
}

/** What a site's robots.txt told us.
 *  - rules: a file was served; its Allow/Disallow lines are honoured.
 *  - none: 404 or 410, there is no file, so nothing is disallowed.
 *  - unreachable: 5xx, other 4xx, or a network failure after retries. We do
 *    not hard-block on this; the caller limits itself to the homepage and
 *    contact pages and says so. A DNS miss is reported as such, since then
 *    the site itself cannot be read either.
 *  `origin` is where the file was actually read (it may have dropped to
 *  http:// when the site has no working https). */
export type RobotsPolicy =
  | { kind: "rules"; txt: string; origin: string; downgraded: boolean }
  | { kind: "none"; origin: string; downgraded: boolean }
  | { kind: "unreachable"; reason: string; failKind: FailKind; origin: string; detail?: string };

export const ROBOTS_RETRIES = 2;

export async function loadRobots(origin: string): Promise<RobotsPolicy> {
  const r = await safeGet(`${origin}/robots.txt`, { accept: "text/plain,*/*", retries: ROBOTS_RETRIES, httpFallback: true });
  const downgraded = r.downgraded === true;
  const readFrom = downgraded ? origin.replace(/^https:/i, "http:") : origin;
  if (r.ok) return { kind: "rules", txt: r.html, origin: readFrom, downgraded };
  if (r.kind === "http" && (r.status === 404 || r.status === 410)) {
    return { kind: "none", origin: readFrom, downgraded };
  }
  return { kind: "unreachable", reason: `robots.txt unreachable (${r.reason})`, failKind: r.kind, origin, detail: r.detail };
}

/** allow: read it. disallow: robots.txt says no. limited: robots.txt could not
 *  be read, so only the homepage and contact pages may be read. */
export function robotsVerdict(policy: RobotsPolicy, path: string): "allow" | "disallow" | "limited" {
  if (policy.kind === "none") return "allow";
  if (policy.kind === "unreachable") return "limited";
  return robotsAllows(policy.txt, path || "/") ? "allow" : "disallow";
}
