/* pulse-media: public, read-only front for the pulse-media R2 bucket.
   GET/HEAD only, byte ranges for audio and video seeking, CDN caching, CORS for
   the Pulse app. Writes never go through here: uploads use presigned PUT URLs
   from the Convex R2 component. Private files live in pulse-private and are
   never served by this Worker. */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, If-None-Match",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
  "Access-Control-Max-Age": "86400",
};

/** A key carrying a content hash (8+ hex chars before the extension) never changes. */
const HASHED = /[-_.][0-9a-f]{8,}(\.[a-z0-9]+)?$/i;

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { ...CORS, Allow: "GET, HEAD, OPTIONS" } });
    }
    const url = new URL(request.url);
    let key;
    try { key = decodeURIComponent(url.pathname.slice(1)); } catch { return new Response("Bad request", { status: 400, headers: CORS }); }
    if (!key || key.includes("..") || key.endsWith("/")) return new Response("Not found", { status: 404, headers: CORS });

    const ranged = request.headers.has("Range");
    const cache = caches.default;
    if (!ranged && request.method === "GET") {
      const hit = await cache.match(request);
      if (hit) return hit;
    }

    const object = request.method === "HEAD" ? await env.BUCKET.head(key) : await env.BUCKET.get(key, { range: request.headers, onlyIf: request.headers });
    if (!object) return new Response("Not found", { status: 404, headers: CORS });

    const headers = new Headers(CORS);
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", HASHED.test(key) ? "public, max-age=31536000, immutable" : "public, max-age=3600");
    headers.set("X-Content-Type-Options", "nosniff");
    // Anything uploaded by a studio is untrusted. Only image, audio and video are
    // shown inline; every other type is forced to a download, and a sandboxing CSP
    // stops an SVG or HTML opened directly from running scripts on this origin.
    const type = (headers.get("Content-Type") || "").toLowerCase();
    if (!/^(image|audio|video)\//.test(type)) {
      headers.set("Content-Type", "application/octet-stream");
      headers.set("Content-Disposition", "attachment");
    }
    headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");

    if (request.method === "HEAD") {
      headers.set("Content-Length", String(object.size));
      return new Response(null, { status: 200, headers });
    }
    if (!("body" in object) || object.body === undefined) return new Response(null, { status: 304, headers });

    let status = 200;
    if (ranged && object.range && "offset" in object.range) {
      const { offset, length } = object.range;
      headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set("Content-Length", String(length));
      status = 206;
    } else if (ranged && object.range && "suffix" in object.range) {
      const length = object.range.suffix;
      headers.set("Content-Range", `bytes ${object.size - length}-${object.size - 1}/${object.size}`);
      headers.set("Content-Length", String(length));
      status = 206;
    } else {
      headers.set("Content-Length", String(object.size));
    }
    const response = new Response(object.body, { status, headers });
    if (!ranged && status === 200) ctx.waitUntil(cache.put(request, response.clone()));
    return response;
  },
};
