// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { SignatureV4 } from "@smithy/signature-v4";
import worker, { isServableOrgBucket, signedR2Fetch } from "../../workers/pulse-media/index.js";

/* The pulse-media Worker's per-studio route (/o/<bucket>/<key>): which buckets it
   will serve, and that its hand-rolled SigV4 matches the AWS SDK's signer. */

type Source = string | ArrayBuffer | ArrayBufferView;
const buf = (d: Source) => (typeof d === "string" ? Buffer.from(d) : ArrayBuffer.isView(d) ? Buffer.from(d.buffer, d.byteOffset, d.byteLength) : Buffer.from(d));
class Sha256 {
  private h: ReturnType<typeof createHash> | ReturnType<typeof createHmac>;
  constructor(secret?: Source) { this.h = secret ? createHmac("sha256", buf(secret)) : createHash("sha256"); }
  update(d: Source) { this.h.update(buf(d)); }
  async digest() { return new Uint8Array(this.h.digest()); }
}

const env = { R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef", R2_ACCESS_KEY_ID: "AKIATEST", R2_SECRET_ACCESS_KEY: "secret-test-value", ORG_BUCKET_ENV: "prod" };
const ORG_MEDIA = "pulse-prod-sunset-1a2b3c4d-media";

afterEach(() => vi.unstubAllGlobals());

describe("pulse-media Worker, studio buckets", () => {
  it("serves only this environment's studio media buckets, never a private one", () => {
    expect(isServableOrgBucket(ORG_MEDIA, "prod")).toBe(true);
    expect(isServableOrgBucket("pulse-prod-sunset-1a2b3c4d-private", "prod")).toBe(false);
    expect(isServableOrgBucket("pulse-dev-sunset-1a2b3c4d-media", "prod")).toBe(false);
    expect(isServableOrgBucket("pulse-private", "prod")).toBe(false);
    expect(isServableOrgBucket(ORG_MEDIA, undefined)).toBe(false);
  });

  it("signs the GET exactly as the AWS SigV4 reference signer does", async () => {
    const calls: Request[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { calls.push(new Request(url, init)); return new Response("x"); });
    const now = new Date("2026-10-07T12:34:56.000Z");
    const key = "prod/org_1/photo/room (1)!-0123456789ab.jpg";
    await signedR2Fetch(env, "GET", ORG_MEDIA, key, new Headers({ Range: "bytes=0-9" }), now);
    const sent = calls[0];
    const url = new URL(sent.url);
    expect(url.host).toBe(`${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe(`/${ORG_MEDIA}/prod/org_1/photo/room%20%281%29%21-0123456789ab.jpg`);
    expect(sent.headers.get("range")).toBe("bytes=0-9");

    const signer = new SignatureV4({ service: "s3", region: "auto", credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }, sha256: Sha256, uriEscapePath: false });
    const ref = await signer.sign({
      method: "GET", protocol: "https:", hostname: url.host, path: url.pathname, query: {},
      headers: { host: url.host, "x-amz-content-sha256": "UNSIGNED-PAYLOAD", "x-amz-date": "20261007T123456Z" },
    }, { signingDate: now });
    expect(sent.headers.get("authorization")).toBe(ref.headers.authorization);
  });

  it("routes /o/<bucket>/<key> to that bucket and 404s a private or unknown bucket without calling R2", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => { calls.push(url); return new Response("img", { status: 200, headers: { "Content-Type": "image/jpeg", "Content-Length": "3" } }); });
    vi.stubGlobal("caches", { default: { match: async () => undefined, put: async () => undefined } });
    const ctx = { waitUntil: () => undefined };
    const ok = await worker.fetch(new Request(`https://m.example/o/${ORG_MEDIA}/prod/org_1/photo/a-0123456789ab.jpg`), env, ctx);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/jpeg");
    expect(calls[0]).toContain(`/${ORG_MEDIA}/prod/org_1/photo/`);
    const priv = await worker.fetch(new Request("https://m.example/o/pulse-prod-sunset-1a2b3c4d-private/x.pdf"), env, ctx);
    expect(priv.status).toBe(404);
    expect(calls).toHaveLength(1);
  });
});
