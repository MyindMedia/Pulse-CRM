/* Pure parsing for the studio-website importer: given the HTML of a studio's
   existing site, pull the branding basics the agency needs when provisioning
   a sub-account - name, tagline, contact details and logo candidates.
   Regex/JSON based (no DOM in the Convex runtime), dependency-free, and
   unit-testable. Network + storage live in convex/studioImport.ts. */

export type StudioSiteInfo = {
  name: string | null;
  tagline: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  /** Logo image URLs, absolute, best candidate first. */
  logoCandidates: string[];
};

/** Normalize user input into a fetchable http(s) URL, or null if hopeless. */
export function normalizeSiteUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** `<meta property="og:x" content="...">` in either attribute order. */
export function metaTag(html: string, key: string): string | null {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]*content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${esc}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1].trim());
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function absoluteUrl(src: string | null | undefined, baseUrl: string): string | null {
  if (!src) return null;
  try {
    const u = new URL(src, baseUrl);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Site name from a <title>, trimming the usual "Name | tagline" suffixes. */
function titleName(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!m?.[1]) return null;
  const first = decodeEntities(m[1]).split(/\s*[|–—·•-]{1,2}\s+/)[0]?.trim();
  return first || null;
}

type JsonLdNode = Record<string, unknown>;

/** Collect every JSON-LD object on the page (arrays and @graph flattened);
 *  malformed blocks are ignored. */
function jsonLdNodes(html: string): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1]) as unknown;
      const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== "object") continue;
        const obj = node as JsonLdNode;
        if (Array.isArray(obj["@graph"])) queue.push(...(obj["@graph"] as unknown[]));
        if (obj["@type"]) nodes.push(obj);
      }
    } catch {
      // Broken JSON-LD is common in the wild; skip the block.
    }
  }
  return nodes;
}

const ORG_TYPES =
  /organization|localbusiness|musicgroup|professionalservice|store|recordingstudio|healthandbeautybusiness|entertainmentbusiness/i;

function isOrgNode(node: JsonLdNode): boolean {
  const t = node["@type"];
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) => typeof x === "string" && ORG_TYPES.test(x));
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** JSON-LD image/logo values come as strings, {url}, or arrays of either. */
function imageUrl(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return imageUrl(v[0]);
  if (v && typeof v === "object") return str((v as JsonLdNode).url);
  return null;
}

function postalAddress(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (!v || typeof v !== "object") return null;
  const a = v as JsonLdNode;
  const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode]
    .map(str)
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Icon links (apple-touch-icon preferred over favicon), largest first. */
function iconLinks(html: string, baseUrl: string): string[] {
  const out: { url: string; score: number }[] = [];
  const re = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const rel = tag.match(/rel=["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? "";
    if (!/(apple-touch-icon|icon)/.test(rel)) continue;
    const href = absoluteUrl(tag.match(/href=["']([^"']+)["']/i)?.[1], baseUrl);
    if (!href) continue;
    const size = parseInt(tag.match(/sizes=["'](\d+)/i)?.[1] ?? "0", 10);
    const apple = rel.includes("apple-touch-icon") ? 1000 : 0;
    const ico = /\.ico(\?|$)/i.test(href) ? -500 : 0;
    out.push({ url: href, score: apple + size + ico });
  }
  return out
    .sort((a, b) => b.score - a.score)
    .map((x) => x.url)
    .filter((url, i, arr) => arr.indexOf(url) === i);
}

export function parseStudioSite(html: string, baseUrl: string): StudioSiteInfo {
  const ld = jsonLdNodes(html).find(isOrgNode) ?? null;

  const name =
    str(ld?.name) ?? metaTag(html, "og:site_name") ?? metaTag(html, "og:title") ?? titleName(html);

  const taglineRaw =
    str(ld?.description) ?? metaTag(html, "og:description") ?? metaTag(html, "description");
  const tagline = taglineRaw && taglineRaw.length > 160 ? `${taglineRaw.slice(0, 157)}...` : taglineRaw;

  const email =
    str(ld?.email)?.replace(/^mailto:/i, "") ??
    html.match(/href=["']mailto:([^"'?]+)/i)?.[1]?.trim() ??
    null;

  const phone =
    str(ld?.telephone) ?? html.match(/href=["']tel:([^"']+)["']/i)?.[1]?.trim() ?? null;

  const address = postalAddress(ld?.address);

  const logoCandidates = [
    absoluteUrl(imageUrl(ld?.logo), baseUrl),
    ...iconLinks(html, baseUrl),
    absoluteUrl(metaTag(html, "og:image"), baseUrl),
  ].filter((u, i, arr): u is string => Boolean(u) && arr.indexOf(u) === i);

  return { name, tagline: tagline ?? null, email, phone, address, logoCandidates };
}
