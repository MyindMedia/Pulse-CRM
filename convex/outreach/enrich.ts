/* Pure contact extraction from a studio's own public web pages. No network.
   Everything returned is "published", not verified: an address found on a page
   has not been checked against a mail server, and a generic inbox is not a
   confirmed decision-maker. */

export type FoundEmail = { address: string; generic: boolean; rank: number };
export type FoundPhone = { number: string };
export type FoundSocial = { platform: string; url: string };

const JUNK_EMAIL_PARTS = [
  "example.com", "domain.com", "email.com", "sentry", "wixpress", "godaddy", "yourdomain",
  "u003e", "@2x", "@3x", "noreply", "no-reply", "donotreply",
];
const JUNK_EMAIL_SUFFIX = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?|ico)$/i;
const GENERIC_LOCALS = new Set([
  "info", "contact", "hello", "hi", "book", "booking", "bookings", "studio", "mail", "office",
  "admin", "support", "team", "sales", "inquiries", "enquiries", "beats", "careers", "jobs", "press",
]);
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

export function deobfuscate(text: string): string {
  return text
    .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, "@")
    .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, ".");
}

export function isGenericInbox(address: string): boolean {
  return GENERIC_LOCALS.has(address.split("@")[0].toLowerCase());
}

/** Registrable-ish host without "www." for domain matching. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function rankEmail(address: string, siteHost: string | null): number {
  const [local, domain] = address.split("@");
  let score = 0;
  if (siteHost && (domain === siteHost || domain.endsWith("." + siteHost))) score += 50;
  if (local === "studio") score += 20;
  else if (["info", "contact", "hello", "book", "booking", "bookings"].includes(local)) score += 10;
  if (!isGenericInbox(address)) score += 3; // a named inbox still ranks, but never above a domain-matching one
  return score;
}

export function extractEmails(html: string, siteHost: string | null): FoundEmail[] {
  const text = deobfuscate(html).replace(/&#64;|&commat;/g, "@");
  const found = new Set<string>();
  for (const m of text.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    const addr = decodeURIComponent(m[1]).trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) found.add(addr);
  }
  for (const m of text.matchAll(EMAIL_RE)) found.add(m[0].toLowerCase());
  return [...found]
    .filter((a) => !JUNK_EMAIL_SUFFIX.test(a) && !JUNK_EMAIL_PARTS.some((p) => a.includes(p)))
    .map((address) => ({ address, generic: isGenericInbox(address), rank: rankEmail(address, siteHost) }))
    .sort((a, b) => b.rank - a.rank || a.address.localeCompare(b.address));
}

/** US numbers only, and only with real separators, a +1 prefix, or a tel: link.
 *  Bare digit runs (CSS sizes, IDs, timestamps) are ignored. */
export function extractPhones(html: string): FoundPhone[] {
  const out = new Set<string>();
  const add = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (ten.length !== 10) return;
    if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return;
    out.add(`(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`);
  };
  for (const m of html.matchAll(/tel:([+\d][\d\s().-]{8,})/gi)) add(m[1]);
  const text = html.replace(/<[^>]+>/g, " ");
  for (const m of text.matchAll(/(?:\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]\d{3}[\s.-]\d{4}/g)) add(m[0]);
  return [...out].map((number) => ({ number }));
}

const SOCIAL_HOSTS: Array<[string, RegExp]> = [
  ["instagram", /^(?:www\.)?instagram\.com$/],
  ["x", /^(?:www\.)?(?:x|twitter)\.com$/],
  ["tiktok", /^(?:www\.)?tiktok\.com$/],
  ["youtube", /^(?:www\.)?youtube\.com$/],
  ["facebook", /^(?:www\.)?facebook\.com$/],
  ["linkedin", /^(?:www\.)?linkedin\.com$/],
];
const SOCIAL_SKIP = /\/(share|sharer|intent|dialog|plugins|embed|p|reel|tr)(\/|\?|$)/i;

export function extractSocials(html: string): FoundSocial[] {
  const seen = new Map<string, FoundSocial>();
  for (const m of html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) {
    let u: URL;
    try { u = new URL(m[1]); } catch { continue; }
    const hit = SOCIAL_HOSTS.find(([, re]) => re.test(u.hostname.toLowerCase()));
    if (!hit || SOCIAL_SKIP.test(u.pathname) || u.pathname.length < 2) continue;
    const url = `https://${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
    if (!seen.has(url)) seen.set(url, { platform: hit[0], url });
  }
  return [...seen.values()];
}

const BOOKING: Array<[string, RegExp]> = [
  ["Calendly", /calendly\.com/i], ["Square", /squareup\.com|square\.site/i],
  ["GoHighLevel", /leadconnectorhq\.com|gohighlevel|msgsndr\.com/i], ["Booksy", /booksy\.com/i],
  ["Fresha", /fresha\.com/i], ["Acuity", /acuityscheduling\.com/i], ["Setmore", /setmore\.com/i],
  ["Zenbooker", /zenbooker/i], ["Mindbody", /mindbodyonline\.com/i],
];
export function detectBooking(html: string): string[] {
  return BOOKING.filter(([, re]) => re.test(html)).map(([n]) => n);
}

const CONTACT_PATH = /\/(contact|contact-us|about|about-us|book|booking|bookings|reach-us|get-in-touch)\/?$/i;

/** A contact, about or booking page: the pages a studio publishes to be reached. */
export function isContactPath(pathname: string): boolean {
  return CONTACT_PATH.test(pathname);
}
/** Same-host contact/about links worth one extra fetch. Capped, deduped. */
export function candidatePages(html: string, base: string, max = 3): string[] {
  let b: URL;
  try { b = new URL(base); } catch { return []; }
  const out = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    let u: URL;
    try { u = new URL(m[1], b); } catch { continue; }
    if (u.hostname !== b.hostname || !/^https?:$/.test(u.protocol)) continue;
    if (!CONTACT_PATH.test(u.pathname)) continue;
    u.search = ""; u.hash = "";
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/$/, "");
    if (u.href !== b.href) out.add(u.href);
    if (out.size >= max) break;
  }
  return [...out];
}

export type HandleInput = { handle?: string; url?: string; dedupeKey: string; note?: string };

/** Turns one pasted line (a handle, an Instagram profile URL, a post URL or a
 *  website URL) into a prospect seed, or null if it is not recognisable. */
export function parseSeed(raw: string): (HandleInput & { websiteUrl?: string }) | null {
  const line = raw.trim().replace(/[,;]+$/, "");
  if (!line) return null;
  const handleRe = /^@?([A-Za-z0-9._]{1,30})$/;
  const bare = handleRe.exec(line);
  if (bare && !line.includes(".") || (bare && /^@/.test(line))) {
    const h = bare![1].toLowerCase();
    return { handle: h, dedupeKey: `ig:${h}` };
  }
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(line) ? line : `https://${line}`); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "instagram.com" || host === "instagr.am") {
    const seg = u.pathname.split("/").filter(Boolean);
    if (seg.length === 0) return null;
    if (["p", "reel", "reels", "tv", "stories", "explore"].includes(seg[0])) {
      return { dedupeKey: `igpost:${u.pathname.replace(/\/$/, "")}`, note: "Post link: open it and confirm which account owns it." };
    }
    const h = seg[0].toLowerCase();
    return handleRe.test(h) ? { handle: h, dedupeKey: `ig:${h}` } : null;
  }
  if (!host.includes(".")) return null;
  return { websiteUrl: `${u.protocol}//${u.hostname}${u.pathname === "/" ? "" : u.pathname}`, dedupeKey: `site:${host}` };
}
