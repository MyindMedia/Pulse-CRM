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
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

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

export type Fetched =
  | { ok: true; url: string; html: string }
  | { ok: false; reason: string };

/** One safe GET. Redirects are followed manually and re-validated. */
export async function safeGet(raw: string, accept = "text/html,application/xhtml+xml"): Promise<Fetched> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const chk = checkUrl(current);
    if (!chk.ok) return { ok: false, reason: chk.reason };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(chk.url.href, {
        redirect: "manual", signal: ctl.signal,
        headers: { "User-Agent": USER_AGENT, Accept: accept },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, reason: "Redirect without a location" };
        current = new URL(loc, chk.url).href;
        continue;
      }
      if (res.status === 404) return { ok: false, reason: "404" };
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
      const type = res.headers.get("content-type") ?? "";
      if (accept.startsWith("text/html") && type && !/html|xml|text/i.test(type)) return { ok: false, reason: "Not an HTML page" };
      return { ok: true, url: chk.url.href, html: await readCapped(res) };
    } catch (e) {
      return { ok: false, reason: e instanceof Error && e.name === "AbortError" ? "Timed out" : "Network error" };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, reason: "Too many redirects" };
}

/** Minimal robots.txt check for our user agent and "*". 404 means allowed.
 *  An unreachable or erroring robots.txt means we do not scrape. */
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

export async function robotsPermits(origin: string, path: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const r = await safeGet(`${origin}/robots.txt`, "text/plain,*/*");
  if (!r.ok) {
    if (r.reason === "404") return { ok: true };
    return { ok: false, reason: `robots.txt unreachable (${r.reason})` };
  }
  return robotsAllows(r.html, path) ? { ok: true } : { ok: false, reason: "robots.txt disallows this page" };
}
