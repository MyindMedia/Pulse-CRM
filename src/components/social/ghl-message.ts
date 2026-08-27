import type { Platform } from "@convex/lib/ghl";

/** The shape of GHL's postMessage payload when its OAuth popup finishes. */
export type GhlCloseMessage = {
  actionType?: string;
  page?: string;
  platform?: string;
  accountId?: string;
};

/* Domains GHL serves its OAuth popup and callback from. A `message` event is
   readable by ANY window that holds a reference to ours, and the popup we
   open (plus anything it navigates to) holds `window.opener`, so without an
   origin check a hostile page could post a well-formed close message and hand
   this studio an accountId the attacker controls. The org-scoping in
   `insertInternal` stops them stealing another Pulse org's account, but not
   binding THIS org to an account of theirs, after which the studio publishes
   to the attacker's page.

   All three apexes are GoHighLevel's own: gohighlevel.com is the app,
   leadconnectorhq.com is the API and callback host, msgsndr.com is the
   white-label domain the same product is served from. Narrower than this and
   a live connect flow silently hangs on a legitimate redirect. */
const GHL_ORIGIN_DOMAINS = ["gohighlevel.com", "leadconnectorhq.com", "msgsndr.com"] as const;

/**
 * True when `origin` is an https origin on a GoHighLevel-owned domain.
 *
 * Matched as "the apex itself, or a subdomain of it", never as a substring or
 * a bare suffix: `evil-gohighlevel.com` does not end with `.gohighlevel.com`,
 * and `gohighlevel.com.evil.tld` neither equals an apex nor ends with one.
 * Anything unparseable (including the literal "null" a sandboxed frame
 * sends) is rejected.
 */
export function isGhlOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return GHL_ORIGIN_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * True when a `message` event is GHL's own "connection closed" signal for
 * `platform`: sent from a GHL origin, with the right actionType and page, and
 * an accountId to act on.
 *
 * The origin is checked FIRST and is a required argument rather than a
 * separate call the component could forget, because the shape checks below
 * are trivially forgeable by anyone who can post into this window.
 *
 * `platform` on the message is optional and, when present but different from
 * this button's own, rejected - ten ConnectButton instances share the global
 * `message` event and each must ignore the other nine's popups. A message
 * that omits `platform` entirely is accepted rather than rejected: nothing in
 * this codebase has verified GHL always sends one, so treating an absent
 * field as "unclear" rather than "mismatched" is the safer read of an
 * external contract nobody here controls. That leniency is only defensible
 * now that the sender has to be GHL in the first place.
 */
export function isOwnGhlCloseMessage(
  origin: string,
  data: unknown,
  platform: Platform,
): data is GhlCloseMessage & { accountId: string } {
  if (!isGhlOrigin(origin)) return false;
  if (!data || typeof data !== "object") return false;
  const d = data as GhlCloseMessage;
  if (d.actionType !== "close" || d.page !== "social-media-posting" || !d.accountId) return false;
  if (d.platform && d.platform !== platform) return false;
  return true;
}
