/* The Google OAuth callback lives on studiopulse.tech so Google can verify the
   domain (a convex.site address can never be verified). The route at
   src/app/google/callback forwards the query string to the Convex HTTP
   endpoint, which exchanges the code and redirects back into the app. */

/** The Convex HTTP (".site") origin: NEXT_PUBLIC_CONVEX_SITE_URL, or derived
 *  from NEXT_PUBLIC_CONVEX_URL (".convex.cloud" -> ".convex.site"). */
export function convexSiteUrl(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const cloud = env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (cloud && cloud.includes(".convex.cloud")) return cloud.replace(".convex.cloud", ".convex.site").replace(/\/+$/, "");
  return null;
}

/** Forward the callback to Convex and hand back its redirect untouched. */
export async function forwardGoogleCallback(req: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const site = convexSiteUrl();
  if (!site) return new Response("Google sign-in is not configured on this deployment.", { status: 500 });
  const search = new URL(req.url).search;
  let upstream: Response;
  try {
    upstream = await fetchImpl(`${site}/google/callback${search}`, { redirect: "manual", cache: "no-store" });
  } catch {
    return new Response("Could not reach the Pulse backend. Try connecting again.", { status: 502 });
  }
  const location = upstream.headers.get("location");
  if (location) {
    return new Response(null, { status: upstream.status >= 300 && upstream.status < 400 ? upstream.status : 302, headers: { Location: location, "Cache-Control": "no-store" } });
  }
  return new Response(await upstream.text(), { status: upstream.status, headers: { "Cache-Control": "no-store" } });
}
