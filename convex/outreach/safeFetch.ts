/* Fetching a studio's public website on behalf of an agency user. The URL is
   user-supplied, so this refuses anything that could reach the server's own
   network, follows redirects by hand (re-checking every hop), respects
   robots.txt, and caps time and size. */

const PRIVATE_V4 = [
  /^10\./, /^127\./, /^0\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^192\.0\.0\./, /^198\.1[89]\./, /^22[4-9]\./, /^2[3-5]\d\./,
];

/* Wildcard-DNS services answer any name with the address written into it
   (127.0.0.1.nip.io, 10-0-0-1.sslip.io), which walks straight past a check
   on the hostname string; rebinding services (rbndr.us, 1u.ms) alternate a
   public and a private answer to race the DNS check below. Refused by name
   as a second layer. Pentest re-scans 2026-10-11 (CWE-918). */
const WILDCARD_DNS =
  /(^|\.)(nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me|vcap\.me|lacolhost\.com|traefik\.me|backname\.io|localho\.st|localhost\.direct|fuf\.me|local\.gd|smackaho\.st|1u\.ms|rbndr\.us|rebind\.it|lock\.cmpxchg8b\.com)$/;
/** A private IPv4 written inside a name, dotted or dashed (10.0.0.1.x, 10-0-0-1.x). */
function embedsPrivateV4(h: string): boolean {
  const dotted = h.match(/(\d{1,3}[.-]\d{1,3}[.-]\d{1,3}[.-]\d{1,3})/g) ?? [];
  return dotted.some((m) => PRIVATE_V4.some((re) => re.test(m.replace(/-/g, "."))));
}

export function isPublicHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) return false;
  if (WILDCARD_DNS.test(h)) return false;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(h) && embedsPrivateV4(h)) return false;
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

/** The eight 16-bit groups of an IPv6 address in any text form (compressed,
 *  zero-padded, or ending in a dotted IPv4), or null when it is not one. */
function hextets(ip: string): number[] | null {
  let s = ip.replace(/%.*$/, ""); // zone id
  const v4 = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const q = v4.slice(2).map(Number);
    if (q.some((n) => n > 255)) return null;
    s = `${v4[1]}${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const groups = halves.length === 2 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail] : head;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

const privateV4 = (a: string) => PRIVATE_V4.some((re) => re.test(a));
const v4At = (h: number[], i: number) => `${h[i] >> 8}.${h[i] & 255}.${h[i + 1] >> 8}.${h[i + 1] & 255}`;

/** Whether an IP address is one the server must never fetch. IPv6 is read as
 *  numbers, not text, so a mapped, compatible, NAT64 or 6to4 address that
 *  carries a private IPv4 is caught however it is written. */
export function isPrivateIp(ip: string): boolean {
  const a = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) return privateV4(a);
  const h = hextets(a);
  if (!h) return true; // not an address we can read: refuse it
  const zero = (from: number, to: number) => h.slice(from, to).every((g) => g === 0);
  if (zero(0, 7) && h[7] <= 1) return true; // :: and ::1
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xffc0) === 0xfec0) return true; // link-local, old site-local
  if ((h[0] & 0xff00) === 0xff00) return true; // multicast
  if (zero(0, 5) && (h[5] === 0xffff || h[5] === 0)) return privateV4(v4At(h, 6)); // ::ffff:a.b.c.d, ::a.b.c.d
  if (h[0] === 0x64 && h[1] === 0xff9b) return h[2] !== 0 || privateV4(v4At(h, 6)); // NAT64 (and its local-use /48)
  if (h[0] === 0x2002) return privateV4(v4At(h, 1)); // 6to4 carries an IPv4
  if (h[0] === 0x2001 && (h[1] === 0 || h[1] === 0xdb8)) return true; // Teredo, documentation
  if (h[0] === 0x100 && zero(1, 4)) return true; // discard-only
  return false;
}

/* DNS over HTTPS. Convex's V8 runtime has no resolver and cannot pin the
   address fetch() connects to, so the name is resolved first and refused if
   any answer is private. A name that rebinds between this lookup and the
   request is the residual gap; a static record pointing inside is closed.
   Accepted (2026-10-11): every caller is agency-scoped (stageDemo.stage,
   outreach scraping) and agency access is owner-only. A caller that a studio
   member can reach must fetch from a Node action with a pinned lookup
   instead, as the iCal import does (lib/icalGuard.ts). */
const DOH = ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"];

async function dohAnswers(host: string): Promise<string[] | null> {
  for (const base of DOH) {
    try {
      const out: string[] = [];
      for (const type of ["A", "AAAA"]) {
        const res = await fetch(`${base}?name=${encodeURIComponent(host)}&type=${type}`, {
          headers: { accept: "application/dns-json" },
        });
        if (!res.ok) throw new Error(`DoH ${res.status}`);
        const body = (await res.json()) as { Answer?: { type: number; data: string }[] };
        for (const ans of body.Answer ?? []) if (ans.type === 1 || ans.type === 28) out.push(ans.data);
      }
      return out;
    } catch {
      /* try the next resolver */
    }
  }
  return null;
}

/** Resolver hook, swappable in tests. Returns the host's addresses, or null
 *  when no resolver answered. */
export const dnsTuning: { resolve: (host: string) => Promise<string[] | null> } = { resolve: dohAnswers };

/** What the host's DNS says. "private": an answer points inside (refuse);
 *  "nxdomain": no address at all (unreachable, not blocked); "unresolved":
 *  no resolver answered (fail closed, as a network failure). */
export async function resolveHost(host: string): Promise<"public" | "private" | "nxdomain" | "unresolved"> {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return isPrivateIp(h) ? "private" : "public";
  const ips = await dnsTuning.resolve(h);
  if (ips === null) return "unresolved";
  if (ips.length === 0) return "nxdomain";
  return ips.some(isPrivateIp) ? "private" : "public";
}

/** True when the host resolves and every address is public. */
export async function resolvesPublic(host: string): Promise<boolean> {
  return (await resolveHost(host)) === "public";
}

/** The guard's verdict on a resolved host, as a fetch failure (or null to go ahead). */
async function dnsRefusal(host: string): Promise<{ ok: false; reason: string; kind: FailKind } | null> {
  const r = await resolveHost(host);
  if (r === "public") return null;
  if (r === "private") return { ok: false, reason: "Host resolves to a private address", kind: "policy" };
  if (r === "nxdomain") return { ok: false, reason: FAIL_TEXT.dns, kind: "dns" };
  return { ok: false, reason: "Could not look up the host", kind: "network" };
}

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
    const refused = await dnsRefusal(chk.url.hostname);
    if (refused) return refused;
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

/** A guarded GET that hands back the final response for the caller to read
 *  (images and other non-HTML bytes). Same SSRF rules as safeGet: every hop
 *  is checked before it is requested, redirects are followed by hand, and the
 *  request times out. */
export async function guardedFetch(
  raw: string,
  accept = "*/*",
): Promise<{ ok: true; res: Response; url: string } | { ok: false; reason: string; kind: FailKind }> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const chk = checkUrl(current);
    if (!chk.ok) return { ok: false, reason: chk.reason, kind: "policy" };
    const refused = await dnsRefusal(chk.url.hostname);
    if (refused) return refused;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), fetchTuning.timeoutMs);
    try {
      const res = await fetch(chk.url.href, {
        redirect: "manual", signal: ctl.signal,
        headers: { "User-Agent": USER_AGENT, Accept: accept },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, reason: "Redirect without a location", kind: "http" };
        current = new URL(loc, chk.url).href;
        continue;
      }
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, kind: "http" };
      return { ok: true, res, url: chk.url.href };
    } catch (e) {
      const c = ctl.signal.aborted ? { kind: "timeout" as const } : classifyFetchError(e);
      return { ok: false, reason: FAIL_TEXT[c.kind], kind: c.kind };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, reason: "Too many redirects", kind: "redirects" };
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
