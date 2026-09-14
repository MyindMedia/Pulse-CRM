/* ============================================================
   Plaid, over plain fetch.

   Seven endpoints, called only from internal actions, with the
   client id and secret from the deployment environment:
     PLAID_ENV        sandbox (default) | production
     PLAID_CLIENT_ID
     PLAID_SECRET     the secret for PLAID_ENV
   Only the Transactions product is requested. Pulse never asks
   for account or routing numbers (Auth), identity, or balance
   pulls: cached balances from /accounts/get are enough for books.

   Webhooks are verified before anything trusts them
   (verifyPlaidWebhook), per Plaid's webhook verification guide:
   ES256 JWT in the Plaid-Verification header, key fetched by kid,
   iat no older than five minutes, SHA-256 of the raw body equal to
   the signed request_body_sha256.
   ============================================================ */

export type PlaidEnv = "sandbox" | "production";

export class PlaidError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly type: string,
    public readonly status: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "PlaidError";
  }
}

export function plaidEnv(): PlaidEnv {
  return process.env.PLAID_ENV === "production" ? "production" : "sandbox";
}

export function plaidConfigured(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET && process.env.PLAID_TOKEN_KEY);
}

async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new PlaidError("Bank connections are not set up on this deployment.", "NOT_CONFIGURED", "PULSE", 500);
  }
  const res = await fetch(`https://${plaidEnv()}.plaid.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Plaid-Version": "2020-09-14" },
    body: JSON.stringify({ client_id: clientId, secret, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new PlaidError(
      String(json.display_message ?? json.error_message ?? `Plaid ${path} failed`),
      String(json.error_code ?? "UNKNOWN"),
      String(json.error_type ?? "UNKNOWN"),
      res.status,
      json.request_id as string | undefined,
    );
  }
  return json as T;
}

export type PlaidAccount = {
  account_id: string;
  name: string;
  official_name?: string | null;
  mask?: string | null;
  type: string;
  subtype?: string | null;
  balances: {
    current?: number | null;
    available?: number | null;
    limit?: number | null;
    iso_currency_code?: string | null;
  };
};

export type PlaidTransaction = {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code?: string | null;
  date: string;
  authorized_date?: string | null;
  name: string;
  merchant_name?: string | null;
  pending: boolean;
  pending_transaction_id?: string | null;
  personal_finance_category?: { primary?: string | null; detailed?: string | null } | null;
};

export const plaid = {
  linkTokenCreate: (args: { clientUserId: string; webhook?: string; accessToken?: string }) =>
    call<{ link_token: string; expiration: string }>("/link/token/create", {
      client_name: "Pulse",
      language: "en",
      country_codes: ["US"],
      user: { client_user_id: args.clientUserId },
      ...(args.webhook ? { webhook: args.webhook } : {}),
      ...(args.accessToken
        ? { access_token: args.accessToken }
        : { products: ["transactions"], transactions: { days_requested: 730 } }),
    }),

  publicTokenExchange: (publicToken: string) =>
    call<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token: publicToken }),

  itemGet: (accessToken: string) =>
    call<{ item: { item_id: string; institution_id?: string | null; consent_expiration_time?: string | null } }>(
      "/item/get", { access_token: accessToken },
    ),

  institutionName: async (institutionId: string): Promise<string | null> => {
    try {
      const r = await call<{ institution: { name: string } }>("/institutions/get_by_id", {
        institution_id: institutionId,
        country_codes: ["US"],
      });
      return r.institution.name;
    } catch {
      return null;
    }
  },

  accountsGet: (accessToken: string) =>
    call<{ accounts: PlaidAccount[] }>("/accounts/get", { access_token: accessToken }),

  transactionsSync: (accessToken: string, cursor: string | undefined) =>
    call<{
      added: PlaidTransaction[];
      modified: PlaidTransaction[];
      removed: Array<{ transaction_id: string }>;
      next_cursor: string;
      has_more: boolean;
    }>("/transactions/sync", {
      access_token: accessToken,
      count: 500,
      ...(cursor ? { cursor } : {}),
      options: { include_personal_finance_category: true },
    }),

  itemRemove: (accessToken: string) => call<{ request_id: string }>("/item/remove", { access_token: accessToken }),

  webhookVerificationKey: async (keyId: string): Promise<(JsonWebKey & { expired_at?: number | null }) | null> => {
    try {
      const r = await call<{ key: JsonWebKey & { expired_at?: number | null } }>(
        "/webhook_verification_key/get", { key_id: keyId },
      );
      return r.key;
    } catch {
      return null;
    }
  },

  /** Sandbox only: an item without going through Link, for end-to-end checks. */
  sandboxPublicToken: (institutionId: string) =>
    call<{ public_token: string }>("/sandbox/public_token/create", {
      institution_id: institutionId,
      initial_products: ["transactions"],
      options: { transactions: { days_requested: 730 } },
    }),
};

// ------------------------------------------------------------------ webhooks

function fromB64Url(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyPlaidWebhook(
  rawBody: string,
  jwt: string | null,
  getKey: (kid: string) => Promise<(JsonWebKey & { expired_at?: number | null }) | null>,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  try {
    if (!jwt) return false;
    const parts = jwt.split(".");
    if (parts.length !== 3) return false;
    const header = JSON.parse(new TextDecoder().decode(fromB64Url(parts[0]))) as { alg?: string; kid?: string };
    if (header.alg !== "ES256" || !header.kid) return false;

    const jwk = await getKey(header.kid);
    if (!jwk) return false;
    if (jwk.expired_at && jwk.expired_at <= nowSec) return false;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      fromB64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return false;

    const payload = JSON.parse(new TextDecoder().decode(fromB64Url(parts[1]))) as {
      iat?: number;
      request_body_sha256?: string;
    };
    if (typeof payload.iat !== "number" || Math.abs(nowSec - payload.iat) > 300) return false;
    if (typeof payload.request_body_sha256 !== "string") return false;
    return constantTimeEqual(await sha256Hex(rawBody), payload.request_body_sha256);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- categories

export type ExcludeReason = "transfer" | "card_payment" | "loan" | "personal" | "other";
export type ExpenseCategory =
  | "rent" | "utilities" | "software" | "gear" | "repairs" | "payroll" | "contractor"
  | "marketing" | "supplies" | "insurance" | "travel" | "fees" | "adjustment" | "other";

/** Money that moves between the studio's own accounts is not spending. */
export function exclusionFor(primary?: string | null, detailed?: string | null): ExcludeReason | undefined {
  if (primary === "TRANSFER_IN" || primary === "TRANSFER_OUT") return "transfer";
  if (primary === "LOAN_PAYMENTS") {
    return detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" ? "card_payment" : "loan";
  }
  return undefined;
}

/** A starting category for the books; a person can always change it. */
export function categoryFor(primary?: string | null, detailed?: string | null): ExpenseCategory | undefined {
  if (!primary) return undefined;
  if (detailed === "RENT_AND_UTILITIES_RENT") return "rent";
  if (primary === "RENT_AND_UTILITIES") return "utilities";
  if (detailed === "GENERAL_MERCHANDISE_ELECTRONICS") return "gear";
  if (detailed === "GENERAL_SERVICES_INSURANCE") return "insurance";
  if (primary === "BANK_FEES") return "fees";
  if (primary === "TRAVEL" || primary === "TRANSPORTATION") return "travel";
  if (primary === "HOME_IMPROVEMENT") return "repairs";
  if (primary === "GENERAL_MERCHANDISE") return "supplies";
  if (primary === "GOVERNMENT_AND_NON_PROFIT") return "fees";
  if (primary === "GENERAL_SERVICES") return "other";
  if (primary === "INCOME" || primary === "TRANSFER_IN" || primary === "TRANSFER_OUT" || primary === "LOAN_PAYMENTS") {
    return undefined;
  }
  return "other";
}

function isoDay(value: string | null | undefined): number | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? undefined : ms;
}

export type TransactionRow = {
  plaidTransactionId: string;
  plaidAccountId: string;
  pendingTransactionId?: string;
  date: number;
  authorizedDate?: number;
  amountCents: number;
  direction: "in" | "out";
  currency: string;
  name: string;
  merchantName?: string;
  pfcPrimary?: string;
  pfcDetailed?: string;
  pending: boolean;
  category?: ExpenseCategory;
  excluded?: boolean;
  excludeReason?: ExcludeReason;
};

/** Plaid's shape to Pulse's: positive amount is money out. */
export function toTransactionRow(t: PlaidTransaction): TransactionRow {
  const primary = t.personal_finance_category?.primary ?? undefined;
  const detailed = t.personal_finance_category?.detailed ?? undefined;
  const reason = exclusionFor(primary, detailed);
  const direction = t.amount >= 0 ? "out" : "in";
  return {
    plaidTransactionId: t.transaction_id,
    plaidAccountId: t.account_id,
    ...(t.pending_transaction_id ? { pendingTransactionId: t.pending_transaction_id } : {}),
    date: isoDay(t.date) ?? Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`),
    ...(isoDay(t.authorized_date) !== undefined ? { authorizedDate: isoDay(t.authorized_date) } : {}),
    amountCents: Math.round(Math.abs(t.amount) * 100),
    direction,
    currency: t.iso_currency_code ?? "USD",
    name: (t.name ?? "").slice(0, 200),
    ...(t.merchant_name ? { merchantName: t.merchant_name.slice(0, 120) } : {}),
    ...(primary ? { pfcPrimary: primary } : {}),
    ...(detailed ? { pfcDetailed: detailed } : {}),
    pending: Boolean(t.pending),
    ...(direction === "out" && !reason && categoryFor(primary, detailed) ? { category: categoryFor(primary, detailed) } : {}),
    ...(reason ? { excluded: true, excludeReason: reason } : {}),
  };
}

export function toCents(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : undefined;
}
