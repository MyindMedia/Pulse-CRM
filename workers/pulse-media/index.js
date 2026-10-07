/* pulse-media: public, read-only front for Pulse's public R2 media.
   GET/HEAD only, byte ranges for audio and video seeking, CDN caching, CORS for
   the Pulse app. Writes never go through here: uploads use presigned PUT URLs
   from the Convex R2 component. Private files are never served by this Worker.

   Two sources:
     /<key>                 the shared pulse-media bucket, bound as BUCKET
     /o/<bucket>/<key>      a studio's OWN media bucket (docs/R2-PER-ORG-BUCKETS.md).
                            A Worker cannot bind thousands of buckets, so these are
                            read through R2's S3 API with a SigV4-signed GET using
                            R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.
                            Only names matching pulse-<ORG_BUCKET_ENV>-...-<tag>-media
                            are served; a -private bucket is never reachable. */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, If-None-Match",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
  "Access-Control-Max-Age": "86400",
};

/** A key carrying a content hash (8+ hex chars before the extension) never changes. */
const HASHED = /[-_.][0-9a-f]{8,}(\.[a-z0-9]+)?$/i;

/** A studio's public bucket in this environment. Never a -private bucket. */
export function isServableOrgBucket(name, envLabel) {
  if (!envLabel || !/^[a-z0-9]+$/.test(envLabel)) return false;
  return name.length <= 63 && new RegExp(`^pulse-${envLabel}-[a-z0-9-]+-[0-9a-f]{8}-media$`).test(name);
}

const enc = (s) => new TextEncoder().encode(s);
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc(data)));
}
/** S3 canonical URI: every path segment URI-encoded once (RFC 3986 unreserved kept). */
const encodeKey = (key) => key.split("/").map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())).join("/");

/** A SigV4-signed GET/HEAD against R2's S3 endpoint. Range and conditional headers
 *  are forwarded unsigned (allowed: they are not in SignedHeaders). */
export async function signedR2Fetch(env, method, bucket, key, forward, now = new Date()) {
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const path = `/${bucket}/${encodeKey(key)}`;
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payload = "UNSIGNED-PAYLOAD";
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonical = [method, path, "", `host:${host}\nx-amz-content-sha256:${payload}\nx-amz-date:${amzDate}\n`, signedHeaders, payload].join("\n");
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, hex(await crypto.subtle.digest("SHA-256", enc(canonical)))].join("\n");
  let k = await hmac(`AWS4${env.R2_SECRET_ACCESS_KEY}`, day);
  k = await hmac(k, "auto");
  k = await hmac(k, "s3");
  k = await hmac(k, "aws4_request");
  const headers = new Headers({
    Authorization: `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hex(await hmac(k, toSign))}`,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payload,
  });
  for (const h of ["Range", "If-None-Match", "If-Modified-Since"]) {
    const v = forward.get(h);
    if (v) headers.set(h, v);
  }
  return fetch(`https://${host}${path}`, { method, headers });
}

/** Same safety rules as the shared-bucket path: only image/audio/video inline. */
function harden(headers, key) {
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", HASHED.test(key) ? "public, max-age=31536000, immutable" : "public, max-age=3600");
  headers.set("X-Content-Type-Options", "nosniff");
  const type = (headers.get("Content-Type") || "").toLowerCase();
  if (!/^(image|audio|video)\//.test(type)) {
    headers.set("Content-Type", "application/octet-stream");
    headers.set("Content-Disposition", "attachment");
  }
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
}

async function serveOrgBucket(request, env, ctx, bucket, key) {
  if (!isServableOrgBucket(bucket, env.ORG_BUCKET_ENV) || !env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return new Response("Not found", { status: 404, headers: CORS });
  }
  const ranged = request.headers.has("Range");
  const cache = caches.default;
  if (!ranged && request.method === "GET") {
    const hit = await cache.match(request);
    if (hit) return hit;
  }
  const upstream = await signedR2Fetch(env, request.method, bucket, key, request.headers);
  if (upstream.status === 404 || upstream.status === 403) return new Response("Not found", { status: 404, headers: CORS });
  if (![200, 206, 304].includes(upstream.status)) return new Response("Upstream error", { status: 502, headers: CORS });
  const headers = new Headers(CORS);
  for (const h of ["Content-Type", "Content-Length", "Content-Range", "ETag", "Last-Modified", "Content-Disposition"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  harden(headers, key);
  const response = new Response(request.method === "HEAD" || upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers });
  if (!ranged && upstream.status === 200 && request.method === "GET") ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

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
    if (key.startsWith("o/")) {
      const slash = key.indexOf("/", 2);
      if (slash < 0 || slash === key.length - 1) return new Response("Not found", { status: 404, headers: CORS });
      return serveOrgBucket(request, env, ctx, key.slice(2, slash), key.slice(slash + 1));
    }

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
