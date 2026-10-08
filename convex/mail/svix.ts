/* Svix webhook signature check (Resend signs its webhooks with Svix).

   Per https://docs.svix.com/receiving/verifying-payloads/how-manual:
   - signed content is `${svix-id}.${svix-timestamp}.${rawBody}`
   - the key is the secret with its `whsec_` prefix removed, base64 decoded
   - HMAC-SHA256, base64 encoded
   - `svix-signature` holds one or more space-separated `v1,<sig>` entries;
     any match is enough
   - the timestamp is seconds since the epoch; stale or future ones are refused
     (5 minutes, the tolerance the Svix libraries use)

   WebCrypto only, so it runs in the Convex default runtime and in tests. */

export const SVIX_TOLERANCE_SECONDS = 5 * 60;

export type SvixHeaders = { id: string | null; timestamp: string | null; signature: string | null };

export type SvixResult =
  | { ok: true }
  | { ok: false; reason: "missing_headers" | "bad_timestamp" | "stale_timestamp" | "bad_secret" | "bad_signature" };

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]);
  return btoa(bin);
}

/** Constant-time string comparison (length leaks, content does not). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The expected base64 signature for this message. Exported for tests that sign payloads. */
export async function svixSign(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const keyBytes = base64ToBytes(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return bytesToBase64(sig);
}

export async function verifySvix(
  secret: string,
  headers: SvixHeaders,
  rawBody: string,
  nowMs: number = Date.now(),
): Promise<SvixResult> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "bad_timestamp" };
  const ts = Number(timestamp);
  if (Math.abs(nowMs / 1000 - ts) > SVIX_TOLERANCE_SECONDS) return { ok: false, reason: "stale_timestamp" };
  let expected: string;
  try {
    expected = await svixSign(secret, id, timestamp, rawBody);
  } catch {
    return { ok: false, reason: "bad_secret" };
  }
  for (const entry of signature.split(" ")) {
    const comma = entry.indexOf(",");
    if (comma < 0) continue;
    const version = entry.slice(0, comma);
    const sig = entry.slice(comma + 1);
    if (version === "v1" && timingSafeEqual(sig, expected)) return { ok: true };
  }
  return { ok: false, reason: "bad_signature" };
}
