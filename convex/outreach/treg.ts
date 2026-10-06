/* treg client and response parsers for prospect discovery. treg holds the
   provider credentials server-side; this module only needs TREG_TOKEN, which
   lives in Convex env and never reaches the browser. Everything returned is
   what a studio published (on its Google Maps listing, its website or its own
   Instagram profile): published, not verified. */

import { isGenericInbox } from "./enrich";

const TREG_BASE = "https://treg.to/call";
/** Hard ceiling treg may spend on one call, passed as a header. */
const MAX_COST_USD = "0.05";

/** Link-in-bio hosts: kept as a hint but never trusted as the studio's website. */
const AGGREGATORS = [
  "linktr.ee", "beacons.ai", "bio.link", "linkin.bio", "lnk.bio", "campsite.bio", "taplink.cc",
  "msgsndr.com", "link.bio", "solo.to", "stan.store", "carrd.co", "withkoji.com", "allmylinks.com",
  "instagram.com", "facebook.com", "tiktok.com", "youtube.com", "youtu.be", "open.spotify.com", "soundcloud.com",
];

export type TregResult = { ok: true; json: unknown } | { ok: false; reason: string };

export type TregEndpoint =
  | "anyapi.maps.contacts"
  | "treg.instagram.search.users"
  | "anyapi.instagram.profile_contact";

/** One POST to treg. Never throws; the reason is safe to show the operator. */
export async function callTreg(endpoint: TregEndpoint, body: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<TregResult> {
  const token = process.env.TREG_TOKEN;
  if (!token) return { ok: false, reason: "Discovery is off: TREG_TOKEN is not set on this deployment." };
  try {
    const res = await fetchImpl(`${TREG_BASE}/${endpoint}`, {
      method: "POST",
      headers: { "X-Treg-Token": token, "Content-Type": "application/json", "X-Treg-Route-Max-Cost": MAX_COST_USD },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const msg = /insufficient|balance|payment/i.test(detail) ? "treg balance is empty" : `treg answered ${res.status}`;
      return { ok: false, reason: msg };
    }
    return { ok: true, json: await res.json() };
  } catch {
    return { ok: false, reason: "Could not reach treg (timed out or network error)." };
  }
}

type Rec = Record<string, unknown>;
const rec = (x: unknown): Rec => (x && typeof x === "object" ? (x as Rec) : {});
const str = (x: unknown): string | undefined => (typeof x === "string" && x.trim() ? x.trim() : undefined);
const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((i): i is string => typeof i === "string" && !!i.trim()).map((s) => s.trim()) : []);

export function isAggregator(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return AGGREGATORS.some((a) => host === a || host.endsWith("." + a));
  } catch {
    return false;
  }
}

/* ------------------------------ Google Maps ------------------------------ */

export type MapsPlace = {
  name: string;
  website?: string;
  emails: string[];
  phones: string[];
  address?: string;
  category?: string;
  rating?: number;
  reviewCount?: number;
};

/** `anyapi.maps.contacts` -> places. Social links found on the place's website
 *  are deliberately dropped: they are often client accounts, not the studio's. */
export function parseMapsPlaces(json: unknown): MapsPlace[] {
  const out = rec(rec(json).output);
  const items = rec(out.data).items;
  if (!Array.isArray(items)) return [];
  const places: MapsPlace[] = [];
  for (const raw of items) {
    const r = rec(raw);
    const name = str(r.name);
    if (!name) continue;
    const phones = [...new Set([str(r.phone), ...strs(r.phones)].filter((p): p is string => !!p))];
    places.push({
      name: name.slice(0, 120),
      website: str(r.website),
      emails: [...new Set(strs(r.emails).map((e) => e.toLowerCase()))],
      phones,
      address: str(r.address),
      category: str(r.category),
      rating: num(r.rating),
      reviewCount: num(r.reviewCount),
    });
  }
  return places;
}

/* ------------------------------ Instagram ------------------------------ */

export type IgAccount = {
  handle: string;
  name?: string;
  bio?: string;
  externalUrl?: string;
  category?: string;
  followers?: number;
  isPrivate: boolean;
};

/** `treg.instagram.search.users` -> accounts. Private accounts are kept out. */
export function parseIgUsers(json: unknown): IgAccount[] {
  const users = rec(rec(json).output).users;
  if (!Array.isArray(users)) return [];
  const out: IgAccount[] = [];
  for (const raw of users) {
    const r = rec(raw);
    const handle = str(r.username)?.toLowerCase();
    if (!handle || !/^[a-z0-9._]{1,30}$/.test(handle)) continue;
    if (r.is_private === true) continue;
    out.push({
      handle,
      name: str(r.full_name)?.slice(0, 120),
      bio: str(r.biography)?.slice(0, 300),
      externalUrl: str(r.external_url),
      category: str(r.category_name),
      followers: num(r.follower_count),
      isPrivate: false,
    });
  }
  return out;
}

export type IgContact = { emails: string[]; phones: string[]; externalUrl?: string; bio?: string; name?: string };

/** `anyapi.instagram.profile_contact` -> the email and phone the account
 *  itself publishes on its profile. */
export function parseIgContact(json: unknown): IgContact | null {
  const data = rec(rec(rec(json).output).data);
  if (rec(rec(json).output).found === false) return null;
  const emails = [...new Set([str(data.publicEmail), ...strs(data.emails)].filter((e): e is string => !!e).map((e) => e.toLowerCase()))];
  const phones = [...new Set([str(data.publicPhone), ...strs(data.phones)].filter((p): p is string => !!p))];
  if (!emails.length && !phones.length) return null;
  return { emails, phones, externalUrl: str(data.externalUrl), bio: str(data.bio), name: str(data.displayName) };
}

/** Rank for an address that came from a profile rather than the studio's own
 *  domain: generic inboxes sit below named ones, matching enrich.ts's order. */
export function rankProfileEmail(address: string): number {
  return isGenericInbox(address) ? 5 : 8;
}
