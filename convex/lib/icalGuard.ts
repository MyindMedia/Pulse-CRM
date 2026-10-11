/* The iCal feed import fetches a URL a studio typed in, from the server. These
   checks keep it on the public internet; the Node transport in
   externalCalendarsActions.ts runs them on every redirect hop and on the
   address the socket actually connects to. Pentest 2026-10-11 (CWE-918):
   the import used fetch(), which followed redirects unchecked, so any public
   host could bounce the server to a private or metadata address. */
import { isPrivateIp } from "../outreach/safeFetch";

export const MAX_ICAL_REDIRECTS = 5;

/** The URL a feed may be fetched from: https, no login, and no private or
 *  local host written into it. A name's addresses are checked at connect. */
export function checkIcalUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid calendar URL.");
  }
  if (u.protocol !== "https:") throw new Error("Calendar URL must use https.");
  if (u.username || u.password) throw new Error("Calendar URL must not contain a login.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
    if (isPrivateIp(host)) throw new Error("Calendar URL points to a non-public address.");
  } else if (!host.includes(".") || /(^localhost$|\.localhost$|\.local$|\.internal$|\.lan$)/i.test(host)) {
    throw new Error("Calendar URL points to a non-public host.");
  }
  return u;
}

/** Why a DNS answer may not be connected to, or null when every address is public. */
export function lookupRefusal(addresses: { address: string }[]): string | null {
  if (addresses.length === 0) return "Calendar URL has no address.";
  return addresses.some((a) => isPrivateIp(a.address)) ? "Calendar URL resolves to a non-public address." : null;
}

export type IcalHop = { status: number; location?: string; body?: string };

/** Fetches a feed through `get`, following redirects by hand so every hop is
 *  checked again before it is requested. */
export async function fetchFeed(raw: string, get: (url: URL) => Promise<IcalHop>): Promise<string> {
  let current = raw;
  for (let hop = 0; hop <= MAX_ICAL_REDIRECTS; hop++) {
    const url = checkIcalUrl(current);
    const res = await get(url);
    if (res.status >= 300 && res.status < 400 && res.location) {
      current = new URL(res.location, url).href;
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`Fetch failed with HTTP ${res.status}`);
    return res.body ?? "";
  }
  throw new Error("Calendar feed redirected too many times.");
}
