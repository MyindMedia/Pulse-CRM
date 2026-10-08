/* CSRF guard for cookie-authenticated JSON API writes.

   A route that accepts the Clerk session cookie can be posted to by any page
   the signed-in user visits. Two checks close that:
   - the body must be declared application/json, which a cross-site <form>
     cannot send and a cross-site fetch() cannot send without a CORS preflight
     this app never answers;
   - a browser's Origin must be this app. A call with no Origin is accepted
     only with an explicit Bearer token, i.e. a script, not a browser cookie.
   Returns the refusal Response, or null when the write may proceed. */

function refusal(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function allowedOrigins(req: Request): Set<string> {
  const out = new Set<string>();
  const self = originOf(req.url);
  if (self) out.add(self);
  const fwdHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (fwdHost) {
    const proto = req.headers.get("x-forwarded-proto") ?? (self?.startsWith("http://") ? "http" : "https");
    const fwd = originOf(`${proto}://${fwdHost}`);
    if (fwd) out.add(fwd);
  }
  const app = originOf(process.env.NEXT_PUBLIC_APP_URL);
  if (app) out.add(app);
  return out;
}

export function refuseCrossSiteWrite(req: Request): Response | null {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return refusal(415, "Send Content-Type: application/json");
  const origin = req.headers.get("origin");
  if (origin === null) {
    if (/^Bearer\s+\S+/i.test(req.headers.get("authorization") ?? "")) return null;
    return refusal(403, "Cross-site request refused");
  }
  if (!allowedOrigins(req).has(origin)) return refusal(403, "Cross-site request refused");
  return null;
}
