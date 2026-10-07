/* Plain module, no "use client": both the server page (metadata, JSON-LD,
   footer link) and the client download block import this. A constant exported
   from a client module reaches a server component as a client reference,
   which JSON.stringify silently drops. */
export const APP_STORE_URL = "https://apps.apple.com/app/id6810760056";

/** The Pulse iPhone app link for web copy. NEXT_PUBLIC_PULSE_IOS_APP_URL
 *  overrides the App Store id above (inlined at build time). */
export const PULSE_IOS_APP_URL =
  process.env.NEXT_PUBLIC_PULSE_IOS_APP_URL || APP_STORE_URL;
