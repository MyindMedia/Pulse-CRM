import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { plaid, verifyPlaidWebhook, exclusionFor, categoryFor, toTransactionRow } from "./plaid";

describe("Plaid Link customization", () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

  beforeEach(() => {
    requests.length = 0;
    vi.stubEnv("PLAID_ENV", "production");
    vi.stubEnv("PLAID_CLIENT_ID", "test-client");
    vi.stubEnv("PLAID_SECRET", "test-secret");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json({ link_token: "test-link", expiration: "2026-09-15T12:00:00Z" });
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the configured customization for new iPhone Link sessions", async () => {
    vi.stubEnv("PLAID_LINK_CUSTOMIZATION_NAME", "pulse_us");
    await expect(plaid.linkTokenCreate({
      clientUserId: "studio:member",
      redirectUri: "https://studiopulse.tech/plaid/oauth",
      webhook: "https://example.convex.site/plaid/webhook",
    })).resolves.toMatchObject({ link_token: "test-link" });

    expect(requests).toEqual([{
      url: "https://production.plaid.com/link/token/create",
      body: {
        client_id: "test-client", secret: "test-secret", client_name: "Pulse",
        language: "en", country_codes: ["US"], user: { client_user_id: "studio:member" },
        link_customization_name: "pulse_us",
        redirect_uri: "https://studiopulse.tech/plaid/oauth",
        webhook: "https://example.convex.site/plaid/webhook",
        products: ["transactions"], transactions: { days_requested: 730 },
      },
    }]);
  });

  it("keeps update-mode account selection and the web redirect default", async () => {
    vi.stubEnv("PLAID_LINK_CUSTOMIZATION_NAME", "pulse_us");
    await plaid.linkTokenCreate({
      clientUserId: "studio:member", accessToken: "test-access", accountSelectionEnabled: true,
    });

    expect(requests[0].body).toMatchObject({
      link_customization_name: "pulse_us", access_token: "test-access",
      country_codes: ["US"], language: "en", update: { account_selection_enabled: true },
    });
    expect(requests[0].body).not.toHaveProperty("products");
    expect(requests[0].body).not.toHaveProperty("transactions");
    expect(requests[0].body).not.toHaveProperty("redirect_uri");
  });

  it.each([undefined, ""])("retains Plaid's default when customization is %s", async (name) => {
    vi.stubEnv("PLAID_LINK_CUSTOMIZATION_NAME", name);
    await plaid.linkTokenCreate({ clientUserId: "studio:member" });
    await plaid.linkTokenCreate({ clientUserId: "studio:member", accessToken: "test-access" });

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.body).not.toHaveProperty("link_customization_name");
    }
  });
});

/* A Plaid webhook starts a bank sync and changes connection status, so a
   forged one must change nothing. Plaid signs each webhook with an ES256 JWT in
   the Plaid-Verification header that carries the SHA-256 of the body. These
   tests sign with a key generated here and prove every way the check can fail. */

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (s: string) => new TextEncoder().encode(s);

async function sha256Hex(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let pair: CryptoKeyPair;
let otherPair: CryptoKeyPair;
let publicJwk: JsonWebKey;
let otherJwk: JsonWebKey;

beforeAll(async () => {
  pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  otherPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  otherJwk = await crypto.subtle.exportKey("jwk", otherPair.publicKey);
});

async function signJwt(body: string, opts: { iat?: number; alg?: string; key?: CryptoKey; hash?: string } = {}) {
  const header = b64url(enc(JSON.stringify({ alg: opts.alg ?? "ES256", kid: "kid-1", typ: "JWT" })));
  const payload = b64url(enc(JSON.stringify({
    iat: opts.iat ?? Math.floor(Date.now() / 1000),
    request_body_sha256: opts.hash ?? (await sha256Hex(body)),
  })));
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, opts.key ?? pair.privateKey, enc(`${header}.${payload}`),
  ));
  return `${header}.${payload}.${b64url(sig)}`;
}

const body = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-1" }, null, 2);
const keyFor = (jwk: () => JsonWebKey) => async (kid: string) => (kid === "kid-1" ? { ...jwk(), expired_at: null } : null);

describe("verifyPlaidWebhook", () => {
  it("accepts a correctly signed, fresh webhook", async () => {
    expect(await verifyPlaidWebhook(body, await signJwt(body), keyFor(() => publicJwk))).toBe(true);
  });

  it("rejects a missing header", async () => {
    expect(await verifyPlaidWebhook(body, null, keyFor(() => publicJwk))).toBe(false);
  });

  it("rejects a body changed after signing", async () => {
    const jwt = await signJwt(body);
    expect(await verifyPlaidWebhook(body.replace("item-1", "item-2"), jwt, keyFor(() => publicJwk))).toBe(false);
  });

  it("rejects a webhook older than five minutes", async () => {
    const jwt = await signJwt(body, { iat: Math.floor(Date.now() / 1000) - 301 });
    expect(await verifyPlaidWebhook(body, jwt, keyFor(() => publicJwk))).toBe(false);
  });

  it("rejects any algorithm other than ES256", async () => {
    const jwt = await signJwt(body, { alg: "HS256" });
    expect(await verifyPlaidWebhook(body, jwt, keyFor(() => publicJwk))).toBe(false);
  });

  it("rejects a signature from a different key", async () => {
    const jwt = await signJwt(body, { key: otherPair.privateKey });
    expect(await verifyPlaidWebhook(body, jwt, keyFor(() => publicJwk))).toBe(false);
    expect(await verifyPlaidWebhook(body, jwt, keyFor(() => otherJwk))).toBe(true);
  });

  it("rejects an unknown or expired key", async () => {
    const jwt = await signJwt(body);
    expect(await verifyPlaidWebhook(body, jwt, async () => null)).toBe(false);
    expect(await verifyPlaidWebhook(body, jwt, async () => ({ ...publicJwk, expired_at: 1 }))).toBe(false);
  });

  it("rejects garbage", async () => {
    expect(await verifyPlaidWebhook(body, "not.a.jwt", keyFor(() => publicJwk))).toBe(false);
  });
});

describe("Plaid categories", () => {
  it("proposes transfers, card payments and loans as excluded", () => {
    expect(exclusionFor("TRANSFER_OUT", "TRANSFER_OUT_ACCOUNT_TRANSFER")).toBe("transfer");
    expect(exclusionFor("TRANSFER_IN", "TRANSFER_IN_DEPOSIT")).toBe("transfer");
    expect(exclusionFor("LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")).toBe("card_payment");
    expect(exclusionFor("LOAN_PAYMENTS", "LOAN_PAYMENTS_CAR_PAYMENT")).toBe("loan");
    expect(exclusionFor("GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_ELECTRONICS")).toBeUndefined();
  });

  it("suggests an expense category from Plaid's category", () => {
    expect(categoryFor("RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT")).toBe("rent");
    expect(categoryFor("RENT_AND_UTILITIES", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY")).toBe("utilities");
    expect(categoryFor("GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_ELECTRONICS")).toBe("gear");
    expect(categoryFor("BANK_FEES", "BANK_FEES_OVERDRAFT_FEES")).toBe("fees");
    expect(categoryFor("GENERAL_SERVICES", "GENERAL_SERVICES_INSURANCE")).toBe("insurance");
    expect(categoryFor("TRAVEL", "TRAVEL_FLIGHTS")).toBe("travel");
    expect(categoryFor(undefined, undefined)).toBeUndefined();
  });
});

describe("toTransactionRow", () => {
  it("turns Plaid's positive amount into money out, in cents, on a UTC day", () => {
    const row = toTransactionRow({
      transaction_id: "tx1", account_id: "acc1", amount: 112.4, iso_currency_code: "USD",
      date: "2026-09-04", authorized_date: "2026-09-02", name: "GUITAR CENTER #512",
      merchant_name: "Guitar Center", pending: false, pending_transaction_id: null,
      personal_finance_category: { primary: "GENERAL_MERCHANDISE", detailed: "GENERAL_MERCHANDISE_ELECTRONICS" },
    });
    expect(row).toMatchObject({
      plaidTransactionId: "tx1", amountCents: 11240, direction: "out",
      date: Date.parse("2026-09-04T00:00:00Z"), authorizedDate: Date.parse("2026-09-02T00:00:00Z"),
      merchantName: "Guitar Center", category: "gear", pending: false,
    });
    expect(row.excluded).toBeUndefined();
  });

  it("negative amount is money in; a transfer arrives excluded", () => {
    const row = toTransactionRow({
      transaction_id: "tx2", account_id: "acc1", amount: -2000, date: "2026-09-05", name: "Transfer",
      pending: false, personal_finance_category: { primary: "TRANSFER_IN", detailed: "TRANSFER_IN_ACCOUNT_TRANSFER" },
    });
    expect(row).toMatchObject({ amountCents: 200000, direction: "in", excluded: true, excludeReason: "transfer" });
  });
});
