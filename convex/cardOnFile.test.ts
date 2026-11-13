import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { autoChargeDecision, cardConsentText, feeEmailBody, type AutoChargeInput } from "./lib/cardConsent";

/* H1 (truth-saved-card-no-show): the card a client pays a deposit with is
   saved once they agree, recorded only from Stripe's webhook, and a no-show
   fee is charged to it once, behind a studio switch that starts OFF. Each
   test names the eval.md check it proves. */

/* ── A fake Stripe ─────────────────────────────────────────────────── */
type PiMode = "succeed" | "decline" | "auth" | "requires_action" | "network" | "processing";
const fake: {
  pi: { params: Record<string, unknown>; opts: Record<string, unknown> }[];
  piMode: PiMode;
  checkout: { params: Record<string, unknown>; opts: Record<string, unknown> }[];
  setupIntents: { params: Record<string, unknown>; opts: Record<string, unknown> }[];
  customers: number;
  detached: string[];
  /** Customer ids that do not exist on any account (stale / other mode). */
  missingCustomers: Set<string>;
  retrieved: { id: string; opts: Record<string, unknown> }[];
  /** PaymentIntents paymentIntents.list returns. */
  intents: { id: string; status: string; metadata: Record<string, string> }[];
  listed: { params: Record<string, unknown>; opts: Record<string, unknown> }[];
  listFails: boolean;
} = { pi: [], piMode: "succeed", checkout: [], setupIntents: [], customers: 0, detached: [], missingCustomers: new Set(), retrieved: [], intents: [], listed: [], listFails: false };

vi.mock("./lib/stripe", async (orig) => {
  const real = await orig<typeof import("./lib/stripe")>();
  return {
    ...real,
    stripeClient: () => ({
      customers: {
        create: async () => ({ id: `cus_new_${++fake.customers}` }),
        retrieve: async (id: string, _p: unknown, opts: Record<string, unknown>) => {
          fake.retrieved.push({ id, opts });
          if (fake.missingCustomers.has(id)) {
            throw Object.assign(new Error(`No such customer: '${id}'`), { type: "StripeInvalidRequestError", code: "resource_missing", statusCode: 404 });
          }
          return { id };
        },
      },
      setupIntents: {
        create: async (params: Record<string, unknown>, opts: Record<string, unknown>) => {
          fake.setupIntents.push({ params, opts });
          return { id: "seti_1", client_secret: "seti_1_secret" };
        },
      },
      checkout: {
        sessions: {
          create: async (params: Record<string, unknown>, opts: Record<string, unknown>) => {
            if (typeof params.customer === "string" && fake.missingCustomers.has(params.customer)) {
              throw Object.assign(new Error("No such customer"), { code: "resource_missing", statusCode: 404 });
            }
            fake.checkout.push({ params, opts });
            return { id: "cs_1", url: "https://checkout.stripe.test/cs_1" };
          },
        },
      },
      paymentMethods: {
        retrieve: async (id: string) => ({ id, card: { brand: "visa", last4: "4242" } }),
        detach: async (id: string) => {
          fake.detached.push(id);
          return { id };
        },
      },
      paymentIntents: {
        create: async (params: Record<string, unknown>, opts: Record<string, unknown>) => {
          fake.pi.push({ params, opts });
          const n = fake.pi.length;
          if (fake.piMode === "decline") {
            throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError", code: "card_declined" });
          }
          if (fake.piMode === "auth") {
            throw Object.assign(new Error("Authentication required."), { type: "StripeCardError", code: "authentication_required" });
          }
          if (fake.piMode === "network") throw new Error("socket hang up");
          if (fake.piMode === "requires_action") return { id: `pi_${n}`, status: "requires_action" };
          if (fake.piMode === "processing") return { id: `pi_${n}`, status: "processing" };
          return { id: `pi_${n}`, status: "succeeded" };
        },
        list: async (params: Record<string, unknown>, opts: Record<string, unknown>) => {
          fake.listed.push({ params, opts });
          if (fake.listFails) throw new Error("socket hang up");
          return { data: fake.intents };
        },
      },
    }),
  };
});

const HOUR = 3_600_000;
const newT = () => convexTest(schema);
type T = ReturnType<typeof newT>;

const ORG_A = "studio_a";
const ORG_B = "studio_b";

async function seed(t: T, opts: { autoCharge?: boolean; feePct?: number; windowHours?: number } = {}) {
  return t.run(async (ctx) => {
    for (const [orgId, acct] of [[ORG_A, "acct_A"], [ORG_B, "acct_B"]] as const) {
      await ctx.db.insert("orgs", {
        orgId,
        name: orgId === ORG_A ? "Gold Room" : "Other Studio",
        slug: orgId,
        tier: "growth",
        status: "active",
        ownerEmail: `owner@${orgId}.test`,
        stripeAccountId: acct,
        stripeChargesEnabled: true,
        cancellationFeePct: opts.feePct ?? 50,
        cancellationWindowHours: opts.windowHours ?? 24,
        noShowAutoCharge: opts.autoCharge,
      });
      await ctx.db.insert("members", { orgId, name: "Owner", role: "owner", skills: [], clerkUserId: `own_${orgId}` });
      await ctx.db.insert("members", { orgId, name: "Eng", role: "engineer", skills: [], clerkUserId: `eng_${orgId}` });
    }
    const artist = (orgId: string, cus: string) =>
      ctx.db.insert("artists", {
        orgId,
        name: orgId === ORG_A ? "Nova" : "Bea",
        type: "artist",
        email: `${cus}@client.test`,
        genres: [],
        tags: [],
        status: "active",
        lifetimeValueCents: 0,
        sessionCount: 0,
        reliability: "solid",
        stripeCustomerId: cus,
      });
    const a = await artist(ORG_A, "cus_A");
    const b = await artist(ORG_B, "cus_B");
    const session = await ctx.db.insert("sessions", {
      orgId: ORG_A,
      title: "Nova - Studio A",
      artistId: a,
      serviceType: "recording",
      startTime: Date.now() + 2 * HOUR,
      endTime: Date.now() + 4 * HOUR,
      status: "tentative",
      rateCents: 20_000,
      depositCents: 6_000,
      depositPaid: false,
      intakeCompleted: false,
    });
    return { a, b, session };
  });
}

const owner = (t: T, org = ORG_A) => t.withIdentity({ subject: `own_${org}`, orgId: org });
const engineer = (t: T, org = ORG_A) => t.withIdentity({ subject: `eng_${org}`, orgId: org });

let evtN = 0;
const evt = (type: string, object: Record<string, unknown>, account?: string, id?: string) => ({
  id: id ?? `evt_${++evtN}`,
  type,
  ...(account ? { account } : {}),
  data: { object },
});

const setupIntent = (artistId: string, over: Record<string, unknown> = {}) => ({
  id: "seti_x",
  object: "setup_intent",
  status: "succeeded",
  usage: "off_session",
  customer: "cus_A",
  payment_method: "pm_staff",
  created: Math.floor(Date.now() / 1000),
  metadata: { kind: "card_on_file", artistId, orgId: ORG_A },
  ...over,
});

const bookingPi = (sessionId: string, artistId: string, over: Record<string, unknown> = {}) => ({
  id: "pi_deposit",
  object: "payment_intent",
  status: "succeeded",
  amount: 6_000,
  customer: "cus_A",
  payment_method: "pm_checkout",
  setup_future_usage: "off_session",
  created: Math.floor(Date.now() / 1000),
  metadata: { kind: "booking_card", sessionId, artistId, orgId: ORG_A },
  ...over,
});

const artistRow = (t: T, id: Id<"artists">) => t.run((ctx) => ctx.db.get(id));
const sessionRow = (t: T, id: Id<"sessions">) => t.run((ctx) => ctx.db.get(id));
const stripeEventTypes = (t: T) => t.run(async (ctx) => (await ctx.db.query("stripeEvents").collect()).map((e) => e.type));
const invoicesA = (t: T) => t.run((ctx) => ctx.db.query("invoices").withIndex("by_org", (q) => q.eq("orgId", ORG_A)).collect());
const recoveryA = (t: T) => t.run((ctx) => ctx.db.query("recoveryEvents").withIndex("by_org", (q) => q.eq("orgId", ORG_A)).collect());
const scheduled = (t: T, name: string) =>
  t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) => f.name.includes(name)));
const emails = (t: T, kind: string) =>
  t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.kind === kind));

/** The consent the checkout records, then the webhook that saves the card. */
async function agreeAndSave(t: T, ids: { a: Id<"artists">; session: Id<"sessions"> }) {
  await t.run(async (ctx) => {
    await ctx.db.patch(ids.session, {
      cardConsent: { text: "agreed", feePct: 50, windowHours: 24, maxFeeCents: 10_000, agreedAt: Date.now() },
    });
  });
  await t.mutation(internal.billingWebhooks.handle, { event: evt("payment_intent.succeeded", bookingPi(ids.session, ids.a), "acct_A") });
}

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
  fake.pi = [];
  fake.checkout = [];
  fake.setupIntents = [];
  fake.customers = 0;
  fake.detached = [];
  fake.missingCustomers = new Set();
  fake.retrieved = [];
  fake.intents = [];
  fake.listed = [];
  fake.listFails = false;
  fake.piMode = "succeed";
});
afterEach(() => vi.unstubAllEnvs());

/* ── Saving the card (webhook) ───────────────────────────────────────── */
describe("card saved only from Stripe's webhook", () => {
  it("U-01: a succeeded SetupIntent on the studio's own account saves the card on the right client", async () => {
    const t = newT();
    const { a, b } = await seed(t);
    await t.mutation(internal.billingWebhooks.handle, { event: evt("setup_intent.succeeded", setupIntent(a), "acct_A") });
    const art = await artistRow(t, a);
    expect(art?.defaultPaymentMethodId).toBe("pm_staff");
    expect(art?.cardSavedVia).toBe("staff");
    expect((await artistRow(t, b))?.defaultPaymentMethodId).toBeUndefined();
    expect(await stripeEventTypes(t)).toEqual(["setup_intent.succeeded"]);
    // Brand / last 4 are looked up afterwards, for display only.
    expect(await scheduled(t, "fetchCardDetails")).toHaveLength(1);
  });

  it("U-04: the same event from another studio's connected account is refused", async () => {
    const t = newT();
    const { a } = await seed(t);
    await t.mutation(internal.billingWebhooks.handle, { event: evt("setup_intent.succeeded", setupIntent(a), "acct_B") });
    expect((await artistRow(t, a))?.defaultPaymentMethodId).toBeUndefined();
    expect(await stripeEventTypes(t)).toEqual(["setup_intent.succeeded.account_mismatch"]);
  });

  it("U-05: a platform event (no connected account) is refused", async () => {
    const t = newT();
    const { a } = await seed(t);
    await t.mutation(internal.billingWebhooks.handle, { event: evt("setup_intent.succeeded", setupIntent(a)) });
    expect((await artistRow(t, a))?.defaultPaymentMethodId).toBeUndefined();
  });

  it("U-06: a customer that belongs to another studio's client is refused", async () => {
    const t = newT();
    const { a } = await seed(t);
    await t.mutation(internal.billingWebhooks.handle, {
      event: evt("setup_intent.succeeded", setupIntent(a, { customer: "cus_B" }), "acct_A"),
    });
    expect((await artistRow(t, a))?.defaultPaymentMethodId).toBeUndefined();
    expect(await stripeEventTypes(t)).toEqual(["setup_intent.succeeded.customer_mismatch"]);
  });

  it("refuses another studio's client id in the metadata, and an org that does not match the client", async () => {
    const t = newT();
    const { a, b } = await seed(t);
    // Org A's account, org B's client (with org B's customer).
    await t.mutation(internal.billingWebhooks.handle, {
      event: evt("setup_intent.succeeded", setupIntent(b, { customer: "cus_B" }), "acct_A"),
    });
    // Metadata claims org B for org A's client.
    await t.mutation(internal.billingWebhooks.handle, {
      event: evt("setup_intent.succeeded", setupIntent(a, { metadata: { kind: "card_on_file", artistId: a, orgId: ORG_B } }), "acct_A"),
    });
    expect((await artistRow(t, a))?.defaultPaymentMethodId).toBeUndefined();
    expect((await artistRow(t, b))?.defaultPaymentMethodId).toBeUndefined();
  });

  it("U-07: a SetupIntent without Pulse's metadata is ignored", async () => {
    const t = newT();
    const { a } = await seed(t);
    await t.mutation(internal.billingWebhooks.handle, {
      event: evt("setup_intent.succeeded", setupIntent(a, { metadata: {} }), "acct_A"),
    });
    expect((await artistRow(t, a))?.defaultPaymentMethodId).toBeUndefined();
    expect(await stripeEventTypes(t)).toEqual(["setup_intent.succeeded.ignored"]);
  });

  it("U-08: a SetupIntent that has not succeeded does nothing (requires_action, canceled)", async () => {
    const t = newT();
    const { a } = await seed(t);
    for (const status of ["requires_action", "canceled"]) {
      await t.mutation(internal.billingWebhooks.handle, {
        event: evt("setup_intent.succeeded", setupIntent(a, { status }), "acct_A"),
      });
    }
    // An on-session-only SetupIntent is not a card Pulse may charge later.
    await t.mutation(internal.billingWebhooks.handle, {
      event: evt("setup_intent.succeeded", setupIntent(a, { usage: "on_session" }), "acct_A"),
    });
    expect((await artistRow(t, a))?.defaultPaymentMethodId).toBeUndefined();
  });

  it("U-09: a replayed webhook is a no-op (one activity row)", async () => {
    const t = newT();
    const { a } = await seed(t);
    const e = evt("setup_intent.succeeded", setupIntent(a), "acct_A", "evt_same");
    expect(await t.mutation(internal.billingWebhooks.handle, { event: e })).toEqual({ ok: true });
    expect(await t.mutation(internal.billingWebhooks.handle, { event: e })).toEqual({ duplicate: true });
    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("activity").collect()).filter((r) => r.kind === "client.card_saved"));
    expect(rows).toHaveLength(1);
  });

  it("a save Stripe created before staff removed the card does not put it back", async () => {
    const t = newT();
    const { a } = await seed(t);
    await t.run((ctx) => ctx.db.patch(a, { cardRemovedAt: Date.now() + 5_000 }));
    await t.mutation(internal.billingWebhooks.handle, { event: evt("setup_intent.succeeded", setupIntent(a), "acct_A") });
    expect((await artistRow(t, a))?.defaultPaymentMethodId).toBeUndefined();
    expect(await stripeEventTypes(t)).toEqual(["setup_intent.succeeded.card_removed"]);
  });

  it("the deposit's card is saved on the client and on the booking once the client agreed", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    expect((await artistRow(t, ids.a))?.defaultPaymentMethodId).toBe("pm_checkout");
    expect((await artistRow(t, ids.a))?.cardSavedVia).toBe("checkout");
    expect((await sessionRow(t, ids.session))?.cardConsent?.paymentMethodId).toBe("pm_checkout");
  });

  it("the deposit's card is NOT saved when no agreement is recorded on the booking", async () => {
    const t = newT();
    const { a, session } = await seed(t, { autoCharge: true });
    await t.mutation(internal.billingWebhooks.handle, { event: evt("payment_intent.succeeded", bookingPi(session, a), "acct_A") });
    expect((await artistRow(t, a))?.defaultPaymentMethodId).toBeUndefined();
    expect(await stripeEventTypes(t)).toEqual(["payment_intent.succeeded.no_consent"]);
  });

  it("a deposit card event from the wrong account, wrong customer or without future use is refused", async () => {
    const t = newT();
    const { a, session } = await seed(t, { autoCharge: true });
    await t.run((ctx) =>
      ctx.db.patch(session, { cardConsent: { text: "x", feePct: 50, windowHours: 24, maxFeeCents: 10_000, agreedAt: Date.now() } }));
    await t.mutation(internal.billingWebhooks.handle, { event: evt("payment_intent.succeeded", bookingPi(session, a), "acct_B") });
    await t.mutation(internal.billingWebhooks.handle, {
      event: evt("payment_intent.succeeded", bookingPi(session, a, { customer: "cus_B" }), "acct_A"),
    });
    await t.mutation(internal.billingWebhooks.handle, {
      event: evt("payment_intent.succeeded", bookingPi(session, a, { setup_future_usage: null }), "acct_A"),
    });
    await t.mutation(internal.billingWebhooks.handle, { event: evt("payment_intent.succeeded", bookingPi(session, a)) });
    expect((await artistRow(t, a))?.defaultPaymentMethodId).toBeUndefined();
    expect((await sessionRow(t, session))?.cardConsent?.paymentMethodId).toBeUndefined();
  });

  it("an unrelated payment_intent.succeeded on a studio account falls through untouched", async () => {
    const t = newT();
    const { a } = await seed(t);
    await t.mutation(internal.billingWebhooks.handle, {
      event: evt("payment_intent.succeeded", { id: "pi_other", status: "succeeded", metadata: {} }, "acct_A"),
    });
    expect((await artistRow(t, a))?.defaultPaymentMethodId).toBeUndefined();
  });

  it("U-10: no browser-callable function takes a payment method id; only the webhook helper sets a card", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === "_generated" || name === "node_modules") continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) files.push(p);
      }
    };
    walk(join(__dirname));
    // Any database write that sets a card (clearing it to undefined is fine).
    const setters = files.filter((f) =>
      /db\.(patch|insert|replace)\([^;]*?defaultPaymentMethodId:\s*(?!\s|undefined)/.test(readFileSync(f, "utf8")));
    expect(setters.map((f) => f.replace(/.*convex\//, ""))).toEqual(["lib/cardOnFileWebhook.ts"]);
    // No public function argument is a payment method.
    const publicArgs = files.filter((f) => /paymentMethodId:\s*v\./.test(readFileSync(f, "utf8")));
    for (const f of publicArgs) {
      expect(readFileSync(f, "utf8")).not.toMatch(/=\s*(mutation|action|query)\(\{\s*args:\s*\{[^}]*paymentMethodId/);
    }
  });
});

/* ── Staff "Add a card" ───────────────────────────────────────────────── */
describe("createSetupIntent", () => {
  it("tags the SetupIntent so only it can attach a card to this client", async () => {
    const t = newT();
    const { a } = await seed(t);
    const res = await owner(t).action(api.cardOnFile.createSetupIntent, { artistId: a });
    expect(res.stripeAccountId).toBe("acct_A");
    expect(fake.setupIntents[0].params.metadata).toEqual({ kind: "card_on_file", artistId: a, orgId: ORG_A });
    expect(fake.setupIntents[0].opts).toEqual({ stripeAccount: "acct_A" });
  });

  it("U-11: a signed-out caller cannot create a SetupIntent", async () => {
    const t = newT();
    const { a } = await seed(t);
    await expect(t.action(api.cardOnFile.createSetupIntent, { artistId: a })).rejects.toThrow();
    expect(fake.setupIntents).toHaveLength(0);
  });

  it("U-12: a member without invoices.send (engineer) is refused", async () => {
    const t = newT();
    const { a } = await seed(t);
    await expect(engineer(t).action(api.cardOnFile.createSetupIntent, { artistId: a })).rejects.toThrow(/CAPABILITY_DENIED|FORBIDDEN/);
    expect(fake.setupIntents).toHaveLength(0);
  });

  it("U-13: another studio's client id is refused", async () => {
    const t = newT();
    const { b } = await seed(t);
    await expect(owner(t).action(api.cardOnFile.createSetupIntent, { artistId: b })).rejects.toThrow(/Client not found/);
    expect(fake.setupIntents).toHaveLength(0);
  });

  it("never replaces a client's recorded Stripe customer (two clicks at once)", async () => {
    const t = newT();
    const { a } = await seed(t);
    await t.run((ctx) => ctx.db.patch(a, { stripeCustomerId: undefined }));
    const first = await t.mutation(internal.cardOnFile._saveCustomer, { artistId: a, stripeCustomerId: "cus_1", stripeAccountId: "acct_A" });
    const second = await t.mutation(internal.cardOnFile._saveCustomer, { artistId: a, stripeCustomerId: "cus_2", stripeAccountId: "acct_A" });
    expect([first, second]).toEqual(["cus_1", "cus_1"]);
    expect((await artistRow(t, a))?.stripeCustomerId).toBe("cus_1");
  });
});

/* ── Staff see and remove the card ────────────────────────────────────── */
describe("card on file: see and remove", () => {
  it("staff with money access see the card; an engineer sees nothing", async () => {
    const t = newT();
    const { a } = await seed(t);
    await t.mutation(internal.billingWebhooks.handle, { event: evt("setup_intent.succeeded", setupIntent(a), "acct_A") });
    await t.mutation(internal.cardOnFile._setCardDetails, { artistId: a, paymentMethodId: "pm_staff", brand: "visa", last4: "4242" });
    expect(await owner(t).query(api.cardOnFile.cardStatus, { artistId: a })).toMatchObject({
      hasCard: true, brand: "visa", last4: "4242", savedVia: "staff", autoChargeOn: false,
    });
    expect(await engineer(t).query(api.cardOnFile.cardStatus, { artistId: a })).toBeNull();
    // Another studio's client: nothing.
    expect(await owner(t, ORG_B).query(api.cardOnFile.cardStatus, { artistId: a })).toBeNull();
  });

  it("card details for a card that was replaced are not shown", async () => {
    const t = newT();
    const { a } = await seed(t);
    await t.run((ctx) => ctx.db.patch(a, { defaultPaymentMethodId: "pm_new" }));
    await t.mutation(internal.cardOnFile._setCardDetails, { artistId: a, paymentMethodId: "pm_old", brand: "visa", last4: "1111" });
    expect((await artistRow(t, a))?.cardLast4).toBeUndefined();
  });

  it("removing the card clears it, detaches it in Stripe, and is safe twice", async () => {
    const t = newT();
    const { a } = await seed(t);
    await t.mutation(internal.billingWebhooks.handle, { event: evt("setup_intent.succeeded", setupIntent(a), "acct_A") });
    expect(await owner(t).mutation(api.cardOnFile.removeCard, { artistId: a })).toEqual({ removed: true });
    expect(await owner(t).mutation(api.cardOnFile.removeCard, { artistId: a })).toEqual({ removed: false });
    const art = await artistRow(t, a);
    expect(art?.defaultPaymentMethodId).toBeUndefined();
    expect(art?.cardRemovedAt).toBeTypeOf("number");
    expect(await scheduled(t, "detachCard")).toHaveLength(1);
  });

  it("removing is refused for an engineer, another studio, or a signed-out caller", async () => {
    const t = newT();
    const { a } = await seed(t);
    await t.run((ctx) => ctx.db.patch(a, { defaultPaymentMethodId: "pm_x" }));
    await expect(engineer(t).mutation(api.cardOnFile.removeCard, { artistId: a })).rejects.toThrow();
    await expect(owner(t, ORG_B).mutation(api.cardOnFile.removeCard, { artistId: a })).rejects.toThrow(/Client not found/);
    await expect(t.mutation(api.cardOnFile.removeCard, { artistId: a })).rejects.toThrow();
    expect((await artistRow(t, a))?.defaultPaymentMethodId).toBe("pm_x");
  });
});

/* ── The studio switch ───────────────────────────────────────────────── */
describe("the card-charging switch", () => {
  it("starts off; only the owner can turn it on", async () => {
    const t = newT();
    await seed(t);
    expect((await owner(t).query(api.sessions.getCancellationPolicy, {})).noShowAutoCharge).toBe(false);
    await expect(engineer(t).mutation(api.sessions.setNoShowAutoCharge, { enabled: true })).rejects.toThrow(/owner/);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { orgId: ORG_A, name: "Mgr", role: "manager", skills: [], clerkUserId: "mgr_a" });
    });
    await expect(
      t.withIdentity({ subject: "mgr_a", orgId: ORG_A }).mutation(api.sessions.setNoShowAutoCharge, { enabled: true }),
    ).rejects.toThrow(/owner/);
    await expect(t.mutation(api.sessions.setNoShowAutoCharge, { enabled: true })).rejects.toThrow();
    await owner(t).mutation(api.sessions.setNoShowAutoCharge, { enabled: true });
    expect((await owner(t).query(api.sessions.getCancellationPolicy, {})).noShowAutoCharge).toBe(true);
    // Only this studio.
    expect((await owner(t, ORG_B).query(api.sessions.getCancellationPolicy, {})).noShowAutoCharge).toBe(false);
  });
});

/* ── Checkout: the client agrees, then the card is saved ─────────────── */
describe("checkout saves the card only after the client agrees", () => {
  it("switch off: checkout is exactly as before (no sentence, no saved card, consent ignored)", async () => {
    const t = newT();
    const { session } = await seed(t);
    const b = await t.query(api.booking.booking, { sessionId: session });
    expect(b?.cardSave).toBeNull();
    await t.action(api.booking.payViaStripe, { sessionId: session, kind: "deposit", cardConsentText: "anything" });
    const params = fake.checkout[0].params;
    expect(params.customer).toBeUndefined();
    expect(params.payment_intent_data).toBeUndefined();
    expect(params.metadata).toEqual({ sessionId: session, kind: "deposit" });
    expect((await sessionRow(t, session))?.cardConsent).toBeUndefined();
  });

  it("switch on: the page shows the sentence with the fee terms, and the consent record never leaves", async () => {
    const t = newT();
    const { session } = await seed(t, { autoCharge: true });
    const b = await t.query(api.booking.booking, { sessionId: session });
    expect(b?.cardSave?.text).toBe(
      "Gold Room will save the card you pay with today, securely with Stripe. If you miss this session, Gold Room may charge that card a fee of 50% of the session price ($100), less anything you already paid for this session, under its cancellation policy. If you cancel less than 24 hours before it starts, Gold Room may bill you that fee by invoice; a cancellation is never charged to this card automatically.",
    );
    await t.run((ctx) =>
      ctx.db.patch(session, { cardConsent: { text: "x", feePct: 50, windowHours: 24, maxFeeCents: 10_000, agreedAt: 1, paymentMethodId: "pm_secret" } }));
    const after = await t.query(api.booking.booking, { sessionId: session });
    expect(JSON.stringify(after)).not.toContain("pm_secret");
    expect(after?.cardSave).toBeNull(); // asked once per booking
  });

  it("switch on: paying without agreeing, or agreeing to different words, is refused", async () => {
    const t = newT();
    const { session } = await seed(t, { autoCharge: true });
    await expect(t.action(api.booking.payViaStripe, { sessionId: session, kind: "deposit" })).rejects.toThrow(/tick the box/);
    await expect(
      t.action(api.booking.payViaStripe, { sessionId: session, kind: "deposit", cardConsentText: "I agree to nothing" }),
    ).rejects.toThrow(/terms changed/);
    expect(fake.checkout).toHaveLength(0);
    expect((await sessionRow(t, session))?.cardConsent).toBeUndefined();
  });

  it("switch on: agreeing records what was shown and when, and asks Stripe to save the card on the client's customer", async () => {
    const t = newT();
    const { a, session } = await seed(t, { autoCharge: true });
    const text = (await t.query(api.booking.booking, { sessionId: session }))!.cardSave!.text;
    const before = Date.now();
    await t.action(api.booking.payViaStripe, { sessionId: session, kind: "deposit", cardConsentText: text });
    const consent = (await sessionRow(t, session))?.cardConsent;
    expect(consent).toMatchObject({ text, feePct: 50, windowHours: 24, maxFeeCents: 10_000 });
    expect(consent!.agreedAt).toBeGreaterThanOrEqual(before);
    const { params, opts } = fake.checkout[0];
    expect(opts).toEqual({ stripeAccount: "acct_A" });
    expect(params.customer).toBe("cus_A");
    expect(params.payment_intent_data).toEqual({
      setup_future_usage: "off_session",
      metadata: { kind: "booking_card", sessionId: session, artistId: a, orgId: ORG_A },
    });
  });

  it("switch on: a client with no Stripe customer yet gets one recorded", async () => {
    const t = newT();
    const { a, session } = await seed(t, { autoCharge: true });
    await t.run((ctx) => ctx.db.patch(a, { stripeCustomerId: undefined }));
    const text = (await t.query(api.booking.booking, { sessionId: session }))!.cardSave!.text;
    await t.action(api.booking.payViaStripe, { sessionId: session, kind: "deposit", cardConsentText: text });
    expect((await artistRow(t, a))?.stripeCustomerId).toBe("cus_new_1");
    expect(fake.checkout[0].params.customer).toBe("cus_new_1");
  });

  it("no fee in the policy means nothing to agree to and no card saved", async () => {
    const t = newT();
    const { session } = await seed(t, { autoCharge: true, feePct: 0 });
    expect((await t.query(api.booking.booking, { sessionId: session }))?.cardSave).toBeNull();
    await t.action(api.booking.payViaStripe, { sessionId: session, kind: "deposit" });
    expect(fake.checkout[0].params.payment_intent_data).toBeUndefined();
  });
});

/* ── Charging a no-show ──────────────────────────────────────────────── */
async function confirmed(t: T, session: Id<"sessions">) {
  await t.run((ctx) => ctx.db.patch(session, { status: "confirmed" }));
}

/** A confirmed booking whose start time has passed. Round 2 (H205-07): a
 *  no-show is never charged for a session that had not started. */
async function confirmedStarted(t: T, session: Id<"sessions">) {
  await t.run((ctx) => ctx.db.patch(session, { status: "confirmed", startTime: Date.now() - HOUR, endTime: Date.now() + HOUR }));
}

/** Run the scheduled charge as the scheduler would, once the 15-minute undo
 *  window has passed (H205-07). Ages only a charge still pending. */
async function runCharge(t: T, invoiceId: Id<"invoices">) {
  await t.run(async (ctx) => {
    const inv = await ctx.db.get(invoiceId);
    if (inv?.autoCharge?.status === "pending") {
      await ctx.db.patch(invoiceId, { autoCharge: { ...inv.autoCharge, at: inv.autoCharge.at - 16 * 60_000 } });
    }
  });
  await t.action(internal.cardOnFile.chargeFee, { invoiceId });
}

describe("charging a no-show fee", () => {
  it("U-17: switch off means no charge even with a saved, agreed card", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: false });
    await agreeAndSave(t, ids);
    await confirmedStarted(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    expect(await scheduled(t, "chargeFee")).toHaveLength(0);
    const [inv] = await invoicesA(t);
    expect(inv.status).toBe("draft");
    expect(inv.autoCharge).toBeUndefined();
    const [mail] = await emails(t, "session.no_show_fee");
    expect(mail.body).toMatch(/The studio will send you an invoice for the \$100 balance/);
  });

  it("no agreement recorded means no automatic charge, ever (staff-added card)", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await t.mutation(internal.billingWebhooks.handle, { event: evt("setup_intent.succeeded", setupIntent(ids.a), "acct_A") });
    await confirmedStarted(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    expect(await scheduled(t, "chargeFee")).toHaveLength(0);
  });

  it("U-15 / U-18: switch on and agreed -> one charge for the fee, invoice paid, fee counted once paid", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await t.mutation(internal.cardOnFile._setCardDetails, { artistId: ids.a, paymentMethodId: "pm_checkout", brand: "visa", last4: "4242" });
    await confirmedStarted(t, ids.session);
    // Double click: the second call is a no-op transition.
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const invs = await invoicesA(t);
    expect(invs).toHaveLength(1);
    expect(invs[0].autoCharge?.status).toBe("pending");
    expect(await scheduled(t, "chargeFee")).toHaveLength(1);
    // Billed, not collected: nothing counted and nothing emailed yet.
    expect(await recoveryA(t)).toHaveLength(0);
    expect(await emails(t, "session.no_show_fee")).toHaveLength(0);

    // The scheduled charge runs (twice, as a retry would): Stripe is asked once.
    await runCharge(t, invs[0]._id);
    await runCharge(t, invs[0]._id);
    expect(fake.pi).toHaveLength(1);
    expect(fake.pi[0].params).toMatchObject({
      amount: 10_000, customer: "cus_A", payment_method: "pm_checkout", off_session: true, confirm: true,
      metadata: { kind: "no_show_fee", invoiceId: invs[0]._id },
    });
    expect(fake.pi[0].opts).toEqual({ stripeAccount: "acct_A", idempotencyKey: `pulse-no-show-fee-${invs[0]._id}` });

    const [paid] = await invoicesA(t);
    expect(paid).toMatchObject({ status: "paid", paymentMethod: "card" });
    expect(paid.autoCharge).toMatchObject({ status: "succeeded", reference: "pi_1" });
    const rec = await recoveryA(t);
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ kind: "no_show_fee", amountCents: 10_000 });
    const [mail] = await emails(t, "session.no_show_fee");
    expect(mail.body).toMatch(/We charged the \$100 balance to your saved card ending 4242, as you agreed when you booked\./);

    // Stripe's own payment_intent.succeeded for that charge changes nothing more.
    await t.mutation(internal.billingWebhooks.handle, {
      event: evt("payment_intent.succeeded", {
        id: "pi_1", status: "succeeded", amount: 10_000, metadata: { kind: "no_show_fee", invoiceId: invs[0]._id },
      }, "acct_A"),
    });
    expect(await recoveryA(t)).toHaveLength(1);
  });

  it("the deposit kept is applied first: only the remainder is charged", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await t.run((ctx) => ctx.db.patch(ids.session, { status: "confirmed", startTime: Date.now() - HOUR, depositPaid: true, amountPaidCents: 6_000 }));
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const [inv] = await invoicesA(t);
    await runCharge(t, inv._id);
    expect(fake.pi[0].params.amount).toBe(4_000);
  });

  for (const [mode, status] of [["decline", "failed"], ["auth", "needs_client"], ["requires_action", "needs_client"], ["network", "failed"]] as const) {
    it(`U-16 (${mode}): a charge that fails or needs the client leaves the invoice, tells staff and the client`, async () => {
      const t = newT();
      const ids = await seed(t, { autoCharge: true });
      await agreeAndSave(t, ids);
      await confirmedStarted(t, ids.session);
      await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
      fake.piMode = mode;
      const [inv] = await invoicesA(t);
      await runCharge(t, inv._id);
      const [after] = await invoicesA(t);
      expect(after.status).toBe("draft");
      expect(after.autoCharge?.status).toBe(status);
      expect(await recoveryA(t)).toHaveLength(0);
      const insights = await t.run((ctx) => ctx.db.query("insights").withIndex("by_org", (q) => q.eq("orgId", ORG_A)).collect());
      expect(insights.some((i) => i.title.includes(`Send invoice ${inv.number}`))).toBe(true);
      expect((await emails(t, "invoice.auto_charge_failed"))[0]?.recipient).toBe("owner@studio_a.test");
      const [mail] = await emails(t, "session.no_show_fee");
      expect(mail.body).toMatch(/The studio will send you an invoice/);
      expect(mail.body).not.toMatch(/charged/);
      // A retry after the failure does not charge again.
      fake.piMode = "succeed";
      await runCharge(t, inv._id);
      expect(fake.pi).toHaveLength(1);
    });
  }

  it("a charge Stripe confirms later (webhook) settles the invoice it left open", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await confirmedStarted(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    fake.piMode = "network";
    const [inv] = await invoicesA(t);
    await runCharge(t, inv._id);
    // Wrong account or wrong amount: ignored.
    const pi = (over: Record<string, unknown>, account: string) =>
      evt("payment_intent.succeeded", { id: "pi_late", status: "succeeded", amount: 10_000, metadata: { kind: "no_show_fee", invoiceId: inv._id }, ...over }, account);
    await t.mutation(internal.billingWebhooks.handle, { event: pi({}, "acct_B") });
    await t.mutation(internal.billingWebhooks.handle, { event: pi({ amount: 1 }, "acct_A") });
    expect((await invoicesA(t))[0].status).toBe("draft");
    await t.mutation(internal.billingWebhooks.handle, { event: pi({}, "acct_A") });
    expect((await invoicesA(t))[0]).toMatchObject({ status: "paid", paymentMethod: "card" });
    expect(await recoveryA(t)).toHaveLength(1);
  });

  it("a card staff replaced or removed after the booking is not charged", async () => {
    for (const change of ["replaced", "removed"] as const) {
      const t = newT();
      const ids = await seed(t, { autoCharge: true });
      await agreeAndSave(t, ids);
      if (change === "replaced") {
        await t.mutation(internal.billingWebhooks.handle, {
          event: evt("setup_intent.succeeded", setupIntent(ids.a, { created: Math.floor(Date.now() / 1000) + 10 }), "acct_A"),
        });
      } else {
        await owner(t).mutation(api.cardOnFile.removeCard, { artistId: ids.a });
      }
      await confirmedStarted(t, ids.session);
      await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
      expect(await scheduled(t, "chargeFee")).toHaveLength(0);
    }
  });

  it("the card is checked again when the charge runs: switched off in between means no charge", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await confirmedStarted(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    await owner(t).mutation(api.sessions.setNoShowAutoCharge, { enabled: false });
    const [inv] = await invoicesA(t);
    await runCharge(t, inv._id);
    expect(fake.pi).toHaveLength(0);
    const [after] = await invoicesA(t);
    expect(after).toMatchObject({ status: "draft", autoCharge: { status: "skipped" } });
    const [mail] = await emails(t, "session.no_show_fee");
    expect(mail.body).toMatch(/The studio will send you an invoice/);
  });

  it("an invoice staff voided before the charge ran is not charged", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await confirmedStarted(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const [inv] = await invoicesA(t);
    await t.run((ctx) => ctx.db.patch(inv._id, { status: "void" }));
    await runCharge(t, inv._id);
    expect(fake.pi).toHaveLength(0);
  });

  it("a fee raised above what the client agreed to is not charged", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids); // agreed to at most $100 (50%)
    await owner(t).mutation(api.sessions.setCancellationPolicy, { cancellationFeePct: 80 });
    await confirmedStarted(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    expect(await scheduled(t, "chargeFee")).toHaveLength(0);
  });

  it("H205-02 / H205-04: a late cancel inside the window is never charged to the card; it stays a draft invoice", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await confirmed(t, ids.session);
    // Staff cancel 2 hours before the start (inside the 24h window): the
    // client may not have asked for it (sick engineer, double booking).
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "cancelled" });
    expect(await scheduled(t, "chargeFee")).toHaveLength(0);
    const [inv] = await invoicesA(t);
    expect(inv.lineItems[0].label).toMatch(/late cancellation fee/);
    expect(inv.status).toBe("draft");
    expect(inv.autoCharge).toBeUndefined();
    // Even an invoice forced into "pending" is refused when the charge runs.
    await t.run((ctx) => ctx.db.patch(inv._id, { autoCharge: { status: "pending", at: Date.now() - 20 * 60_000 } }));
    await runCharge(t, inv._id);
    expect(fake.pi).toHaveLength(0);
    const [mail] = await emails(t, "session.cancellation_fee");
    expect(mail.body).toMatch(/The studio will send you an invoice/);
  });
});

/* ── Pure rules ──────────────────────────────────────────────────────── */
describe("autoChargeDecision", () => {
  const base: AutoChargeInput = {
    stripeConfigured: true,
    switchOn: true,
    stripeAccountId: "acct_A",
    chargesEnabled: true,
    stripeCustomerId: "cus_A",
    stripeCustomerAccountId: "acct_A",
    defaultPaymentMethodId: "pm_1",
    consent: { text: "x", feePct: 50, windowHours: 24, maxFeeCents: 10_000, agreedAt: 1, paymentMethodId: "pm_1" },
    status: "no_show",
    feeCents: 10_000,
    chargeCents: 10_000,
    paidCents: 0,
    startTime: 10 * HOUR,
    // Marked an hour after the start (a no-show is never charged before it).
    now: 11 * HOUR,
  };
  it("allows only when every rule holds", () => {
    expect(autoChargeDecision(base)).toEqual({ charge: true });
    expect(autoChargeDecision({ ...base, switchOn: false }).charge).toBe(false);
    expect(autoChargeDecision({ ...base, consent: null }).charge).toBe(false);
    expect(autoChargeDecision({ ...base, consent: { ...base.consent!, paymentMethodId: undefined } }).charge).toBe(false);
    expect(autoChargeDecision({ ...base, defaultPaymentMethodId: "pm_other" }).charge).toBe(false);
    expect(autoChargeDecision({ ...base, feeCents: 10_001 }).charge).toBe(false);
    expect(autoChargeDecision({ ...base, chargeCents: 0 }).charge).toBe(false);
    expect(autoChargeDecision({ ...base, chargesEnabled: false }).charge).toBe(false);
    expect(autoChargeDecision({ ...base, status: "cancelled", now: 10 * HOUR - 25 * HOUR }).charge).toBe(false);
    // Owner decision (round 2): a cancellation is never charged to the card,
    // even inside the window.
    expect(autoChargeDecision({ ...base, status: "cancelled", now: 10 * HOUR - 23 * HOUR }).charge).toBe(false);
  });
  it("states the window in the sentence only when there is one", () => {
    expect(cardConsentText({ studioName: "X", feePct: 100, windowHours: 0, rateCents: 5_000 })).toMatch(/If you miss this session, X may charge that card a fee of 100% of the session price \(\$50\)/);
    expect(cardConsentText({ studioName: "X", feePct: 25, windowHours: 1, rateCents: 5_000 })).toMatch(/less than 1 hour before/);
    // The sentence never says a cancellation is charged to the card.
    const text = cardConsentText({ studioName: "X", feePct: 25, windowHours: 24, rateCents: 5_000 });
    expect(text).toMatch(/If you miss this session, X may charge that card/);
    expect(text).toMatch(/less anything you already paid for this session/);
    expect(text).toMatch(/a cancellation is never charged to this card automatically/);
    expect(text).not.toMatch(/or cancel less than/);
  });
});

describe("U-19: the no-show email says what really happened", () => {
  const common = {
    clientName: "Nova", label: "no-show fee", status: "no_show" as const, title: "Nova - Studio A",
    feeCents: 10_000, depositForfeitCents: 6_000, balanceCents: 4_000,
  };
  it("charged", () => {
    expect(feeEmailBody({ ...common, outcome: "charged", cardLast4: "4242" })).toMatchInlineSnapshot(`
      "Hi Nova,

      Per our booking policy, a no-show fee of $100 applies to your missed session "Nova - Studio A". Your $60 deposit has been applied toward it. We charged the $40 balance to your saved card ending 4242, as you agreed when you booked. Reply here with any questions - we would love to get you rebooked."
    `);
  });
  it("invoice to follow (never 'sent')", () => {
    const body = feeEmailBody({ ...common, outcome: "invoice_to_follow" });
    expect(body).toMatchInlineSnapshot(`
      "Hi Nova,

      Per our booking policy, a no-show fee of $100 applies to your missed session "Nova - Studio A". Your $60 deposit has been applied toward it. The studio will send you an invoice for the $40 balance. Reply here with any questions - we would love to get you rebooked."
    `);
    expect(body).not.toMatch(/have sent|was sent/);
  });
});

/* ── Round 2 review findings (HIGH-RISK-REVIEW-2026-11-12) ─────────────── */

/** A confirmed booking that has already started (a no-show can only be
 *  charged once the session's start time has passed). */
async function startedConfirmed(t: T, session: Id<"sessions">, over: Record<string, unknown> = {}) {
  await t.run((ctx) =>
    ctx.db.patch(session, { status: "confirmed", startTime: Date.now() - HOUR, endTime: Date.now() + HOUR, ...over }),
  );
}

describe("H205-01 / H205-03: never charged for money already paid", () => {
  it("paid in full (no deposit), then no-show: nothing is charged and no fee invoice is raised", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await startedConfirmed(t, ids.session, { depositCents: 0, depositPaid: true, amountPaidCents: 20_000 });
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    expect(await scheduled(t, "chargeFee")).toHaveLength(0);
    expect(await invoicesA(t)).toHaveLength(0);
    expect(fake.pi).toHaveLength(0);
  });

  it("deposit and then the balance paid, 100% fee: nothing more is charged", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true, feePct: 100 });
    await agreeAndSave(t, ids);
    await t.run((ctx) => ctx.db.patch(ids.session, {
      cardConsent: { text: "agreed", feePct: 100, windowHours: 24, maxFeeCents: 20_000, agreedAt: Date.now(), paymentMethodId: "pm_checkout" },
    }));
    await startedConfirmed(t, ids.session, { depositPaid: true, amountPaidCents: 20_000 });
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    expect(await scheduled(t, "chargeFee")).toHaveLength(0);
    expect(await invoicesA(t)).toHaveLength(0);
  });

  it("paid more than the deposit but less than the fee: only the rest of the fee is charged", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await startedConfirmed(t, ids.session, { depositPaid: true, amountPaidCents: 8_000 });
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const [inv] = await invoicesA(t);
    expect(inv.amountCents).toBe(2_000);
    await t.run((ctx) => ctx.db.patch(inv._id, { autoCharge: { status: "pending", at: Date.now() - 20 * 60_000 } }));
    await t.action(internal.cardOnFile.chargeFee, { invoiceId: inv._id });
    expect(fake.pi).toHaveLength(1);
    expect(fake.pi[0].params.amount).toBe(2_000);
  });

  it("a payment made after the no-show was marked stops the charge", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await startedConfirmed(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const [inv] = await invoicesA(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.session, { depositPaid: true, amountPaidCents: 20_000 });
      await ctx.db.patch(inv._id, { autoCharge: { status: "pending", at: Date.now() - 20 * 60_000 } });
    });
    await t.action(internal.cardOnFile.chargeFee, { invoiceId: inv._id });
    expect(fake.pi).toHaveLength(0);
    expect((await invoicesA(t))[0].autoCharge?.status).toBe("skipped");
    // Round 3 (H205-R2-03 / R2-06): nobody is told to bill a covered fee.
    expect((await invoicesA(t))[0].status).toBe("void");
    const insights = await t.run((ctx) => ctx.db.query("insights").withIndex("by_org", (q) => q.eq("orgId", ORG_A)).collect());
    expect(insights.some((i) => i.title.includes("Send invoice"))).toBe(false);
    expect(await emails(t, "invoice.auto_charge_failed")).toHaveLength(0);
    expect(await emails(t, "session.no_show_fee")).toHaveLength(0);
  });

  it("autoChargeDecision refuses when what was paid covers the fee, or the charge exceeds what is left", () => {
    const base: AutoChargeInput = {
      stripeConfigured: true, switchOn: true, stripeAccountId: "acct_A", chargesEnabled: true,
      stripeCustomerId: "cus_A", stripeCustomerAccountId: "acct_A", defaultPaymentMethodId: "pm_1",
      consent: { text: "x", feePct: 50, windowHours: 24, maxFeeCents: 10_000, agreedAt: 1, paymentMethodId: "pm_1" },
      status: "no_show", feeCents: 10_000, chargeCents: 4_000, paidCents: 6_000, startTime: 10 * HOUR, now: 11 * HOUR,
    };
    expect(autoChargeDecision(base)).toEqual({ charge: true });
    expect(autoChargeDecision({ ...base, paidCents: 10_000 }).charge).toBe(false);
    expect(autoChargeDecision({ ...base, paidCents: 20_000 }).charge).toBe(false);
    expect(autoChargeDecision({ ...base, chargeCents: 4_001 }).charge).toBe(false);
  });

  it("the client email credits everything already paid, not only the deposit", () => {
    const body = feeEmailBody({
      clientName: "Nova", label: "no-show fee", status: "no_show", title: "S", feeCents: 10_000,
      depositForfeitCents: 6_000, paidAppliedCents: 8_000, balanceCents: 2_000, outcome: "invoice_to_follow",
    });
    expect(body).toMatch(/The \$80 you already paid for this session has been applied toward it\./);
  });
});

describe("H205-07: a no-show is charged only after an undo window, and never before the start", () => {
  it("the charge is scheduled at least 15 minutes after the no-show is marked", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await confirmedStarted(t, ids.session);
    const before = Date.now();
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const [job] = await scheduled(t, "chargeFee");
    expect(job.scheduledTime).toBeGreaterThanOrEqual(before + 15 * 60_000);
    // Run too early (a stray or early run): nothing is charged, still pending.
    const [inv] = await invoicesA(t);
    await t.action(internal.cardOnFile.chargeFee, { invoiceId: inv._id });
    expect(fake.pi).toHaveLength(0);
    expect((await invoicesA(t))[0].autoCharge?.status).toBe("pending");
  });

  it("undoing the no-show inside the window cancels the charge, with no 'send invoice' alert and no client email", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await confirmedStarted(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "confirmed" });
    const [inv] = await invoicesA(t);
    expect(inv.autoCharge).toMatchObject({ status: "skipped", message: expect.stringMatching(/undone/) });
    await runCharge(t, inv._id);
    expect(fake.pi).toHaveLength(0);
    const insights = await t.run((ctx) => ctx.db.query("insights").withIndex("by_org", (q) => q.eq("orgId", ORG_A)).collect());
    expect(insights.some((i) => i.title.includes("Send invoice"))).toBe(false);
    expect(await emails(t, "invoice.auto_charge_failed")).toHaveLength(0);
    expect(await emails(t, "session.no_show_fee")).toHaveLength(0);
  });

  it("a status changed back before the claim (without the undo hook) is skipped silently", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await confirmedStarted(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    await t.run((ctx) => ctx.db.patch(ids.session, { status: "completed" }));
    const [inv] = await invoicesA(t);
    await runCharge(t, inv._id);
    expect(fake.pi).toHaveLength(0);
    expect((await invoicesA(t))[0].autoCharge?.status).toBe("skipped");
    expect(await emails(t, "invoice.auto_charge_failed")).toHaveLength(0);
  });

  it("a session that has not started yet is never auto-charged as a no-show", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await confirmed(t, ids.session); // starts in 2 hours
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    expect(await scheduled(t, "chargeFee")).toHaveLength(0);
    const [inv] = await invoicesA(t);
    expect(inv.status).toBe("draft");
    expect(inv.autoCharge).toBeUndefined();
  });

  it("undoing a no-show after the charge went through raises a refund check for staff", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await confirmedStarted(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const [inv] = await invoicesA(t);
    await runCharge(t, inv._id);
    expect(fake.pi).toHaveLength(1);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "confirmed" });
    const insights = await t.run((ctx) => ctx.db.query("insights").withIndex("by_org", (q) => q.eq("orgId", ORG_A)).collect());
    expect(insights.some((i) => i.title.includes(`Check the no-show fee on invoice ${inv.number}`))).toBe(true);
  });
});

describe("H205-05 / H205-06: a Stripe customer from another connection is never reused", () => {
  async function payDeposit(t: T, session: Id<"sessions">) {
    const text = (await t.query(api.booking.booking, { sessionId: session }))!.cardSave!.text;
    return t.action(api.booking.payViaStripe, { sessionId: session, kind: "deposit", cardConsentText: text });
  }

  it("a customer recorded on a previous connected account is replaced, and its old card cleared", async () => {
    const t = newT();
    const { a, session } = await seed(t, { autoCharge: true });
    await t.run((ctx) => ctx.db.patch(a, { stripeCustomerId: "cus_old", stripeCustomerAccountId: "acct_OLD", defaultPaymentMethodId: "pm_old", cardLast4: "1111" }));
    const res = await payDeposit(t, session);
    expect(res.url).toBeTruthy();
    expect(fake.checkout[0].params.customer).toBe("cus_new_1");
    expect(fake.checkout[0].opts).toEqual({ stripeAccount: "acct_A" });
    const row = await artistRow(t, a);
    expect(row).toMatchObject({ stripeCustomerId: "cus_new_1", stripeCustomerAccountId: "acct_A" });
    expect(row?.defaultPaymentMethodId).toBeUndefined();
    expect(row?.cardLast4).toBeUndefined();
  });

  it("a legacy customer (no account recorded) that Stripe says is missing is replaced; the client can pay", async () => {
    const t = newT();
    const { a, session } = await seed(t, { autoCharge: true });
    fake.missingCustomers.add("cus_A");
    const res = await payDeposit(t, session);
    expect(res.url).toBeTruthy();
    expect(fake.retrieved[0]).toEqual({ id: "cus_A", opts: { stripeAccount: "acct_A" } });
    expect(fake.checkout[0].params.customer).toBe("cus_new_1");
    expect((await artistRow(t, a))?.stripeCustomerId).toBe("cus_new_1");
  });

  it("a legacy customer Stripe finds on this account is kept and its account recorded", async () => {
    const t = newT();
    const { a, session } = await seed(t, { autoCharge: true });
    await payDeposit(t, session);
    expect(fake.customers).toBe(0);
    expect(await artistRow(t, a)).toMatchObject({ stripeCustomerId: "cus_A", stripeCustomerAccountId: "acct_A" });
    // Next time it is trusted without asking Stripe again.
    await payDeposit(t, session);
    expect(fake.retrieved).toHaveLength(1);
  });

  it("if the card-saving checkout is still refused, the client pays without saving the card (so it is never charged)", async () => {
    const t = newT();
    const { a, session } = await seed(t, { autoCharge: true });
    await t.run((ctx) => ctx.db.patch(a, { stripeCustomerId: "cus_gone", stripeCustomerAccountId: "acct_A" }));
    fake.missingCustomers.add("cus_gone");
    const res = await payDeposit(t, session);
    expect(res.url).toBeTruthy();
    expect(fake.checkout).toHaveLength(1);
    expect(fake.checkout[0].params.customer).toBeUndefined();
    expect(fake.checkout[0].params.payment_intent_data).toBeUndefined();
  });

  it("a card saved on another connection is never charged on the current one", () => {
    const base: AutoChargeInput = {
      stripeConfigured: true, switchOn: true, stripeAccountId: "acct_A", chargesEnabled: true,
      stripeCustomerId: "cus_A", stripeCustomerAccountId: "acct_A", defaultPaymentMethodId: "pm_1",
      consent: { text: "x", feePct: 50, windowHours: 24, maxFeeCents: 10_000, agreedAt: 1, paymentMethodId: "pm_1" },
      status: "no_show", feeCents: 10_000, chargeCents: 10_000, paidCents: 0, startTime: 10 * HOUR, now: 11 * HOUR,
    };
    expect(autoChargeDecision(base).charge).toBe(true);
    expect(autoChargeDecision({ ...base, stripeCustomerAccountId: "acct_OLD" }).charge).toBe(false);
    expect(autoChargeDecision({ ...base, stripeCustomerAccountId: undefined }).charge).toBe(false);
  });

  it("the public booking page never returns the fee invoice id", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    const invoiceId = await t.run((ctx) => ctx.db.insert("invoices", {
      orgId: ORG_A, number: "PLS-1", artistId: ids.a, sessionId: ids.session, status: "draft",
      lineItems: [{ label: "fee", amountCents: 1 }], amountCents: 1, dueDate: Date.now(),
    }));
    await t.run((ctx) => ctx.db.patch(ids.session, { noShowFeeInvoiceId: invoiceId }));
    const page = (await t.query(api.booking.booking, { sessionId: ids.session })) as Record<string, unknown>;
    expect(page).not.toHaveProperty("noShowFeeInvoiceId");
    expect(page).not.toHaveProperty("cardConsent");
  });

  it("the card webhook records which account the customer is on", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    expect((await artistRow(t, ids.a))?.stripeCustomerAccountId).toBe("acct_A");
  });

  it("a network error while checking a legacy customer never throws it away", async () => {
    const t = newT();
    const { a } = await seed(t, { autoCharge: true });
    const { ensureCustomer } = await import("./cardOnFile");
    const failing = { runMutation: async () => { throw new Error("should not record"); } } as never;
    const retrieve = vi.fn(async () => { throw new Error("socket hang up"); });
    const lib = await import("./lib/stripe");
    const spy = vi.spyOn(lib, "stripeClient").mockReturnValue({ customers: { retrieve, create: vi.fn() } } as never);
    await expect(ensureCustomer(failing, {
      artistId: a, orgId: ORG_A, name: "Nova", email: null, stripeCustomerId: "cus_A", stripeCustomerAccountId: null, stripeAccountId: "acct_A",
    })).rejects.toThrow(/socket hang up/);
    spy.mockRestore();
  });
});

describe("H205-08 / H205-09: a charge whose action died is checked and never left 'charging'", () => {
  /** Claim the charge (as chargeFee does) and then "die" before any outcome. */
  async function claimThenDie(t: T) {
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await confirmedStarted(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const [inv] = await invoicesA(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.get(inv._id);
      await ctx.db.patch(inv._id, { autoCharge: { ...row!.autoCharge!, at: row!.autoCharge!.at - 16 * 60_000 } });
    });
    const plan = await t.mutation(internal.cardOnFile._claimFeeCharge, { invoiceId: inv._id });
    expect(plan).not.toBeNull();
    expect((await invoicesA(t))[0].autoCharge?.status).toBe("charging");
    const [check] = await scheduled(t, "reconcileFeeCharge");
    expect(check).toBeDefined();
    return { ids, inv, args: check.args[0] as { invoiceId: Id<"invoices">; stripeAccountId: string; stripeCustomerId: string; claimedAt: number } };
  }

  it("the claim schedules a check; with no charge in Stripe the fee falls back to the invoice and staff are told", async () => {
    const t = newT();
    const { inv, args } = await claimThenDie(t);
    expect(args).toMatchObject({ stripeAccountId: "acct_A", stripeCustomerId: "cus_A" });
    await t.action(internal.cardOnFile.reconcileFeeCharge, args);
    expect(fake.listed[0].opts).toEqual({ stripeAccount: "acct_A" });
    expect(fake.pi).toHaveLength(0); // never creates a charge
    const [after] = await invoicesA(t);
    expect(after).toMatchObject({ status: "draft", autoCharge: { status: "failed" } });
    const insights = await t.run((ctx) => ctx.db.query("insights").withIndex("by_org", (q) => q.eq("orgId", ORG_A)).collect());
    expect(insights.some((i) => i.title.includes(`Send invoice ${inv.number}`))).toBe(true);
    expect(await emails(t, "invoice.auto_charge_failed")).toHaveLength(1);
  });

  it("a charge Stripe did make is settled, once; another invoice's charge is ignored", async () => {
    const t = newT();
    const { inv, args } = await claimThenDie(t);
    fake.intents = [
      { id: "pi_other", status: "succeeded", metadata: { kind: "no_show_fee", invoiceId: "some_other_invoice" } },
      { id: "pi_ok", status: "succeeded", metadata: { kind: "no_show_fee", invoiceId: inv._id } },
    ];
    await t.action(internal.cardOnFile.reconcileFeeCharge, args);
    await t.action(internal.cardOnFile.reconcileFeeCharge, args);
    expect((await invoicesA(t))[0]).toMatchObject({ status: "paid", autoCharge: { status: "succeeded", reference: "pi_ok" } });
    expect(await recoveryA(t)).toHaveLength(1);
  });

  it("a Stripe lookup that fails still surfaces the fee to staff", async () => {
    const t = newT();
    const { args } = await claimThenDie(t);
    fake.listFails = true;
    await t.action(internal.cardOnFile.reconcileFeeCharge, args);
    expect((await invoicesA(t))[0].autoCharge).toMatchObject({ status: "failed", message: expect.stringMatching(/check Stripe/) });
  });

  it("does nothing once the action recorded an outcome", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await confirmedStarted(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const [inv] = await invoicesA(t);
    await runCharge(t, inv._id);
    const [check] = await scheduled(t, "reconcileFeeCharge");
    await t.action(internal.cardOnFile.reconcileFeeCharge, check.args[0] as never);
    expect(fake.listed).toHaveLength(0);
    expect((await invoicesA(t))[0].status).toBe("paid");
  });
});

describe("H205-10 / H205-11: a late fee-charge webhook on an invoice settled another way is flagged, not dropped", () => {
  async function failedChargeThenPaidByLink(t: T) {
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await confirmedStarted(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    fake.piMode = "network";
    const [inv] = await invoicesA(t);
    await runCharge(t, inv._id);
    expect((await invoicesA(t))[0].autoCharge?.status).toBe("failed");
    // Staff sent the invoice and the client paid it by link.
    await t.run((ctx) => ctx.db.patch(inv._id, { status: "paid", paidAt: Date.now(), paymentMethod: "zelle" }));
    return { ids, inv };
  }
  const feeEvent = (invoiceId: string, over: Record<string, unknown> = {}) =>
    evt("payment_intent.succeeded", { id: "pi_late", status: "succeeded", amount: 10_000, metadata: { kind: "no_show_fee", invoiceId }, ...over }, "acct_A");
  const checks = (t: T) =>
    t.run(async (ctx) => (await ctx.db.query("insights").withIndex("by_org", (q) => q.eq("orgId", ORG_A)).collect()).filter((i) => i.title.startsWith("Check charge")));

  it("the client paid the invoice, then the card charge's webhook arrives: staff are told to refund", async () => {
    const t = newT();
    const { inv } = await failedChargeThenPaidByLink(t);
    await t.mutation(internal.billingWebhooks.handle, { event: feeEvent(inv._id) });
    const found = await checks(t);
    expect(found).toHaveLength(1);
    expect(found[0].body).toMatch(/Refund the charge in Stripe if the client should not pay twice/);
    expect(await emails(t, "invoice.fee_charge_check")).toHaveLength(1);
    expect((await invoicesA(t))[0].paymentMethod).toBe("zelle");
    expect(await stripeEventTypes(t)).toContain("payment_intent.succeeded.already_settled");
  });

  it("the same webhook replayed is flagged once", async () => {
    const t = newT();
    const { inv } = await failedChargeThenPaidByLink(t);
    const e = feeEvent(inv._id);
    await t.mutation(internal.billingWebhooks.handle, { event: e });
    await t.mutation(internal.billingWebhooks.handle, { event: e });
    expect(await checks(t)).toHaveLength(1);
  });

  it("a charge for a different amount than the invoice is flagged and does not settle it", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await confirmedStarted(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const [inv] = await invoicesA(t);
    await t.mutation(internal.billingWebhooks.handle, { event: feeEvent(inv._id, { amount: 7_777 }) });
    expect((await invoicesA(t))[0].status).toBe("draft");
    expect(await checks(t)).toHaveLength(1);
  });

  it("our own charge's webhook on the invoice it paid raises nothing", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await confirmedStarted(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const [inv] = await invoicesA(t);
    await runCharge(t, inv._id);
    await t.mutation(internal.billingWebhooks.handle, { event: feeEvent(inv._id, { id: "pi_1" }) });
    expect(await checks(t)).toHaveLength(0);
  });
});

/* ── Round 3 re-review items (HIGH-RISK-REREVIEW-2026-11-12) ───────────── */

const insightsA = (t: T) => t.run((ctx) => ctx.db.query("insights").withIndex("by_org", (q) => q.eq("orgId", ORG_A)).collect());

describe("H205-R2-01 / R2-02: a matching reference alone does not make a charge ours", () => {
  const feeEvent = (invoiceId: string, id: string) =>
    evt("payment_intent.succeeded", { id, status: "succeeded", amount: 10_000, metadata: { kind: "no_show_fee", invoiceId } }, "acct_A");

  async function processingCharge(t: T) {
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await confirmedStarted(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    fake.piMode = "processing";
    const [inv] = await invoicesA(t);
    await runCharge(t, inv._id);
    const after = (await invoicesA(t))[0];
    expect(after.autoCharge).toMatchObject({ status: "failed", reference: "pi_1" });
    return { ids, inv };
  }

  it("processing outcome, then the client pays the invoice by link, then the charge succeeds: a 'Check charge' alert is raised", async () => {
    const t = newT();
    const { inv } = await processingCharge(t);
    await t.run((ctx) => ctx.db.patch(inv._id, { status: "paid", paidAt: Date.now(), paymentMethod: "card" }));
    await t.mutation(internal.billingWebhooks.handle, { event: feeEvent(inv._id, "pi_1") });
    const found = (await insightsA(t)).filter((i) => i.title.startsWith("Check charge pi_1"));
    expect(found).toHaveLength(1);
    expect(await emails(t, "invoice.fee_charge_check")).toHaveLength(1);
    expect(await stripeEventTypes(t)).toContain("payment_intent.succeeded.already_settled");
  });

  it("processing outcome, then staff void the invoice, then the charge succeeds: a 'Check charge' alert is raised", async () => {
    const t = newT();
    const { inv } = await processingCharge(t);
    await t.run((ctx) => ctx.db.patch(inv._id, { status: "void" }));
    await t.mutation(internal.billingWebhooks.handle, { event: feeEvent(inv._id, "pi_1") });
    expect((await insightsA(t)).filter((i) => i.title.startsWith("Check charge pi_1"))).toHaveLength(1);
    expect((await invoicesA(t))[0].status).toBe("void");
  });

  it("processing outcome and the invoice still open: the later success settles it, with no alert", async () => {
    const t = newT();
    const { inv } = await processingCharge(t);
    await t.mutation(internal.billingWebhooks.handle, { event: feeEvent(inv._id, "pi_1") });
    expect((await invoicesA(t))[0]).toMatchObject({ status: "paid", autoCharge: { status: "succeeded", reference: "pi_1" } });
    expect((await insightsA(t)).filter((i) => i.title.startsWith("Check charge"))).toHaveLength(0);
  });

  it("a charge outcome reported after the webhook already settled the invoice never asks staff to send it", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await confirmedStarted(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const [inv] = await invoicesA(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.get(inv._id);
      await ctx.db.patch(inv._id, { autoCharge: { ...row!.autoCharge!, at: row!.autoCharge!.at - 16 * 60_000 } });
    });
    await t.mutation(internal.cardOnFile._claimFeeCharge, { invoiceId: inv._id });
    // The webhook settles it while the action is still waiting on Stripe...
    await t.mutation(internal.billingWebhooks.handle, { event: feeEvent(inv._id, "pi_x") });
    // ...and the action then loses the response (network error).
    await t.mutation(internal.cardOnFile._feeChargeOutcome, { invoiceId: inv._id, outcome: "failed", message: "Stripe did not confirm" });
    expect((await invoicesA(t))[0]).toMatchObject({ status: "paid", autoCharge: { status: "succeeded", reference: "pi_x" } });
    expect((await insightsA(t)).some((i) => i.title.includes("Send invoice"))).toBe(false);
    expect(await emails(t, "invoice.auto_charge_failed")).toHaveLength(0);
  });
});


describe("H205-R2-05: money paid on the session's invoices counts as paid", () => {
  it("a completed session paid by invoice, then re-marked a no-show, is not charged again", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true, feePct: 100 });
    await agreeAndSave(t, ids);
    await t.run((ctx) => ctx.db.patch(ids.session, {
      cardConsent: { text: "agreed", feePct: 100, windowHours: 24, maxFeeCents: 20_000, agreedAt: Date.now(), paymentMethodId: "pm_checkout" },
    }));
    await startedConfirmed(t, ids.session, { depositPaid: true, amountPaidCents: 6_000 });
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "completed" });
    const [completion] = await invoicesA(t);
    expect(completion.amountCents).toBe(14_000);
    await t.run((ctx) => ctx.db.patch(completion._id, { status: "paid", paidAt: Date.now(), paymentMethod: "card" }));
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    expect(await scheduled(t, "chargeFee")).toHaveLength(0);
    expect(await invoicesA(t)).toHaveLength(1);
    expect(fake.pi).toHaveLength(0);
  });

  it("partly paid by invoice: only the rest of the fee is charged", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await startedConfirmed(t, ids.session);
    await t.run((ctx) => ctx.db.insert("invoices", {
      orgId: ORG_A, number: "PLS-PART", artistId: ids.a, sessionId: ids.session, status: "paid", paidAt: Date.now(),
      lineItems: [{ label: "Nova - Studio A - balance", amountCents: 3_000 }], amountCents: 3_000, dueDate: Date.now(),
    }));
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const fee = (await invoicesA(t)).find((i) => i.number !== "PLS-PART")!;
    expect(fee.amountCents).toBe(7_000);
    await runCharge(t, fee._id);
    expect(fake.pi[0].params.amount).toBe(7_000);
  });

  it("an unpaid or another session's invoice is not counted", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await startedConfirmed(t, ids.session);
    await t.run(async (ctx) => {
      await ctx.db.insert("invoices", {
        orgId: ORG_A, number: "PLS-OPEN", artistId: ids.a, sessionId: ids.session, status: "sent",
        lineItems: [{ label: "x", amountCents: 5_000 }], amountCents: 5_000, dueDate: Date.now(),
      });
      await ctx.db.insert("invoices", {
        orgId: ORG_A, number: "PLS-OTHER", artistId: ids.a, status: "paid", paidAt: Date.now(),
        lineItems: [{ label: "x", amountCents: 5_000 }], amountCents: 5_000, dueDate: Date.now(),
      });
    });
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const fee = (await invoicesA(t)).find((i) => i.lineItems[0].label.includes("no-show fee"))!;
    expect(fee.amountCents).toBe(10_000);
  });
});

describe("H205-R2-03 / R2-06: a payment made after the no-show is credited before the charge", () => {
  it("a partial payment since the no-show reduces the invoice and the charge to what is still owed, with no 'send invoice' alert", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await startedConfirmed(t, ids.session, { depositPaid: true, amountPaidCents: 6_000 });
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const [inv] = await invoicesA(t);
    expect(inv.amountCents).toBe(4_000);
    // The client pays $15 more within the window.
    await t.run((ctx) => ctx.db.patch(ids.session, { amountPaidCents: 7_500 }));
    await runCharge(t, inv._id);
    expect(fake.pi).toHaveLength(1);
    expect(fake.pi[0].params.amount).toBe(2_500);
    const [after] = await invoicesA(t);
    expect(after).toMatchObject({ status: "paid", amountCents: 2_500, lineItems: [{ amountCents: 2_500 }] });
    expect((await insightsA(t)).some((i) => i.title.includes("Send invoice"))).toBe(false);
    const [mail] = await emails(t, "session.no_show_fee");
    expect(mail.body).toMatch(/We charged the \$25 balance/);
  });

  it("partly covered and the charge then fails: staff are told to send only what is still owed", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await startedConfirmed(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const [inv] = await invoicesA(t);
    await t.run((ctx) => ctx.db.patch(ids.session, { amountPaidCents: 7_000 }));
    fake.piMode = "decline";
    await runCharge(t, inv._id);
    expect((await invoicesA(t))[0].amountCents).toBe(3_000);
    const send = (await insightsA(t)).find((i) => i.title.includes("Send invoice"));
    expect(send?.body).toMatch(/\$30 fee/);
    const [mail] = await emails(t, "session.no_show_fee");
    expect(mail.body).toMatch(/invoice for the \$30 balance/);
  });

  it("an invoice paid for the session since the no-show covers the fee: voided, nothing charged, nobody told", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await startedConfirmed(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const [inv] = await invoicesA(t);
    await t.run((ctx) => ctx.db.insert("invoices", {
      orgId: ORG_A, number: "PLS-BAL", artistId: ids.a, sessionId: ids.session, status: "paid", paidAt: Date.now(),
      lineItems: [{ label: "Nova - Studio A - balance", amountCents: 20_000 }], amountCents: 20_000, dueDate: Date.now(),
    }));
    await runCharge(t, inv._id);
    expect(fake.pi).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(inv._id)))?.status).toBe("void");
    expect((await insightsA(t)).some((i) => i.title.includes("Send invoice"))).toBe(false);
    expect(await emails(t, "session.no_show_fee")).toHaveLength(0);
  });
  it("an invoice staff already sent is never rewritten or voided; staff are told what is still owed", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await startedConfirmed(t, ids.session);
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const [inv] = await invoicesA(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(inv._id, { status: "sent" });
      await ctx.db.patch(ids.session, { amountPaidCents: 20_000 });
    });
    await runCharge(t, inv._id);
    expect(fake.pi).toHaveLength(0);
    expect((await invoicesA(t))[0]).toMatchObject({ status: "sent", amountCents: 10_000, autoCharge: { status: "skipped" } });
    const alert = (await insightsA(t)).find((i) => i.title.includes(inv.number));
    expect(alert?.body).toMatch(/nothing more is owed/);
  });
});



describe("H205-R2-04 / R2-07: undo then re-mark the no-show", () => {
  it("re-marking after an undo schedules a fresh charge on a fresh invoice, and the deposit is counted once", async () => {
    const t = newT();
    const ids = await seed(t, { autoCharge: true });
    await agreeAndSave(t, ids);
    await startedConfirmed(t, ids.session, { depositPaid: true, amountPaidCents: 6_000 });
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "confirmed" });
    const [first] = await invoicesA(t);
    expect(first).toMatchObject({ status: "void", autoCharge: { status: "skipped" } });
    await owner(t).mutation(api.sessions.setStatus, { id: ids.session, status: "no_show" });
    const invs = await invoicesA(t);
    expect(invs).toHaveLength(2);
    const second = invs.find((i) => i._id !== first._id)!;
    expect(second).toMatchObject({ status: "draft", amountCents: 4_000, autoCharge: { status: "pending" } });
    expect((await sessionRow(t, ids.session))?.noShowFeeInvoiceId).toBe(second._id);
    // No "invoice to follow" email while the charge is scheduled.
    expect(await emails(t, "session.no_show_fee")).toHaveLength(0);
    await runCharge(t, first._id);
    await runCharge(t, second._id);
    expect(fake.pi).toHaveLength(1);
    expect(fake.pi[0].params).toMatchObject({ amount: 4_000, metadata: { invoiceId: second._id } });
    const deposits = (await recoveryA(t)).filter((r) => r.kind === "deposit_forfeited");
    expect(deposits).toHaveLength(1);
  });
});

