/* The Convex deployment URL, resolved the same way everywhere it is read.
 *
 * `NEXT_PUBLIC_CONVEX_URL` (written by `npx convex dev` locally, and set as
 * a build var everywhere else) takes precedence. When it is absent - e.g. a
 * hosting environment where the build var was never configured, which is
 * exactly what happened on the production Netlify site for a while - this
 * falls back to the production deployment so the app still works instead of
 * silently breaking. A Convex URL is public by design, so hardcoding the
 * fallback here is safe.
 *
 * This lives in one place and both `convex-client-provider.tsx` (the browser
 * client) and the brand-card route (a server route that talks to Convex
 * directly) import it, so the two can never resolve to different URLs again.
 * That divergence is exactly what hid a production bug: the browser client
 * had this fallback already, so it kept working, while the brand-card route
 * read `process.env.NEXT_PUBLIC_CONVEX_URL` on its own with no fallback and
 * quietly 404'd every card. */
const PRODUCTION_CONVEX_URL = "https://pastel-corgi-340.convex.cloud";

/** Resolve the Convex deployment URL, falling back when the env var is
 *  unset OR blank. A plain `??` only falls back on `null`/`undefined`, so an
 *  env var that exists but is an empty string would win and produce a client
 *  pointed at "" - the same latent mistake `appUrl()` in
 *  `convex/lib/links.ts` makes. Guarded against here on purpose. */
export function resolveConvexUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_CONVEX_URL;
  return fromEnv && fromEnv.trim().length > 0 ? fromEnv : PRODUCTION_CONVEX_URL;
}
