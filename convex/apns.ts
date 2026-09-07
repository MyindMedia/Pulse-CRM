"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { createSign } from "node:crypto";
import http2 from "node:http2";
import { phoneSchedulesItself } from "./lib/t10";

/* ============================================================
   Apple Push Notification service.

   No package. APNs is one HTTP/2 POST carrying a JWT, and both halves are in
   Node's standard library - `node:crypto` signs ES256, `node:http2` speaks the
   protocol that `fetch` cannot (undici is HTTP/1.1, and APNs will not accept
   that). A dependency here would be a supply-chain risk taken to avoid sixty
   lines.

   Silent no-op until the deployment carries APNS_KEY_ID, APNS_TEAM_ID,
   APNS_PRIVATE_KEY and APNS_BUNDLE_ID - the same bargain pushSend makes about
   VAPID, so a studio without push configured is not a studio with errors.
   ============================================================ */

/** The provider token. Valid for an hour; Apple rejects one older than that
 *  and rate-limits one minted more than once every 20 minutes, so it is cached
 *  for the life of the action container. */
let cachedToken: { jwt: string; at: number } | null = null;

function providerToken(keyId: string, teamId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now - cachedToken.at < 45 * 60) return cachedToken.jwt;

  const header = { alg: "ES256", kid: keyId };
  const claims = { iss: teamId, iat: now };
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64(header)}.${b64(claims)}`;

  // The .p8 arrives as one env var, and a private key that lost its newlines
  // in a copy-paste fails to parse with a message about ASN.1 that tells you
  // nothing. Accept the escaped form too.
  const pem = privateKey.includes("\\n")
    ? privateKey.replace(/\\n/g, "\n")
    : privateKey;

  const signer = createSign("SHA256");
  signer.update(unsigned);
  signer.end();
  // APNs wants the raw r||s pair, not the DER envelope Node signs by default.
  const signature = signer.sign({ key: pem, dsaEncoding: "ieee-p1363" });
  const jwt = `${unsigned}.${signature.toString("base64url")}`;
  cachedToken = { jwt, at: now };
  return jwt;
}

type ApnsResult = { status: number; reason?: string };

/** One notification to one device. Resolves rather than throws: a single dead
 *  token must not take down a fan-out to a whole studio. */
function sendOne(
  host: string,
  jwt: string,
  topic: string,
  token: string,
  payload: unknown,
): Promise<ApnsResult> {
  return new Promise((resolve) => {
    const client = http2.connect(`https://${host}`);
    const body = Buffer.from(JSON.stringify(payload));
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      "authorization": `bearer ${jwt}`,
      "apns-topic": topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
      "content-length": body.length,
    });

    let status = 0;
    let raw = "";
    req.on("response", (headers) => { status = Number(headers[":status"] ?? 0); });
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      client.close();
      let reason: string | undefined;
      try { reason = raw ? (JSON.parse(raw) as { reason?: string }).reason : undefined; }
      catch { reason = raw || undefined; }
      resolve({ status, reason });
    });
    req.on("error", (err) => {
      client.close();
      resolve({ status: 0, reason: err.message });
    });
    // A studio's alert is worth ten seconds and not a whole action's timeout.
    req.setTimeout(10_000, () => { req.close(); });
    req.end(body);
  });
}

export const sendToOrg = internalAction({
  args: {
    orgId: v.string(),
    title: v.string(),
    body: v.string(),
    url: v.optional(v.string()),
    tag: v.optional(v.string()),
    clerkUserIds: v.optional(v.array(v.string())),
    /* When true, `clerkUserIds` is the ONLY audience.
     *
     * The fallback below - ping everybody when the named people have no device
     * - is right for "the room turns over in ten minutes", which anybody on
     * shift can act on. It is wrong for "you have not clocked in", which would
     * then tell the whole studio about one person. An alert addressed to
     * somebody who is not reachable should go nowhere. */
    strictAudience: v.optional(v.boolean()),
  },
  handler: async (ctx, { orgId, title, body, url, tag, clerkUserIds, strictAudience }): Promise<{ sent: number; of?: number; reason?: string }> => {
    const keyId = process.env.APNS_KEY_ID;
    const teamId = process.env.APNS_TEAM_ID;
    const privateKey = process.env.APNS_PRIVATE_KEY;
    const bundleId = process.env.APNS_BUNDLE_ID;
    if (!keyId || !teamId || !privateKey || !bundleId) {
      return { sent: 0, reason: "apns-unset" };
    }

    let devices = await ctx.runQuery(internal.push._apnsForOrg, { orgId });
    if (clerkUserIds && clerkUserIds.length > 0) {
      const targeted = devices.filter((d) => clerkUserIds.includes(d.clerkUserId));
      // Same rule as web push: rather than drop the alert, fall back to the
      // whole team when the on-shift staff have no registered devices - unless
      // it is addressed to one person, who is the only one who may read it.
      if (targeted.length > 0 || strictAudience) devices = targeted;
    }
    // A phone that schedules this alert locally already has it. See t10.ts.
    if (phoneSchedulesItself(tag)) devices = devices.filter((d) => !d.localClock);
    if (devices.length === 0) return { sent: 0, reason: "no-devices" };

    const jwt = providerToken(keyId, teamId, privateKey);
    const payload = {
      aps: {
        alert: { title, body },
        sound: "default",
        "thread-id": tag ?? "pulse",
        "interruption-level": "time-sensitive",
      },
      url: url ?? "/dashboard",
    };

    let sent = 0;
    for (const device of devices) {
      // A debug build talks to the sandbox and a shipped one to production;
      // a token from one is meaningless to the other, which is the commonest
      // reason a push "silently does nothing" during development.
      const host = device.environment === "sandbox"
        ? "api.sandbox.push.apple.com"
        : "api.push.apple.com";
      const result = await sendOne(host, jwt, device.bundleId || bundleId, device.token, payload);
      if (result.status === 200) {
        sent += 1;
      } else if (result.status === 410 || result.reason === "BadDeviceToken") {
        // Apple says this install is gone. Drop it so the list self-heals,
        // exactly as the web-push path prunes a 404/410 endpoint.
        await ctx.runMutation(internal.push._pruneApns, { token: device.token });
      }
    }
    return { sent, of: devices.length };
  },
});

/** Prove the credentials without needing a real device.
 *
 *  Sends to a deliberately invalid token: APNs answers `BadDeviceToken` when
 *  the provider JWT was accepted, and `InvalidProviderToken` when it was not.
 *  That difference is the whole test, and it costs nothing to run. */
export const verifyCredentials = internalAction({
  args: {},
  handler: async () => {
    const keyId = process.env.APNS_KEY_ID;
    const teamId = process.env.APNS_TEAM_ID;
    const privateKey = process.env.APNS_PRIVATE_KEY;
    const bundleId = process.env.APNS_BUNDLE_ID;
    if (!keyId || !teamId || !privateKey || !bundleId) {
      return { ok: false, reason: "apns-unset",
               missing: [
                 !keyId && "APNS_KEY_ID", !teamId && "APNS_TEAM_ID",
                 !privateKey && "APNS_PRIVATE_KEY", !bundleId && "APNS_BUNDLE_ID",
               ].filter(Boolean) };
    }
    let jwt: string;
    try {
      jwt = providerToken(keyId, teamId, privateKey);
    } catch (err) {
      return { ok: false, reason: "key-unreadable", detail: String(err) };
    }
    const result = await sendOne(
      "api.sandbox.push.apple.com", jwt, bundleId,
      "0".repeat(64), { aps: { alert: "verify" } },
    );
    return {
      ok: result.reason === "BadDeviceToken",
      status: result.status,
      reason: result.reason,
      meaning: result.reason === "BadDeviceToken"
        ? "credentials accepted - the fake token is what was rejected"
        : "credentials NOT accepted",
    };
  },
});
