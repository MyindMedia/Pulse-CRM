import { describe, it, expect } from "vitest";
import { verifySvix, svixSign, SVIX_TOLERANCE_SECONDS } from "./svix";

const SECRET = "whsec_" + btoa("a-very-secret-signing-key-32bytes!");
const BODY = JSON.stringify({ type: "email.received", data: { email_id: "e1" } });
const NOW = 1_760_000_000_000;
const TS = String(Math.floor(NOW / 1000));

async function headers(body = BODY, ts = TS, secret = SECRET) {
  return { id: "msg_1", timestamp: ts, signature: `v1,${await svixSign(secret, "msg_1", ts, body)}` };
}

describe("verifySvix", () => {
  it("accepts a valid signature", async () => {
    expect(await verifySvix(SECRET, await headers(), BODY, NOW)).toEqual({ ok: true });
  });

  it("accepts when any one of several signatures matches", async () => {
    const h = await headers();
    expect(await verifySvix(SECRET, { ...h, signature: `v1,AAAA ${h.signature} v2,zzz` }, BODY, NOW)).toEqual({ ok: true });
  });

  it("refuses a tampered body", async () => {
    expect(await verifySvix(SECRET, await headers(), BODY.replace("e1", "e2"), NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a signature made with another secret", async () => {
    const other = "whsec_" + btoa("another-secret-entirely-000000000");
    expect(await verifySvix(SECRET, await headers(BODY, TS, other), BODY, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a stale or future timestamp", async () => {
    const old = String(Math.floor(NOW / 1000) - SVIX_TOLERANCE_SECONDS - 1);
    expect(await verifySvix(SECRET, await headers(BODY, old), BODY, NOW)).toEqual({ ok: false, reason: "stale_timestamp" });
    const future = String(Math.floor(NOW / 1000) + SVIX_TOLERANCE_SECONDS + 1);
    expect(await verifySvix(SECRET, await headers(BODY, future), BODY, NOW)).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("refuses missing headers and non-numeric timestamps", async () => {
    const h = await headers();
    expect(await verifySvix(SECRET, { ...h, id: null }, BODY, NOW)).toEqual({ ok: false, reason: "missing_headers" });
    expect(await verifySvix(SECRET, { ...h, signature: null }, BODY, NOW)).toEqual({ ok: false, reason: "missing_headers" });
    expect(await verifySvix(SECRET, { ...h, timestamp: "12abc" }, BODY, NOW)).toEqual({ ok: false, reason: "bad_timestamp" });
  });

  it("refuses an unversioned signature", async () => {
    const h = await headers();
    expect(await verifySvix(SECRET, { ...h, signature: h.signature.replace("v1,", "") }, BODY, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });
});
