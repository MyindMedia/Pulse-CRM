import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("PLAID_CLIENT_ID", "client-test");
  vi.stubEnv("PLAID_SECRET", "secret-test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function fixture() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const connectionId = await ctx.db.insert("bankConnections", {
      orgId: "webhook-studio", plaidItemId: "item-webhook", institutionName: "Test bank",
      status: "active", tokenCiphertext: "sealed-token", tokenIv: "iv", createdAt: Date.now(),
    });
    const accountId = await ctx.db.insert("bankAccounts", {
      orgId: "webhook-studio", connectionId, plaidAccountId: "account-webhook",
      name: "Savings", type: "depository", currency: "USD", balanceAsOf: Date.now(),
    });
    return { connectionId, accountId };
  });
  return { t, ...ids };
}

async function verification(body: string) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const bytes = (s: string) => new TextEncoder().encode(s);
  const b64 = (v: Uint8Array) => btoa(String.fromCharCode(...v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(body))), (n) => n.toString(16).padStart(2, "0")).join("");
  const header = b64(bytes(JSON.stringify({ alg: "ES256", kid: "test-key" })));
  const payload = b64(bytes(JSON.stringify({ iat: Math.floor(Date.now() / 1000), request_body_sha256: hash })));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, bytes(`${header}.${payload}`));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ key: { ...jwk, expired_at: null } }))));
  return `${header}.${payload}.${b64(new Uint8Array(signature))}`;
}

describe("Plaid HTTP webhook", () => {
  it("rejects an unsigned event before scheduling or changing data", async () => {
    const { t, connectionId } = await fixture();
    const response = await t.fetch("/plaid/webhook", {
      method: "POST", body: JSON.stringify({ webhook_type: "ITEM", webhook_code: "USER_PERMISSION_REVOKED", item_id: "item-webhook" }),
    });
    expect(response.status).toBe(401);
    expect((await t.run((ctx) => ctx.db.get(connectionId)))?.status).toBe("active");
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(0);
  });

  it("passes the verified account ID through to account-level revocation", async () => {
    const { t, connectionId, accountId } = await fixture();
    const body = JSON.stringify({ webhook_type: "ITEM", webhook_code: "USER_ACCOUNT_REVOKED", item_id: "item-webhook", account_id: "account-webhook" });
    const jwt = await verification(body);
    const response = await t.fetch("/plaid/webhook", { method: "POST", body, headers: { "Plaid-Verification": jwt } });
    expect(response.status).toBe(200);
    expect((await t.run((ctx) => ctx.db.get(accountId)))?.hidden).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(connectionId)))?.tokenCiphertext).toBe("sealed-token");
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.filter((f) => f.name.includes("syncConnection"))).toHaveLength(1);
  });
});
