import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* H6: selling prepaid hours and drawing them down.
   Covers specs/features/truth-prepaid-hours/eval.md U-01..U-09, U-12 and the
   draw-down / put-back rules from the H6 brief: hours come off when a session
   is completed, once, and go back when it is voided or refunded. */

type T = ReturnType<typeof convexTest>;

async function studio(t: T, orgId: string, user: string, tier: "core" | "growth" | "max" = "growth") {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, tier, status: "active", stripeAccountId: `acct_${orgId}` });
    await ctx.db.insert("members", { orgId, name: "Owner", role: "owner", clerkUserId: user, skills: [] });
  });
  return t.withIdentity({ subject: user, name: "Owner", orgId });
}

async function engineer(t: T, orgId: string, user: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { orgId, name: "Eng", role: "engineer", clerkUserId: user, skills: [] });
  });
  return t.withIdentity({ subject: user, name: "Eng", orgId });
}

async function artist(t: T, orgId: string, name = "Nova") {
  return t.run(async (ctx) =>
    ctx.db.insert("artists", {
      orgId, name, type: "artist",
      genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    }),
  );
}

async function product(t: T, orgId: string, hours = 10, priceCents = 100000) {
  return t.run(async (ctx) =>
    ctx.db.insert("packageProducts", { orgId, name: `${hours}h block`, hours, priceCents, active: true }),
  );
}

/** A 2-hour session at $300 (rate), starting in an hour. */
async function session(
  t: T,
  orgId: string,
  artistId: Id<"artists">,
  extra: Partial<{ rateCents: number; depositPaid: boolean; amountPaidCents: number; hours: number; status: "confirmed" | "in_progress" }> = {},
) {
  const start = Date.now() + 3_600_000;
  return t.run(async (ctx) =>
    ctx.db.insert("sessions", {
      orgId, title: "Tracking", artistId, serviceType: "recording",
      startTime: start, endTime: start + (extra.hours ?? 2) * 3_600_000,
      status: extra.status ?? "confirmed", rateCents: extra.rateCents ?? 30000, depositCents: 6000,
      depositPaid: extra.depositPaid ?? false, intakeCompleted: false,
      amountPaidCents: extra.amountPaidCents,
    }),
  );
}

const credits = (t: T) => t.run(async (ctx) => ctx.db.query("packageCredits").collect());
const getSession = (t: T, id: Id<"sessions">) => t.run(async (ctx) => ctx.db.get(id));
const getCredit = (t: T, id: Id<"packageCredits">) => t.run(async (ctx) => ctx.db.get(id));

function pkgEvent(id: string, account: string, meta: Record<string, string>, extra: Record<string, unknown> = {}) {
  return {
    id, type: "checkout.session.completed" as const, account,
    data: { object: { metadata: { kind: "package", ...meta }, payment_intent: `pi_${id}`, payment_status: "paid", ...extra } },
  };
}

async function sell(owner: ReturnType<T["withIdentity"]>, productId: Id<"packageProducts">, artistId: Id<"artists">, saleKey = "sale-key-0001") {
  return owner.mutation(api.packages.recordSale, { productId, artistId, paymentMethod: "cash", saleKey });
}

describe("H6 selling a block - pay link (webhook)", () => {
  let t: T;
  beforeEach(() => { t = convexTest(schema); });

  it("U-01 a paid checkout creates exactly one credit, sized to what was sold", async () => {
    await studio(t, "org_a", "u_a");
    const productId = await product(t, "org_a", 10, 100000);
    const artistId = await artist(t, "org_a");
    await t.mutation(internal.billingWebhooks.handle, {
      event: pkgEvent("evt_1", "acct_org_a", { productId, artistId, orgId: "org_a", hours: "10", priceCents: "100000" }, { amount_total: 100000 }),
    });
    const rows = await credits(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ hoursTotal: 10, hoursRemaining: 10, priceCents: 100000, source: "stripe", status: "active" });
  });

  it("U-01 the credit keeps the hours and price the client was offered when the studio reprices before payment", async () => {
    await studio(t, "org_a", "u_a");
    const productId = await product(t, "org_a", 10, 100000);
    const artistId = await artist(t, "org_a");
    await t.run(async (ctx) => ctx.db.patch(productId, { hours: 5, priceCents: 999999 }));
    await t.mutation(internal.billingWebhooks.handle, {
      event: pkgEvent("evt_2", "acct_org_a", { productId, artistId, orgId: "org_a", hours: "10", priceCents: "100000" }, { amount_total: 100000 }),
    });
    const [c] = await credits(t);
    expect(c).toMatchObject({ hoursTotal: 10, priceCents: 100000 });
  });

  it("U-02 a replayed webhook, or the same payment under a new event id, creates no second credit", async () => {
    await studio(t, "org_a", "u_a");
    const productId = await product(t, "org_a");
    const artistId = await artist(t, "org_a");
    const meta = { productId, artistId, orgId: "org_a" };
    await t.mutation(internal.billingWebhooks.handle, { event: pkgEvent("evt_r", "acct_org_a", meta) });
    await t.mutation(internal.billingWebhooks.handle, { event: pkgEvent("evt_r", "acct_org_a", meta) });
    await t.mutation(internal.billingWebhooks.handle, {
      event: { ...pkgEvent("evt_r2", "acct_org_a", meta), data: { object: { metadata: { kind: "package", ...meta }, payment_intent: "pi_evt_r", payment_status: "paid" } } },
    });
    expect(await credits(t)).toHaveLength(1);
    expect(await t.run(async (ctx) => ctx.db.query("revenueEntries").collect())).toHaveLength(1);
  });

  it("U-03 a webhook from another studio's connected account creates nothing", async () => {
    await studio(t, "org_a", "u_a");
    await studio(t, "org_b", "u_b");
    const productId = await product(t, "org_a");
    const artistId = await artist(t, "org_a");
    await t.mutation(internal.billingWebhooks.handle, {
      event: pkgEvent("evt_x", "acct_org_b", { productId, artistId, orgId: "org_a" }),
    });
    expect(await credits(t)).toHaveLength(0);
    const ledger = await t.run(async (ctx) => ctx.db.query("stripeEvents").collect());
    expect(ledger.some((r) => String((r as { type?: string }).type).endsWith(".account_mismatch"))).toBe(true);
  });

  it("U-03 metadata mixing studios (org A account, org B client) creates nothing", async () => {
    await studio(t, "org_a", "u_a");
    await studio(t, "org_b", "u_b");
    const productId = await product(t, "org_a");
    const artistB = await artist(t, "org_b");
    await t.mutation(internal.billingWebhooks.handle, {
      event: pkgEvent("evt_mix", "acct_org_a", { productId, artistId: artistB, orgId: "org_a" }),
    });
    expect(await credits(t)).toHaveLength(0);
  });

  it("U-11 (webhook level) an unpaid or expired checkout creates nothing", async () => {
    await studio(t, "org_a", "u_a");
    const productId = await product(t, "org_a");
    const artistId = await artist(t, "org_a");
    const meta = { productId, artistId, orgId: "org_a" };
    await t.mutation(internal.billingWebhooks.handle, { event: pkgEvent("evt_u", "acct_org_a", meta, { payment_status: "unpaid" }) });
    await t.mutation(internal.billingWebhooks.handle, {
      event: { ...pkgEvent("evt_e", "acct_org_a", meta), type: "checkout.session.expired" },
    });
    expect(await credits(t)).toHaveLength(0);
  });

  it("U-04 a pay link for another studio's package or client is refused", async () => {
    const a = await studio(t, "org_a", "u_a");
    await studio(t, "org_b", "u_b");
    const productA = await product(t, "org_a");
    const artistA = await artist(t, "org_a");
    const productB = await product(t, "org_b");
    const artistB = await artist(t, "org_b");
    await expect(a.action(api.packages.purchaseCheckout, { productId: productB, artistId: artistA })).rejects.toThrow(/not found/);
    await expect(a.action(api.packages.purchaseCheckout, { productId: productA, artistId: artistB })).rejects.toThrow(/not found/);
    // Own studio, Stripe not configured in tests: no link, no error, no credit.
    expect(await a.action(api.packages.purchaseCheckout, { productId: productA, artistId: artistA })).toEqual({ url: null });
    expect(await credits(t)).toHaveLength(0);
  });
});

describe("H6 selling a block - recorded in person", () => {
  let t: T;
  beforeEach(() => { t = convexTest(schema); });

  it("U-05 records one credit with who recorded it and how the client paid", async () => {
    const owner = await studio(t, "org_a", "u_a");
    const productId = await product(t, "org_a", 10, 85000);
    const artistId = await artist(t, "org_a");
    const res = await owner.mutation(api.packages.recordSale, {
      productId, artistId, paymentMethod: "card_in_person", note: "Paid at the desk", saleKey: "sale-key-0005",
    });
    expect(res.duplicate).toBe(false);
    const [c] = await credits(t);
    expect(c).toMatchObject({ source: "manual", paymentMethod: "card_in_person", recordedByName: "Owner", hoursRemaining: 10, priceCents: 85000, note: "Paid at the desk" });
    expect(c.recordedBy).toBeDefined();
    const rev = await t.run(async (ctx) => ctx.db.query("revenueEntries").collect());
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({ provider: "manual", amountCents: 85000, sourceType: "package" });
    const sold = await owner.query(api.packages.soldCredits, {});
    expect(sold[0]).toMatchObject({ source: "manual", recordedByName: "Owner", paymentMethod: "card_in_person" });
  });

  it("U-06 a double click (same sale key) records once", async () => {
    const owner = await studio(t, "org_a", "u_a");
    const productId = await product(t, "org_a");
    const artistId = await artist(t, "org_a");
    const [r1, r2] = await Promise.all([sell(owner, productId, artistId), sell(owner, productId, artistId)]);
    const r3 = await sell(owner, productId, artistId);
    expect(r1.creditId).toBe(r2.creditId);
    expect(r3).toMatchObject({ creditId: r1.creditId, duplicate: true });
    expect(await credits(t)).toHaveLength(1);
    expect(await t.run(async (ctx) => ctx.db.query("revenueEntries").collect())).toHaveLength(1);
  });

  it("a reused sale key for a different client is refused, not silently matched", async () => {
    const owner = await studio(t, "org_a", "u_a");
    const productId = await product(t, "org_a");
    const a1 = await artist(t, "org_a", "Nova");
    const a2 = await artist(t, "org_a", "Kilo");
    await sell(owner, productId, a1);
    await expect(sell(owner, productId, a2)).rejects.toThrow();
    expect(await credits(t)).toHaveLength(1);
  });

  it("U-07 a member without the finance role cannot record a sale", async () => {
    await studio(t, "org_a", "u_a");
    const eng = await engineer(t, "org_a", "u_e");
    const productId = await product(t, "org_a");
    const artistId = await artist(t, "org_a");
    await expect(sell(eng, productId, artistId)).rejects.toThrow(/lacks invoices.send/);
    await expect(eng.action(api.packages.purchaseCheckout, { productId, artistId })).rejects.toThrow();
    expect(await credits(t)).toHaveLength(0);
  });

  it("U-04/U-05 another studio's package or client is refused", async () => {
    const a = await studio(t, "org_a", "u_a");
    await studio(t, "org_b", "u_b");
    const productB = await product(t, "org_b");
    const artistB = await artist(t, "org_b");
    const productA = await product(t, "org_a");
    const artistA = await artist(t, "org_a");
    await expect(sell(a, productB, artistA)).rejects.toThrow(/Package not found/);
    await expect(sell(a, productA, artistB, "sale-key-0002")).rejects.toThrow(/Client not found/);
    expect(await credits(t)).toHaveLength(0);
  });

  it("a hidden package cannot be sold; bad sale keys are refused", async () => {
    const owner = await studio(t, "org_a", "u_a");
    const productId = await product(t, "org_a");
    const artistId = await artist(t, "org_a");
    await expect(sell(owner, productId, artistId, "short")).rejects.toThrow();
    await t.run(async (ctx) => ctx.db.patch(productId, { active: false }));
    await expect(sell(owner, productId, artistId)).rejects.toThrow(/hidden/);
    expect(await credits(t)).toHaveLength(0);
  });
});

describe("H6 signed-out callers and the plan gate", () => {
  let t: T;
  let prev: string | undefined;
  beforeEach(() => {
    t = convexTest(schema);
    prev = process.env.CLERK_JWT_ISSUER_DOMAIN;
    process.env.CLERK_JWT_ISSUER_DOMAIN = "https://clerk.example";
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.CLERK_JWT_ISSUER_DOMAIN;
    else process.env.CLERK_JWT_ISSUER_DOMAIN = prev;
  });

  it("U-08 a signed-out caller cannot sell, record, draw or return", async () => {
    await studio(t, "org_a", "u_a");
    const productId = await product(t, "org_a");
    const artistId = await artist(t, "org_a");
    const sessionId = await session(t, "org_a", artistId);
    await expect(t.mutation(api.packages.recordSale, { productId, artistId, paymentMethod: "cash", saleKey: "sale-key-0008" })).rejects.toThrow(/Sign in/);
    await expect(t.action(api.packages.purchaseCheckout, { productId, artistId })).rejects.toThrow(/Sign in/);
    await expect(t.mutation(api.packages.returnHours, { sessionId })).rejects.toThrow(/Sign in/);
    await expect(t.query(api.packages.balanceForArtist, { artistId })).rejects.toThrow(/Sign in/);
    expect(await credits(t)).toHaveLength(0);
  });

  it("U-09 a Core studio is refused selling with UPGRADE_REQUIRED", async () => {
    const owner = await studio(t, "org_c", "u_c", "core");
    const productId = await product(t, "org_c");
    const artistId = await artist(t, "org_c");
    const upgrade = (p: Promise<unknown>) => p.then(
      () => { throw new Error("expected UPGRADE_REQUIRED"); },
      (err: { data?: { code?: string } }) => expect(err.data?.code).toBe("UPGRADE_REQUIRED"),
    );
    await upgrade(sell(owner, productId, artistId));
    await upgrade(owner.mutation(api.packages.create, { name: "X", hours: 5, priceCents: 5000 }));
    await upgrade(owner.query(api.packages.list, {}));
    await upgrade(owner.action(api.packages.purchaseCheckout, { productId, artistId }));
    expect(await owner.query(api.packages.listActivePublic, { slug: "org_c" })).toEqual([]);
    expect(await credits(t)).toHaveLength(0);
  });

  it("a Core studio can still use hours a client already bought (never trapped by a downgrade)", async () => {
    const owner = await studio(t, "org_c", "u_c", "core");
    const productId = await product(t, "org_c", 10, 100000);
    const artistId = await artist(t, "org_c");
    await t.mutation(internal.packages._applyPurchase, { orgId: "org_c", productId, artistId });
    const [credit] = await credits(t);
    const sessionId = await session(t, "org_c", artistId);
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId: credit._id });
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    expect((await getCredit(t, credit._id))?.hoursRemaining).toBe(8);
    const bal = await owner.query(api.packages.balanceForArtist, { artistId });
    expect(bal).toMatchObject({ hoursRemaining: 8, canSell: false });
  });
});

describe("H6 drawing hours down on completion", () => {
  let t: T;
  let owner: ReturnType<T["withIdentity"]>;
  let artistId: Id<"artists">;
  let creditId: Id<"packageCredits">;
  beforeEach(async () => {
    t = convexTest(schema);
    owner = await studio(t, "org_a", "u_a");
    const productId = await product(t, "org_a", 10, 100000); // $100/h
    artistId = await artist(t, "org_a");
    creditId = (await sell(owner, productId, artistId)).creditId;
  });

  it("nothing comes off when the block is chosen; the session's hours come off once when completed", async () => {
    const sessionId = await session(t, "org_a", artistId, { rateCents: 30000, hours: 2 });
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(10);
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(8);
    // Round 2 (H207-06/H207-10): one prepaid hour pays one session hour at the
    // session's price, whatever the block cost. Before, this asserted 10000
    // left and a $100 balance invoice for hours the client had prepaid.
    expect((await getSession(t, sessionId))?.rateCents).toBe(0);
    // Completing again (a re-set) takes nothing more.
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(8);
    const view = await owner.query(api.packages.forSession, { sessionId });
    expect(view?.draws).toHaveLength(1);
    expect(view?.draws[0]).toMatchObject({ hours: 2, valueCents: 30000, kind: "completion", status: "applied" });
    // Nothing is left to bill.
    expect(await t.run(async (ctx) => ctx.db.query("invoices").collect())).toHaveLength(0);
  });

  it("a session fully covered by the block gets no balance invoice; the engineer's percentage uses the full price", async () => {
    const sessionId = await session(t, "org_a", artistId, { rateCents: 20000, hours: 2 });
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    expect((await getSession(t, sessionId))?.rateCents).toBe(0);
    expect(await t.run(async (ctx) => ctx.db.query("invoices").collect())).toHaveLength(0);
    const a = await t.run(async (ctx) => ctx.db.get(artistId));
    expect(a?.lifetimeValueCents).toBe(20000);
  });

  it("never takes more hours than the session still owes (deposit already paid)", async () => {
    // $300 session, $250 already paid: only $50 = 0.5h may come off.
    const sessionId = await session(t, "org_a", artistId, { rateCents: 30000, hours: 3, amountPaidCents: 25000 });
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(9.5);
  });

  it("a fully paid session costs the client no hours", async () => {
    const sessionId = await session(t, "org_a", artistId, { rateCents: 30000, amountPaidCents: 30000 });
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(10);
  });

  it("never overdraws the block and marks it used up", async () => {
    const sessionId = await session(t, "org_a", artistId, { rateCents: 200000, hours: 12 });
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    const c = await getCredit(t, creditId);
    expect(c).toMatchObject({ hoursRemaining: 0, status: "depleted" });
    // 10 of 12 hours at the session's own $166.67/h; only the last 2h are
    // billed (was 100000, valued at the block's $100/h: H207-06).
    expect((await getSession(t, sessionId))?.rateCents).toBe(33333);
    const [inv] = await t.run(async (ctx) => ctx.db.query("invoices").collect());
    expect(inv.amountCents).toBe(33333);
  });

  it("hours applied by hand before completion are not taken twice", async () => {
    const sessionId = await session(t, "org_a", artistId, { rateCents: 30000, hours: 2 });
    await owner.mutation(api.packages.redeem, { sessionId, creditId, hours: 1 });
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(8);
  });

  it("H207-03 the automation cron never takes hours off: it leaves the session open and asks staff once", async () => {
    // Round 2 owner decision: hours come off only when staff complete the
    // session. This test used to assert that both cron paths drew hours.
    // Public booking, in progress, past its end: the cron's progression step.
    const start = Date.now() - 3 * 3_600_000;
    const live = await t.run(async (ctx) =>
      ctx.db.insert("sessions", {
        orgId: "org_a", title: "Public", artistId, serviceType: "recording", source: "public_booking",
        startTime: start, endTime: start + 2 * 3_600_000, status: "in_progress",
        rateCents: 30000, depositCents: 0, depositPaid: false, intakeCompleted: true,
        packageCreditId: creditId,
      }),
    );
    // Sessions never closed out, ended over a day ago: stale resolution. One
    // in progress, one confirmed with a deposit paid, one confirmed with none.
    const old = Date.now() - 3 * 86_400_000;
    const stale = (status: "in_progress" | "confirmed", depositPaid: boolean) =>
      t.run(async (ctx) =>
        ctx.db.insert("sessions", {
          orgId: "org_a", title: `Stale ${status} ${depositPaid}`, artistId, serviceType: "recording",
          startTime: old, endTime: old + 3_600_000, status,
          rateCents: 30000, depositCents: 6000, depositPaid, amountPaidCents: depositPaid ? 6000 : undefined,
          intakeCompleted: true, packageCreditId: creditId,
        }),
      );
    const s1 = await stale("in_progress", false);
    const s2 = await stale("confirmed", true);
    const s3 = await stale("confirmed", false);
    await t.mutation(internal.automation.tick, {});
    await t.mutation(internal.automation.tick, {});
    expect((await getSession(t, live))?.status).toBe("in_progress");
    expect((await getSession(t, s1))?.status).toBe("in_progress");
    expect((await getSession(t, s2))?.status).toBe("confirmed");
    expect((await getSession(t, s3))?.status).toBe("confirmed"); // not auto_no_show
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(10);
    expect((await getSession(t, live))?.rateCents).toBe(30000);
    const asks = await t.run(async (ctx) => ctx.db.query("activity").collect());
    expect(asks.filter((a) => a.kind === "session.package.close_needed")).toHaveLength(4); // once each
    // Staff complete one: now the hours come off.
    await owner.mutation(api.sessions.setStatus, { id: s2, status: "completed" });
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(9.2); // 0.8h: $60 of $300 for 1h was paid in cash
  });

  it("voiding a completed session (completed -> cancelled) puts the hours back, once", async () => {
    const sessionId = await session(t, "org_a", artistId, { rateCents: 30000, hours: 2 });
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "cancelled" });
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(10);
    // Round 2 (H207-08): putting hours back never raises the price by itself.
    // This asserted 30000 before; a cancelled session now keeps its price.
    expect((await getSession(t, sessionId))?.rateCents).toBe(0);
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "cancelled" });
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(10);
    const view = await owner.query(api.packages.forSession, { sessionId });
    expect(view?.draws[0]).toMatchObject({ status: "returned", returnReason: "voided" });
  });

  it("refunding puts the hours back once and a later re-completion does not take them again", async () => {
    const sessionId = await session(t, "org_a", artistId, { rateCents: 30000, hours: 2 });
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    const r1 = await owner.mutation(api.packages.returnHours, { sessionId });
    const r2 = await owner.mutation(api.packages.returnHours, { sessionId });
    expect(r1.hoursReturned).toBe(2);
    expect(r2.hoursReturned).toBe(0);
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(10);
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(10);
  });

  it("a depleted block comes back to active when hours are put back", async () => {
    const sessionId = await session(t, "org_a", artistId, { rateCents: 200000, hours: 10 });
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    expect((await getCredit(t, creditId))?.status).toBe("depleted");
    await owner.mutation(api.packages.returnHours, { sessionId });
    expect(await getCredit(t, creditId)).toMatchObject({ status: "active", hoursRemaining: 10 });
  });

  it("only the finance role can refund hours; the engineer cannot", async () => {
    const eng = await engineer(t, "org_a", "u_e");
    const sessionId = await session(t, "org_a", artistId);
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    await expect(eng.mutation(api.packages.returnHours, { sessionId })).rejects.toThrow(/lacks invoices.send/);
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(8);
  });

  it("another studio cannot choose, read or refund against this studio's block or session", async () => {
    const b = await studio(t, "org_b", "u_b");
    const artistB = await artist(t, "org_b");
    const sessionB = await session(t, "org_b", artistB);
    const sessionA = await session(t, "org_a", artistId);
    await expect(b.mutation(api.packages.chooseForSession, { sessionId: sessionB, creditId })).rejects.toThrow(/Credit not found/);
    await expect(b.mutation(api.packages.chooseForSession, { sessionId: sessionA, creditId })).rejects.toThrow(/Session not found/);
    await expect(b.mutation(api.packages.returnHours, { sessionId: sessionA })).rejects.toThrow(/Session not found/);
    expect(await b.query(api.packages.forSession, { sessionId: sessionA })).toBeNull();
    expect(await b.query(api.packages.balanceForArtist, { artistId })).toBeNull();
  });

  it("a block for a different client, an empty block or a closed session cannot be chosen", async () => {
    const other = await artist(t, "org_a", "Kilo");
    const otherSession = await session(t, "org_a", other);
    await expect(owner.mutation(api.packages.chooseForSession, { sessionId: otherSession, creditId })).rejects.toThrow(/different client/);
    const done = await session(t, "org_a", artistId);
    await owner.mutation(api.sessions.setStatus, { id: done, status: "completed" });
    await expect(owner.mutation(api.packages.chooseForSession, { sessionId: done, creditId })).rejects.toThrow(/closed/);
    await t.run(async (ctx) => ctx.db.patch(creditId, { hoursRemaining: 0, status: "depleted" }));
    const fresh = await session(t, "org_a", artistId);
    await expect(owner.mutation(api.packages.chooseForSession, { sessionId: fresh, creditId })).rejects.toThrow(/no hours left/);
  });

  it("a block emptied after it was chosen: completion takes nothing and tells staff", async () => {
    const sessionId = await session(t, "org_a", artistId);
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await t.run(async (ctx) => ctx.db.patch(creditId, { hoursRemaining: 0, status: "depleted" }));
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    expect((await getSession(t, sessionId))?.rateCents).toBe(30000);
    const acts = await t.run(async (ctx) => ctx.db.query("activity").collect());
    expect(acts.some((a) => a.kind === "session.package.skipped")).toBe(true);
  });

  it("U-12 redeeming the new credit by hand takes hours off it", async () => {
    const sessionId = await session(t, "org_a", artistId, { rateCents: 30000 });
    const res = await owner.mutation(api.packages.redeem, { sessionId, creditId, hours: 2 });
    expect(res).toMatchObject({ hoursApplied: 2, hoursRemaining: 8, valueCents: 20000 });
  });
});

describe("H6 what the client and staff can see", () => {
  it("staff see the balance on the client profile; the floor sees no prices", async () => {
    const t = convexTest(schema);
    const owner = await studio(t, "org_a", "u_a");
    const eng = await engineer(t, "org_a", "u_e");
    const productId = await product(t, "org_a", 10, 100000);
    const artistId = await artist(t, "org_a");
    await sell(owner, productId, artistId);
    const bal = await owner.query(api.packages.balanceForArtist, { artistId });
    expect(bal).toMatchObject({ hoursRemaining: 10, canSell: true });
    expect(bal?.credits[0].priceCents).toBe(100000);
    const engBal = await eng.query(api.packages.balanceForArtist, { artistId });
    expect(engBal?.hoursRemaining).toBe(10);
    expect(engBal?.credits[0].priceCents).toBeNull();
  });

  it("the client portal shows the hours left, and only this client's", async () => {
    const t = convexTest(schema);
    const owner = await studio(t, "org_a", "u_a");
    const productId = await product(t, "org_a", 10, 100000);
    const artistId = await artist(t, "org_a", "Nova");
    const otherId = await artist(t, "org_a", "Kilo");
    await sell(owner, productId, artistId);
    await sell(owner, productId, otherId, "sale-key-other");
    await t.run(async (ctx) => {
      await ctx.db.insert("collaboratorGrants", {
        orgId: "org_a", email: "nova@example.com", name: "Nova", scope: "artist_portal", entityId: artistId,
        capabilities: [], token: "tok_portal", expiresAt: Date.now() + 86_400_000, revoked: false,
        invitedBy: "u_a", useCount: 0,
      });
    });
    const sum = await t.query(api.portal.summary, { token: "tok_portal" });
    expect(sum?.prepaidHours).toEqual([{ name: "10h block", hoursTotal: 10, hoursRemaining: 10 }]);
  });
});

describe("Round 2: a session paid from prepaid hours is paid (H207-01, H207-02, H207-07)", () => {
  let t: T;
  let owner: ReturnType<T["withIdentity"]>;
  let artistId: Id<"artists">;
  let creditId: Id<"packageCredits">;
  beforeEach(async () => {
    t = convexTest(schema);
    owner = await studio(t, "org_a", "u_a");
    const productId = await product(t, "org_a", 10, 100000); // $100/h block
    artistId = await artist(t, "org_a");
    await t.run(async (ctx) => ctx.db.patch(artistId, { email: "nova@example.com", phone: "+15555550123" }));
    creditId = (await sell(owner, productId, artistId)).creditId;
  });

  /** Public booking, $300 for 2h, $60 deposit paid, starting `inMs` from now. */
  async function publicBooking(inMs: number) {
    const start = Date.now() + inMs;
    return t.run(async (ctx) =>
      ctx.db.insert("sessions", {
        orgId: "org_a", title: "Public", artistId, serviceType: "recording", source: "public_booking",
        startTime: start, endTime: start + 2 * 3_600_000, status: "confirmed",
        rateCents: 30000, depositCents: 6000, depositPaid: true, amountPaidCents: 6000, intakeCompleted: true,
      }),
    );
  }
  const notes = (id: Id<"sessions">) =>
    t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.sessionId === id));

  it("the cron sends no balance-due email or text inside the reminder window", async () => {
    const sessionId = await publicBooking(3 * 3_600_000);
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await t.mutation(internal.automation.tick, {});
    expect((await notes(sessionId)).filter((n) => n.kind === "booking.balance_reminder")).toHaveLength(0);
    expect((await getSession(t, sessionId))?.balanceRemindedAt).toBeUndefined();
  });

  it("control: without the block the same booking is chased (the test can see a reminder)", async () => {
    const sessionId = await publicBooking(3 * 3_600_000);
    await t.mutation(internal.automation.tick, {});
    expect((await notes(sessionId)).some((n) => n.kind === "booking.balance_reminder")).toBe(true);
  });

  it("the cron does not forfeit the booking 2h before start or keep the deposit", async () => {
    const sessionId = await publicBooking(90 * 60_000);
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await t.mutation(internal.automation.tick, {});
    expect((await getSession(t, sessionId))?.status).toBe("confirmed");
    expect((await notes(sessionId)).some((n) => n.kind === "booking.forfeited")).toBe(false);
  });

  it("a block that covers only part of the session: the rest is still chased, for the rest only", async () => {
    await t.run(async (ctx) => ctx.db.patch(creditId, { hoursRemaining: 1 }));
    const sessionId = await publicBooking(3 * 3_600_000);
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await t.mutation(internal.automation.tick, {});
    const [reminder] = (await notes(sessionId)).filter((n) => n.kind === "booking.balance_reminder" && n.channel === "email");
    // $300 - $60 deposit - 1h x $150 = $90.
    expect(reminder.body).toContain("$90");
  });

  it("an unpaid public hold paid from hours is not released or nudged by the cron", async () => {
    const start = Date.now() + 86_400_000;
    const sessionId = await t.run(async (ctx) =>
      ctx.db.insert("sessions", {
        orgId: "org_a", title: "Hold", artistId, serviceType: "recording", source: "public_booking",
        startTime: start, endTime: start + 2 * 3_600_000, status: "tentative", holdExpiresAt: Date.now() - 60_000,
        rateCents: 30000, depositCents: 6000, depositPaid: false, intakeCompleted: false,
      }),
    );
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await t.mutation(internal.automation.tick, {});
    expect((await getSession(t, sessionId))?.status).toBe("tentative");
  });

  it("an internal booking fully paid from hours gets no deposit pay link", async () => {
    const sessionId = await session(t, "org_a", artistId, { rateCents: 30000, hours: 2 });
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await t.mutation(internal.automation.tick, {});
    expect((await notes(sessionId)).some((n) => n.kind === "booking.deposit_link")).toBe(false);
  });

  it("the session sheet, pay link and public checkout show nothing owed", async () => {
    const sessionId = await publicBooking(3 * 3_600_000);
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    const detail = await owner.query(api.sessions.get, { id: sessionId });
    expect(detail?.prepaidCoverCents).toBe(24000);
    expect((await owner.query(api.sessions.payLink, { id: sessionId }))?.balanceCents).toBe(0);
    await expect(owner.mutation(api.sessions.sendPayLinkSms, { id: sessionId })).rejects.toThrow(/Nothing is owed/);
    const pub = await t.query(api.booking.booking, { sessionId });
    expect(pub).toMatchObject({ balanceCents: 0, fullyPaid: true });
    // The public page does not get the studio's internal block id.
    expect(pub && "packageCreditId" in pub).toBe(false);
    const charge = await t.query(internal.booking._chargeContext, { sessionId });
    expect(charge?.balanceCents).toBe(0);
    // Nothing comes off until staff complete it: 1.6h (the deposit paid 0.4h).
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(10);
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(8.4);
    expect((await getSession(t, sessionId))?.rateCents).toBe(6000);
    expect(await t.run(async (ctx) => ctx.db.query("invoices").collect())).toHaveLength(0);
  });

  it("a block chosen for two sessions never covers the same hour twice", async () => {
    await t.run(async (ctx) => ctx.db.patch(creditId, { hoursRemaining: 3 }));
    const first = await session(t, "org_a", artistId, { rateCents: 30000, hours: 2 });
    const second = await t.run(async (ctx) => {
      const s = await ctx.db.get(first);
      return ctx.db.insert("sessions", { ...s!, _id: undefined, _creationTime: undefined, startTime: s!.startTime + 86_400_000, endTime: s!.endTime + 86_400_000 } as never);
    });
    await owner.mutation(api.packages.chooseForSession, { sessionId: first, creditId });
    await owner.mutation(api.packages.chooseForSession, { sessionId: second, creditId });
    expect((await owner.query(api.sessions.get, { id: first }))?.prepaidCoverCents).toBe(30000);
    expect((await owner.query(api.sessions.get, { id: second }))?.prepaidCoverCents).toBe(15000);
    expect((await owner.query(api.sessions.payLink, { id: second }))?.balanceCents).toBe(15000);
  });

  it("H207-07 a session invoiced and paid up front takes no hours on completion, and staff are told", async () => {
    const sessionId = await session(t, "org_a", artistId, { rateCents: 30000, hours: 2 });
    await t.run(async (ctx) =>
      ctx.db.insert("invoices", {
        orgId: "org_a", artistId, sessionId, number: "PLS-1", status: "paid", amountCents: 30000,
        dueDate: Date.now(), lineItems: [{ label: "Tracking", amountCents: 30000 }],
      }),
    );
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(10);
    const acts = await t.run(async (ctx) => ctx.db.query("activity").collect());
    expect(acts.some((a) => a.kind === "session.package.skipped" && /already invoiced/.test(a.summary))).toBe(true);
  });

  it("H207-07 an invoice for part of the session is subtracted before hours are drawn", async () => {
    const sessionId = await session(t, "org_a", artistId, { rateCents: 30000, hours: 2 });
    await t.run(async (ctx) =>
      ctx.db.insert("invoices", {
        orgId: "org_a", artistId, sessionId, number: "PLS-2", status: "sent", amountCents: 15000,
        dueDate: Date.now(), lineItems: [{ label: "Half up front", amountCents: 15000 }],
      }),
    );
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(9);
  });
});

describe("Round 2: putting hours back never creates a cash debt (H207-08, H207-11)", () => {
  let t: T;
  let owner: ReturnType<T["withIdentity"]>;
  let artistId: Id<"artists">;
  let creditId: Id<"packageCredits">;
  beforeEach(async () => {
    t = convexTest(schema);
    owner = await studio(t, "org_a", "u_a");
    const productId = await product(t, "org_a", 10, 100000);
    artistId = await artist(t, "org_a");
    creditId = (await sell(owner, productId, artistId)).creditId;
  });

  it("a refund gives the hours back and leaves nothing due, no pay link and no invoice", async () => {
    const sessionId = await session(t, "org_a", artistId, { rateCents: 20000, hours: 2 });
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    expect((await getSession(t, sessionId))?.rateCents).toBe(0);
    await owner.mutation(api.packages.returnHours, { sessionId });
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(10);
    expect((await getSession(t, sessionId))?.rateCents).toBe(0);
    expect((await owner.query(api.sessions.payLink, { id: sessionId }))?.balanceCents).toBe(0);
    // Re-setting it to completed bills nothing and takes nothing.
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    expect(await t.run(async (ctx) => ctx.db.query("invoices").collect())).toHaveLength(0);
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(10);
  });

  it("a voided session completed again is priced in full and drawn again, once", async () => {
    const sessionId = await session(t, "org_a", artistId, { rateCents: 30000, hours: 2 });
    await owner.mutation(api.packages.chooseForSession, { sessionId, creditId });
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "cancelled" });
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(10);
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(8);
    expect((await getSession(t, sessionId))?.rateCents).toBe(0);
    expect(await t.run(async (ctx) => ctx.db.query("invoices").collect())).toHaveLength(0);
  });

  it("taking back hours applied by hand to an upcoming session restores its price (undo)", async () => {
    const sessionId = await session(t, "org_a", artistId, { rateCents: 30000, hours: 2 });
    await owner.mutation(api.packages.redeem, { sessionId, creditId, hours: 1 });
    const cut = (await getSession(t, sessionId))!.rateCents;
    expect(cut).toBeLessThan(30000);
    await owner.mutation(api.packages.returnHours, { sessionId });
    expect((await getSession(t, sessionId))?.rateCents).toBe(30000);
    expect((await getCredit(t, creditId))?.hoursRemaining).toBe(10);
  });
});
