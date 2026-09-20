/* Plain module, no "use client": both the server page (metadata, JSON-LD,
   footer link) and the client download block import this. A constant exported
   from a client module reaches a server component as a client reference,
   which JSON.stringify silently drops. */
export const APP_STORE_URL = "https://apps.apple.com/app/id6810760056";
