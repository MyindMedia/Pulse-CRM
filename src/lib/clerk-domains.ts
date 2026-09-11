/*
 * Which host is the Clerk primary, and which is the satellite.
 *
 * Said once, here, because it was said three times - middleware, the client
 * provider and the root layout each carried their own copy of the same two
 * constants. On 2026-09-05 the primary moved from pulse.myindsound.com to
 * studiopulse.tech in the Clerk dashboard and every copy was still pointing at
 * the old one, which took production sign-in down on both domains: the
 * publishable key named a Frontend API host whose certificate no longer
 * existed, and the satellite proxy answered "Invalid host".
 *
 * Changing the primary means changing these two lines AND the publishable key
 * in the environment, because a Clerk publishable key encodes the primary's
 * Frontend API host. pk_live_<base64 of "clerk.<primary>$">. They are one
 * decision and they must move together.
 */

/** The domain Clerk treats as primary. Sign-in can only happen here. */
export const PRIMARY_ORIGIN = "https://studiopulse.tech";

/** The other eTLD+1. Its session cookie cannot be shared with the primary's,
 *  so Clerk's satellite handshake bridges it. */
export const SATELLITE_DOMAIN = "pulse.myindsound.com";

/*
 * PROXY mode, not CNAME mode.
 *
 * A satellite needs either `domain` (which requires Clerk to have issued a
 * certificate for clerk.<satellite>) or `proxyUrl`. Clerk has not issued that
 * certificate for clerk.pulse.myindsound.com - the DNS record is correct and
 * has been for months, but TLS fails - so the satellite's Frontend API is
 * served through this app at /__clerk instead, same-origin and covered by the
 * site's own certificate. clerkMiddleware's frontendApiProxy forwards those
 * requests to Clerk over the PRIMARY's Frontend API TLS, which is live.
 *
 * If Clerk ever issues the satellite's certificate this can become
 * `domain: SATELLITE_DOMAIN` and the /__clerk plumbing can go.
 */
export const SATELLITE_PROXY_URL = `https://${SATELLITE_DOMAIN}/__clerk`;

/** The primary must allowlist the satellite for the post-sign-in return trip. */
export const ALLOWED_REDIRECT_ORIGINS = [
  `https://${SATELLITE_DOMAIN}`,
  `https://www.${SATELLITE_DOMAIN}`,
];

/** Whether a request's Host puts it on the satellite. */
export function isSatelliteHost(hostname: string): boolean {
  return hostname === SATELLITE_DOMAIN || hostname.endsWith(`.${SATELLITE_DOMAIN}`);
}
