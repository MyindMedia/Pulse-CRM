import manifest from "./media-manifest.json";

/* Heavy media (videos, gear and room photos) lives in Cloudflare R2 and is
   served by the pulse-media Worker. The public URL is one setting, so moving to
   a custom domain later (media.studiopulse.tech) changes only this value.
   Paths that stored database rows point at (/gear/..., /rooms/...) are not
   rewritten in the data; next.config.ts redirects them to R2. */
export const R2_PUBLIC_URL = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "https://pulse-media.myindmedia.workers.dev").replace(/\/$/, "");

const KEYS = manifest as Record<string, string>;

/** URL for a site asset listed in media-manifest.json (a hashed, immutable key).
 *  Unknown paths come back unchanged so a typo stays a local 404, not a silent miss. */
export function siteMedia(path: string): string {
  const key = KEYS[path];
  return key ? `${R2_PUBLIC_URL}/${key}` : path;
}
