import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { onBalanceSettled, owedOnBooking, payTargetFor, type PayTarget } from "./sessionDelivery";
import { checkoutChargeCents, type CheckoutKind } from "./lib/checkout";
import { checkoutView } from "@/lib/checkout-view";
import { r2Env, setupStudios, uploadSessionFile, clientEmails, cardsOn, APP_URL } from "./testing/sessionDelivery.fixture";

/* Session delivery, plan Addendum 3: the Pay button is offered only when the
   amount its target will charge is exactly the amount owed (G-21, G-22, G-23,
   R3-01 to R3-04).

   Every charge below comes from the code that really charges, never from a
   number written in the test:
     checkout  booking.booking (what the checkout page reads), checkoutView
               (src/lib/checkout-view.ts, the page's own choice of deposit or
               full) and booking._chargeContext + checkoutChargeCents (what
               booking.payViaStripe sends to Stripe); then the Stripe webhook's
               real handler settles it through settlePayment.
     invoice   invoicePay._chargeContext (what invoicePay.payViaStripe sends to
               Stripe); then the webhook settles it through settleInvoice. */

type S = Awaited<ReturnType<typeof setupStudios>>;

async function setup(patch: Partial<Doc<"sessions">> = {}): Promise<S> {
  const s = await setupStudios();
  await cardsOn(s.t);
  if (Object.keys(patch).length) await s.t.run(async (ctx) => { await ctx.db.patch(s.A.sessionId, patch); });
  return s;
}

async function finalFile(s: S) {
  const f = await uploadSessionFile(s.t, s.as(s.A.engineer), s.A.sessionId, "Lead vocal.wav");
  await s.as(s.A.engineer).mutation(api.sessionDelivery.setFinal, { assetId: f.assetId, final: true });
}

async function ready(s: S): Promise<string> {
  await finalFile(s);
  await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
  return (await row(s)).token;
}

async function row(s: S) {
  return (await s.t.run(async (ctx) =>
    await ctx.db.query("sessionDeliveries").withIndex("by_session", (q) => q.eq("sessionId", s.A.sessionId)).first()))!;
}

let invoiceNo = 0;
async function invoice(s: S, status: Doc<"invoices">["status"], amountCents: number): Promise<Id<"invoices">> {
  invoiceNo++;
  return await s.t.run(async (ctx) => await ctx.db.insert("invoices", {
    orgId: "studio_a", number: `PLS-${700000 + invoiceNo}`, artistId: s.A.artistId, sessionId: s.A.sessionId, status,
    lineItems: [{ label: "Vocal tracking - balance", amountCents }], amountCents,
    dueDate: Date.now() + 14 * 86_400_000, ...(status === "paid" ? { paidAt: Date.now(), paymentMethod: "cash" as const } : {}),
  }));
}

/** What the client sees and what the team card says, plus the target itself. */
async function look(s: S, token: string) {
  const page = await s.t.query(api.sessionDelivery.page, { token });
  const status = await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId });
  const { target, owed } = await s.t.run(async (ctx) => {
    const session = (await ctx.db.get(s.A.sessionId))!;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "studio_a")).first();
    return { target: await payTargetFor(ctx, session, org), owed: await owedOnBooking(ctx, session) };
  });
  // The page, the card and the target always agree.
  expect(page!.payUrl).toBe(target.kind === "none" ? null : target.url);
  expect(status!.onlinePay).toBe(target.kind);
  expect(status!.onlinePayReason).toBe(target.kind === "none" ? target.reason : null);
  return { page: page!, status: status!, target, owed };
}

/** The kinds the checkout page offers, read the way the page reads them. */
function pageKinds(b: { paidCents: number; fullyPaid: boolean; depositCents: number; status: string; paymentMode: "deposit" | "full" }): CheckoutKind[] {
  if (b.paidCents === 0) return checkoutView(b).fullOnly ? ["full"] : ["deposit", "full"];
  return b.fullyPaid ? [] : ["balance"];
}

/** What the target charges, from the code that charges it. Throws when the
 *  checkout offers more than one amount (then no single charge exists). */
async function realCharge(s: S, target: PayTarget): Promise<{ cents: number; kind?: CheckoutKind }> {
  if (target.kind === "invoice") {
    const invoiceId = target.url.split("/").pop() as Id<"invoices">;
    const c = await s.t.query(internal.invoicePay._chargeContext, { invoiceId });
    expect(c!.status === "sent" || c!.status === "viewed" || c!.status === "overdue").toBe(true);
    return { cents: c!.amountCents };
  }
  if (target.kind === "checkout") {
    expect(target.url).toBe(`${APP_URL}/book/studio-a/checkout/${s.A.sessionId}`);
    const b = await s.t.query(api.booking.booking, { sessionId: s.A.sessionId });
    if (!b || b.pricingHidden) throw new Error("the checkout has no payment step");
    expect(b.stripeCheckout).toBe(true);
    const c = (await s.t.query(internal.booking._chargeContext, { sessionId: s.A.sessionId }))!;
    const kinds = pageKinds(b);
    const amounts = [...new Set(kinds.map((k) => checkoutChargeCents(c, k)))];
    if (amounts.length !== 1) throw new Error(`the checkout offers ${amounts.length} amounts`);
    return { cents: amounts[0], kind: kinds[0] };
  }
  throw new Error("no target");
}

/** Pay the target for real, through the Stripe webhook's handler. */
async function payThrough(s: S, target: PayTarget, kind?: CheckoutKind) {
  const metadata = target.kind === "invoice"
    ? { invoiceId: target.url.split("/").pop()! }
    : { sessionId: s.A.sessionId, kind: kind! };
  await s.t.mutation(internal.billingWebhooks.handle, {
    event: { id: `evt_${Math.random()}`, type: "checkout.session.completed", account: "acct_studio_a", data: { object: { metadata, payment_intent: "pi_x" } } },
  });
}

/** A target that is offered charges exactly what is owed and what the page
 *  shows; paying it settles the booking and releases the files. */
async function offeredAndSettles(s: S, token: string, expectCents: number) {
  const v = await look(s, token);
  expect(v.target.kind).not.toBe("none");
  expect(v.owed).toBe(expectCents);
  const charge = await realCharge(s, v.target);
  expect(charge.cents).toBe(v.owed);
  expect((v.target as { cents: number }).cents).toBe(charge.cents);
  // V4-01: a button is never offered without the amount beside it.
  expect(typeof v.page.balanceCents).toBe("number");
  expect(charge.cents).toBe(v.page.balanceCents);
  const paymentsBefore = await s.t.run(async (ctx) => (await ctx.db.query("payments").withIndex("by_session", (q) => q.eq("sessionId", s.A.sessionId)).take(50)).length);
  await payThrough(s, v.target, charge.kind);
  if (v.target.kind === "checkout") {
    const payments = await s.t.run(async (ctx) => await ctx.db.query("payments").withIndex("by_session", (q) => q.eq("sessionId", s.A.sessionId)).take(50));
    expect(payments).toHaveLength(paymentsBefore + 1);
    expect(payments[payments.length - 1].amountCents).toBe(charge.cents);
  }
  expect(await s.t.run(async (ctx) => await owedOnBooking(ctx, (await ctx.db.get(s.A.sessionId))!))).toBe(0);
  expect((await row(s)).status).toBe("released");
  expect((await s.t.query(api.sessionDelivery.page, { token }))!.state).toBe("unlocked");
}

async function noButton(s: S, token: string, owed: number | null, reason: string) {
  const v = await look(s, token);
  expect(v.target).toEqual({ kind: "none", reason });
  expect(v.page).toMatchObject({ state: "locked", payUrl: null, balanceCents: owed });
  return v;
}

describe("session delivery: the Pay button only for the exact amount (Addendum 3)", () => {
  beforeEach(() => { r2Env(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("G-21 (a) rate $400, $100 paid, $300 invoice paid, rate raised to $450: owed $50, no button", async () => {
    const s = await setup({ rateCents: 40000, depositCents: 10000, depositPaid: true, amountPaidCents: 10000 });
    await invoice(s, "paid", 30000);
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.sessionId, { rateCents: 45000 }); });
    const token = await ready(s);
    // The checkout alone would ask for $350 (it ignores the paid invoice).
    const c = await s.t.query(internal.booking._chargeContext, { sessionId: s.A.sessionId });
    expect(checkoutChargeCents(c!, "balance")).toBe(35000);
    await noButton(s, token, 5000, "amount_mismatch");
  });

  it("G-21 (b) rate $400, $100 paid, $300 invoice sent, a $100 package hour redeemed: owed $200, no button", async () => {
    const s = await setup({ rateCents: 40000, depositCents: 10000, depositPaid: true, amountPaidCents: 10000 });
    const inv = await invoice(s, "sent", 30000);
    const token = await ready(s);
    const creditId = await s.t.run(async (ctx) => await ctx.db.insert("packageCredits", {
      orgId: "studio_a", artistId: s.A.artistId, name: "10 hour block", hoursTotal: 10, hoursRemaining: 10, priceCents: 100000, status: "active", purchasedAt: Date.now(),
    }));
    // Before the redemption the open invoice is exactly what is owed.
    expect((await look(s, token)).target).toEqual({ kind: "invoice", url: `${APP_URL}/pay/invoice/${inv}`, cents: 30000 });
    await s.as(s.A.owner).mutation(api.packages.redeem, { sessionId: s.A.sessionId, creditId, hours: 1 });
    // R4-01: the open $300 invoice is now the wrong amount; the card must not
    // advise sending a second invoice.
    const v = await noButton(s, token, 20000, "open_invoice_wrong_amount");
    // The invoice would still charge $300.
    expect((await s.t.query(internal.invoicePay._chargeContext, { invoiceId: inv }))!.amountCents).toBe(30000);
    expect(v.owed).toBe(20000);
  });

  it("G-21 (c) a $300 DRAFT invoice: owed $300, no button, invoice_not_sent; once sent, the invoice for $300", async () => {
    const s = await setup({ rateCents: 40000, depositCents: 10000, depositPaid: true, amountPaidCents: 10000 });
    const inv = await invoice(s, "draft", 30000);
    const token = await ready(s);
    await noButton(s, token, 30000, "invoice_not_sent");
    await s.as(s.A.owner).mutation(api.invoices.setStatus, { id: inv, status: "sent" });
    expect((await look(s, token)).target).toEqual({ kind: "invoice", url: `${APP_URL}/pay/invoice/${inv}`, cents: 30000 });
    await offeredAndSettles(s, token, 30000);
  });

  it("G-21 (d) rate $360, nothing paid, no invoice, the room takes no deposit: the checkout, $360", async () => {
    const s = await setup({ rateCents: 36000, depositCents: 0, depositPaid: false, amountPaidCents: 0 });
    const token = await ready(s);
    expect((await look(s, token)).target).toEqual({ kind: "checkout", url: `${APP_URL}/book/studio-a/checkout/${s.A.sessionId}`, cents: 36000 });
    await offeredAndSettles(s, token, 36000);
  });

  it("G-21 (d) nothing paid and the room sells paid in full: the checkout, $360", async () => {
    const s = await setup({ rateCents: 36000, depositCents: 10800, depositPaid: false, amountPaidCents: 0 });
    await s.t.run(async (ctx) => {
      const roomId = await ctx.db.insert("rooms", { orgId: "studio_a", name: "Room A", status: "available", paymentMode: "full" });
      await ctx.db.patch(s.A.sessionId, { roomId });
    });
    const token = await ready(s);
    await offeredAndSettles(s, token, 36000);
  });

  it("G-21 (d) nothing paid and the checkout offers a deposit or the full amount: no single amount, no button", async () => {
    const s = await setup({ rateCents: 36000, depositCents: 10800, depositPaid: false, amountPaidCents: 0 });
    const token = await ready(s);
    const v = await noButton(s, token, 36000, "amount_mismatch");
    // The checkout really does offer two amounts, the deposit preselected.
    await expect(realCharge(s, { kind: "checkout", url: `${APP_URL}/book/studio-a/checkout/${s.A.sessionId}`, cents: 36000 })).rejects.toThrow("offers 2 amounts");
    expect(v.owed).toBe(36000);
  });

  it("G-21 a part-paid booking with no invoice: the checkout charges the balance, which is what is owed", async () => {
    const s = await setup();
    const token = await ready(s);
    await offeredAndSettles(s, token, 18000);
  });

  it("G-23 (e) hidden prices: no button, no amount on the page, in the pay email or in its log copy", async () => {
    const s = await setup({ pricingHidden: true });
    const token = await ready(s);
    await noButton(s, token, null, "prices_hidden");
    const [mail] = (await clientEmails(s.t, s.A.sessionId)).filter((m) => m.kind === "delivery.pay");
    for (const text of [mail.html!, mail.body]) {
      expect(text).not.toMatch(/\$\s?\d/);
      expect(text).not.toContain("180");
      expect(text).toContain("There is a balance on this booking. Studio A will send you a way to pay it.");
    }
    expect(mail.html).not.toContain("</a>");
    // The team (with money sight) still sees the amount on the card.
    expect((await look(s, token)).status).toMatchObject({ balanceCents: 18000, onlinePay: "none", onlinePayReason: "prices_hidden" });
  });

  it("G-21 G-23 (e) V4-01 hidden prices with an open invoice for exactly what is owed: no button on the page or in the email; paying the invoice unlocks the page by itself", async () => {
    const s = await setup({ pricingHidden: true });
    const inv = await invoice(s, "sent", 18000);
    const token = await ready(s);
    await noButton(s, token, null, "prices_hidden");
    const [mail] = (await clientEmails(s.t, s.A.sessionId)).filter((m) => m.kind === "delivery.pay");
    expect(mail.html).not.toContain("</a>");
    expect(mail.html).not.toMatch(/\$\s?\d/);
    expect(mail.html).toContain("There is a balance on this booking. Studio A will send you a way to pay it.");
    // The client pays the invoice the studio sent, through the real webhook.
    await payThrough(s, { kind: "invoice", url: `${APP_URL}/pay/invoice/${inv}`, cents: 18000 });
    expect((await row(s)).status).toBe("released");
    expect((await s.t.query(api.sessionDelivery.page, { token }))!.state).toBe("unlocked");
    const files = (await clientEmails(s.t, s.A.sessionId)).filter((m) => m.kind === "delivery.ready");
    expect(files).toHaveLength(1);
    expect(files[0].html).not.toMatch(/\$\s?\d/);
  });

  it("V4-01 hidden prices never get a target, whatever is open, drafted or owed (prices_hidden)", async () => {
    for (const make of [
      async (s: S) => { await invoice(s, "sent", 36000); },
      async (s: S) => { await invoice(s, "viewed", 36000); },
      async (s: S) => { await invoice(s, "overdue", 5000); },
      async (s: S) => { await invoice(s, "draft", 36000); },
      async () => {},
    ]) {
      const s = await setup({ pricingHidden: true, depositCents: 0, amountPaidCents: 0, rateCents: 36000 });
      await make(s);
      const token = await ready(s);
      const v = await look(s, token);
      expect(v.target).toEqual({ kind: "none", reason: "prices_hidden" });
      expect(v.page.payUrl).toBeNull();
      expect(v.page.balanceCents).toBeNull();
    }
  });

  it("R4-03 rate $400, deposit $120, nothing paid, discounted to $100: the checkout shows a $120 deposit, so no button", async () => {
    const s = await setup({ rateCents: 40000, depositCents: 12000, depositPaid: false, amountPaidCents: 0 });
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.sessionId, { rateCents: 10000 }); });
    const token = await ready(s);
    // What the checkout page shows and charges: a $120 deposit card (charging
    // $100) and the $100 full amount.
    const b = await s.t.query(api.booking.booking, { sessionId: s.A.sessionId });
    expect(b && !b.pricingHidden && [b.depositCents, b.rateCents, b.paidCents]).toEqual([12000, 10000, 0]);
    const c = (await s.t.query(internal.booking._chargeContext, { sessionId: s.A.sessionId }))!;
    expect([checkoutChargeCents(c, "deposit"), checkoutChargeCents(c, "full")]).toEqual([10000, 10000]);
    await noButton(s, token, 10000, "amount_mismatch");
  });

  it("R4-03 the deposit shown equals what is owed: the checkout is still offered", async () => {
    const s = await setup({ rateCents: 40000, depositCents: 10000, depositPaid: false, amountPaidCents: 0 });
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.sessionId, { rateCents: 10000 }); });
    const token = await ready(s);
    await offeredAndSettles(s, token, 10000);
  });

  it("G-22 (f) R3-03 an old row whose deposit is only the depositPaid flag: owed $300, its $300 invoice is the target, paying it releases", async () => {
    const s = await setup({ rateCents: 40000, depositCents: 10000, depositPaid: true, amountPaidCents: undefined });
    const inv = await invoice(s, "sent", 30000);
    const token = await ready(s);
    expect((await look(s, token)).target).toEqual({ kind: "invoice", url: `${APP_URL}/pay/invoice/${inv}`, cents: 30000 });
    await offeredAndSettles(s, token, 30000);
  });

  it("G-22 R3-03 the same old row with the invoice already paid: nothing owed, Ready releases at once", async () => {
    const s = await setup({ rateCents: 40000, depositCents: 10000, depositPaid: true, amountPaidCents: undefined });
    await invoice(s, "paid", 30000);
    await finalFile(s);
    expect(await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId })).toEqual({ state: "released" });
    expect((await clientEmails(s.t, s.A.sessionId)).map((m) => m.kind)).toEqual(["delivery.ready"]);
  });

  it("G-22 R3-03 the old row with no invoice: the checkout would charge the whole $400 for $300 owed, so no button", async () => {
    const s = await setup({ rateCents: 40000, depositCents: 10000, depositPaid: true, amountPaidCents: undefined });
    const token = await ready(s);
    await noButton(s, token, 30000, "amount_mismatch");
    const c = await s.t.query(internal.booking._chargeContext, { sessionId: s.A.sessionId });
    expect(checkoutChargeCents(c!, "full")).toBe(40000);
  });

  it("R3-01 a studio that cannot take cards online gets no button, whatever the invoices say", async () => {
    const s = await setup();
    const inv = await invoice(s, "sent", 18000);
    const token = await ready(s);
    expect((await look(s, token)).target.kind).toBe("invoice");
    await s.t.run(async (ctx) => {
      const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "studio_a")).first();
      await ctx.db.patch(org!._id, { stripeChargesEnabled: false });
    });
    // R4-01: an open invoice exists and no target qualifies.
    await noButton(s, token, 18000, "open_invoice_wrong_amount");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    await s.t.run(async (ctx) => { await ctx.db.patch(inv, { status: "void" }); });
    await noButton(s, token, 18000, "amount_mismatch");
  });

  it("R3-01 a cancelled booking offers nowhere to pay", async () => {
    const s = await setup();
    await invoice(s, "sent", 18000);
    await ready(s);
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.sessionId, { status: "cancelled" }); });
    const st = await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId });
    expect(st).toMatchObject({ cancelled: true, onlinePay: "none", onlinePayReason: "amount_mismatch" });
  });

  it("R3-01 two open invoices that add up to what is owed: no button (neither charges it)", async () => {
    const s = await setup();
    await invoice(s, "sent", 9000);
    await invoice(s, "overdue", 9000);
    const token = await ready(s);
    await noButton(s, token, 18000, "open_invoice_wrong_amount");
  });

  it("R3-01 nothing owed: nothing_owed, and Ready releases", async () => {
    const s = await setup({ amountPaidCents: 36000 });
    await finalFile(s);
    expect(await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId })).toEqual({ state: "released" });
    const st = await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId });
    expect(st).toMatchObject({ onlinePay: "none", onlinePayReason: "nothing_owed", balanceDue: false });
  });

  it("R3-02 the pay email without a target: no button, the amount and how it will be paid", async () => {
    const s = await setup({ rateCents: 40000, depositCents: 10000, depositPaid: true, amountPaidCents: 10000 });
    await invoice(s, "draft", 30000);
    await ready(s);
    const [mail] = (await clientEmails(s.t, s.A.sessionId)).filter((m) => m.kind === "delivery.pay");
    expect(mail.html).toContain(
      "Your Vocal tracking session from November 10 is finished and waiting. There is a $300.00 balance on this booking. Studio A will send you a way to pay it. Once it is paid, your download link arrives right away.",
    );
    expect(mail.html).not.toContain("</a>");
    expect(mail.html).not.toContain("and unlock");
    // The log copy keeps no amount.
    expect(mail.body).toContain("There is a balance on this booking. Studio A will send you a way to pay it.");
    expect(mail.body).not.toContain("$");
  });

  it("R3-02 the pay email with a target is as before: the amount on its button, which goes to the delivery page", async () => {
    const s = await setup();
    const token = await ready(s);
    const [mail] = (await clientEmails(s.t, s.A.sessionId)).filter((m) => m.kind === "delivery.pay");
    expect(mail.html).toContain(`href="${APP_URL}/delivery/${token}"`);
    expect(mail.html).toContain(">Pay $180.00 and unlock</a>");
    expect(mail.html).not.toContain("will send you a way to pay");
  });
});

/* ── R4-01: an open invoice for the wrong amount ────────────────── */

describe("session delivery: an open invoice that is not what is owed (R4-01)", () => {
  beforeEach(() => { r2Env(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("R4-01 one open invoice for less than is owed: open_invoice_wrong_amount, and the card names the invoice", async () => {
    const s = await setup({ rateCents: 40000, depositCents: 10000, depositPaid: true, amountPaidCents: 10000 });
    const inv = await invoice(s, "sent", 25000);
    const number = (await s.t.run(async (ctx) => await ctx.db.get(inv)))!.number;
    const token = await ready(s);
    const v = await noButton(s, token, 30000, "open_invoice_wrong_amount");
    expect(v.status).toMatchObject({ onlinePay: "none", onlinePayReason: "open_invoice_wrong_amount", openInvoice: { number, cents: 25000 }, balanceCents: 30000 });
  });

  it("R4-01 viewed and overdue count as open, and so do two open invoices that only add up to what is owed", async () => {
    for (const statuses of [["viewed"], ["overdue"], ["sent", "overdue"]] as const) {
      const s = await setup();
      for (const st of statuses) await invoice(s, st, statuses.length === 1 ? 5000 : 9000);
      const token = await ready(s);
      const v = await noButton(s, token, 18000, "open_invoice_wrong_amount");
      expect(v.status.openInvoice).toMatchObject({ cents: statuses.length === 1 ? 5000 : 9000 });
    }
  });

  it("R4-01 without money sight the open invoice is not returned at all", async () => {
    const s = await setup();
    await invoice(s, "sent", 5000);
    await ready(s);
    const eng = await s.as(s.A.engineer).query(api.sessionDelivery.status, { sessionId: s.A.sessionId });
    expect(eng).toMatchObject({ onlinePayReason: "open_invoice_wrong_amount", openInvoice: null, balanceCents: null });
    expect(JSON.stringify(eng)).not.toContain("5000");
  });

  it("R4-01 no open invoice: amount_mismatch stays, openInvoice null; a draft or paid or void invoice is not open", async () => {
    const s = await setup({ rateCents: 40000, depositCents: 10000, depositPaid: true, amountPaidCents: 10000 });
    await invoice(s, "paid", 30000);
    await invoice(s, "void", 5000);
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.sessionId, { rateCents: 45000 }); });
    const token = await ready(s);
    const v = await noButton(s, token, 5000, "amount_mismatch");
    expect(v.status.openInvoice).toBeNull();
  });

  it("R4-01 an open invoice that is the target is still reported to the card", async () => {
    const s = await setup();
    const inv = await invoice(s, "sent", 18000);
    const number = (await s.t.run(async (ctx) => await ctx.db.get(inv)))!.number;
    const token = await ready(s);
    const v = await look(s, token);
    expect(v.target.kind).toBe("invoice");
    expect(v.status).toMatchObject({ onlinePay: "invoice", onlinePayReason: null, openInvoice: { number, cents: 18000 } });
  });
});

/* ── R4-02: a no-show booking is treated exactly like a cancelled one ── */

describe("session delivery: a no-show booking delivers nothing (R4-02)", () => {
  beforeEach(() => { r2Env(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  const NO_SHOW = "This booking was a no-show, so there is nothing to deliver.";

  async function noShowFee(s: S) {
    await s.t.run(async (ctx) => {
      const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "studio_a")).first();
      await ctx.db.patch(org!._id, { cancellationFeePct: 50 });
    });
    await s.as(s.A.owner).mutation(api.sessions.setStatus, { id: s.A.sessionId, status: "no_show" });
  }

  it("R4-02 Ready to deliver is refused on a no-show: no row, no email; the card says no-show, not cancelled", async () => {
    const s = await setup({ rateCents: 40000, depositCents: 10000, depositPaid: true, amountPaidCents: 10000 });
    await finalFile(s);
    await noShowFee(s);
    await expect(s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId })).rejects.toThrow(NO_SHOW);
    expect(await s.t.run(async (ctx) => await ctx.db.query("sessionDeliveries").withIndex("by_session", (q) => q.eq("sessionId", s.A.sessionId)).first())).toBeNull();
    expect((await clientEmails(s.t, s.A.sessionId)).filter((m) => m.kind.startsWith("delivery."))).toHaveLength(0);
    const st = await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId });
    expect(st).toMatchObject({ noShow: true, cancelled: false, canMarkReady: false, canRelease: false, onlinePay: "none" });
  });

  it("R4-02 the no-show is billed and recorded exactly as before (the shield's fee, the deposit kept, a draft for the rest)", async () => {
    const s = await setup({ rateCents: 40000, depositCents: 10000, depositPaid: true, amountPaidCents: 10000 });
    await noShowFee(s);
    const session = (await s.t.run(async (ctx) => await ctx.db.get(s.A.sessionId)))!;
    expect(session).toMatchObject({ status: "no_show", rateCents: 40000, cancellationFeeCents: 20000, depositForfeited: true });
    const fees = await s.t.run(async (ctx) => await ctx.db.query("invoices").withIndex("by_session", (q) => q.eq("sessionId", s.A.sessionId)).take(10));
    expect(fees.map((i) => [i.status, i.amountCents, i.lineItems[0].label])).toEqual([["draft", 10000, "Vocal tracking - no-show fee"]]);
  });

  it("R4-02 a waiting delivery whose booking becomes a no-show: dead link, never releases, even once everything is paid", async () => {
    const s = await setup({ rateCents: 40000, depositCents: 10000, depositPaid: true, amountPaidCents: 10000 });
    const token = await ready(s);
    expect((await s.t.query(api.sessionDelivery.page, { token }))!.state).toBe("locked");
    await noShowFee(s);
    // The public page and every public mutation answer like an unknown link.
    expect(await s.t.query(api.sessionDelivery.page, { token })).toBeNull();
    expect(await s.t.mutation(api.sessionDelivery.opened, { token })).toBeNull();
    // Every cent the gate counts is paid: still nothing releases.
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.sessionId, { amountPaidCents: 40000 }); });
    expect(await s.t.mutation(api.sessionDelivery.refresh, { token })).toBeNull();
    expect(await s.t.run(async (ctx) => await onBalanceSettled(ctx, s.A.sessionId))).toBe(false);
    const fee = (await s.t.run(async (ctx) => await ctx.db.query("invoices").withIndex("by_session", (q) => q.eq("sessionId", s.A.sessionId)).first()))!;
    await s.as(s.A.owner).mutation(api.invoices.setStatus, { id: fee._id, status: "sent" });
    await s.as(s.A.owner).mutation(api.invoices.setStatus, { id: fee._id, status: "paid", paymentMethod: "zelle" });
    expect((await row(s)).status).toBe("awaiting_payment");
    // Staff: Send now anyway and Resend refuse with the no-show reason.
    await expect(s.as(s.A.owner).mutation(api.sessionDelivery.releaseNow, { sessionId: s.A.sessionId })).rejects.toThrow(NO_SHOW);
    await expect(s.as(s.A.owner).mutation(api.sessionDelivery.resend, { sessionId: s.A.sessionId })).rejects.toThrow(NO_SHOW);
    const st = await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId });
    expect(st).toMatchObject({ noShow: true, cancelled: false, canMarkReady: false, canRelease: false, onlinePay: "none", state: "awaiting_payment" });
    // Nowhere to pay.
    const target = await s.t.run(async (ctx) => await payTargetFor(ctx, (await ctx.db.get(s.A.sessionId))!, await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "studio_a")).first()));
    expect(target.kind).toBe("none");
    expect((await row(s)).status).toBe("awaiting_payment");
    expect((await clientEmails(s.t, s.A.sessionId)).filter((m) => m.kind === "delivery.ready")).toHaveLength(0);
  });

  it("R4-02 a released delivery whose booking becomes a no-show: the page and every file link go dead", async () => {
    const s = await setup({ amountPaidCents: 36000 });
    const f = await uploadSessionFile(s.t, s.as(s.A.engineer), s.A.sessionId, "Mix.wav");
    await s.as(s.A.engineer).mutation(api.sessionDelivery.setFinal, { assetId: f.assetId, final: true });
    expect(await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId })).toEqual({ state: "released" });
    const token = (await row(s)).token;
    expect((await s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: f.versionId })).url).toBeTruthy();
    await s.as(s.A.owner).mutation(api.sessions.setStatus, { id: s.A.sessionId, status: "no_show" });
    expect(await s.t.query(api.sessionDelivery.page, { token })).toBeNull();
    await expect(s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: f.versionId })).rejects.toThrow("That file is not available.");
    await expect(s.as(s.A.owner).mutation(api.sessionDelivery.resend, { sessionId: s.A.sessionId })).rejects.toThrow(NO_SHOW);
  });

  it("R4-02 a cancelled booking still says cancelled, and noShow is false", async () => {
    const s = await setup();
    await ready(s);
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.sessionId, { status: "cancelled" }); });
    const st = await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId });
    expect(st).toMatchObject({ cancelled: true, noShow: false, canRelease: false });
    await expect(s.as(s.A.owner).mutation(api.sessionDelivery.resend, { sessionId: s.A.sessionId })).rejects.toThrow("This booking was cancelled.");
  });
});

/* ── The rule as a property ────────────────────────────────────── */

/** mulberry32: a small seeded generator, so a failure replays exactly. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("session delivery: the Pay rule over random bookings (G-21 property)", () => {
  beforeEach(() => { r2Env(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("G-21 for 300 random bookings: a button only for exactly what is owed; owed never negative or NaN; released only at 0 owed", async () => {
    const SEED = 20261113;
    const rand = rng(SEED);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    const s = await setupStudios();
    await cardsOn(s.t);
    const rooms = await s.t.run(async (ctx) => ({
      deposit: await ctx.db.insert("rooms", { orgId: "studio_a", name: "Deposit room", status: "available", paymentMode: "deposit" }),
      full: await ctx.db.insert("rooms", { orgId: "studio_a", name: "Full room", status: "available", paymentMode: "full" }),
      legacy: await ctx.db.insert("rooms", { orgId: "studio_a", name: "Old room", status: "available" }),
    }));
    const token = await ready(s);
    const orgDocId = (await s.t.run(async (ctx) => await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "studio_a")).first()))!._id;

    const RATES = [0, 10000, 36000, 40000, 45000, 12345, Number.NaN, -100, Number.POSITIVE_INFINITY] as const;
    const DEPOSITS = [0, 5000, 10000, 18000, 40000, 60000] as const;
    const PAID = [undefined, 0, 5000, 10000, 18000, 36000, 40000, 50000, Number.NaN, -500] as const;
    const STATUSES = ["draft", "sent", "viewed", "paid", "overdue", "void"] as const;
    const kinds = { invoice: 0, checkout: 0, none: 0, released: 0 };

    for (let i = 0; i < 300; i++) {
      const rateCents = pick(RATES);
      const depositCents = pick(DEPOSITS);
      const amountPaidCents = pick(PAID);
      const depositPaid = rand() < 0.5;
      const pricingHidden = rand() < 0.2 ? true : rand() < 0.1 ? false : undefined;
      const roomId = pick([undefined, rooms.deposit, rooms.full, rooms.legacy]);
      const cards = rand() < 0.85;
      // A guess at what is owed, only to make matching invoices likely; the
      // assertions never use it.
      const credit = Math.max(amountPaidCents && amountPaidCents > 0 ? amountPaidCents : 0, depositPaid ? depositCents : 0);
      const guess = Math.max(0, (Number.isFinite(rateCents) ? rateCents : 0) - credit);
      const invoices = Array.from({ length: pick([0, 0, 0, 1, 1, 1, 2, 3]) }, () => ({
        status: pick(STATUSES),
        amountCents: rand() < 0.5 ? guess : pick([5000, 10000, 18000, 30000, Math.max(0, guess - 5000), 0, Number.NaN]),
      }));

      await s.t.run(async (ctx) => {
        await ctx.db.patch(s.A.sessionId, { rateCents, depositCents, amountPaidCents, depositPaid, pricingHidden, roomId, status: "confirmed" });
        await ctx.db.patch(orgDocId, { stripeChargesEnabled: cards });
        for (const old of await ctx.db.query("invoices").withIndex("by_session", (q) => q.eq("sessionId", s.A.sessionId)).take(50)) await ctx.db.delete(old._id);
        for (const inv of invoices) {
          await ctx.db.insert("invoices", {
            orgId: "studio_a", number: `PLS-P${i}`, artistId: s.A.artistId, sessionId: s.A.sessionId, status: inv.status,
            lineItems: [{ label: "x", amountCents: inv.amountCents }], amountCents: inv.amountCents, dueDate: Date.now() + 86_400_000,
          });
        }
        const d = await ctx.db.query("sessionDeliveries").withIndex("by_session", (q) => q.eq("sessionId", s.A.sessionId)).first();
        await ctx.db.patch(d!._id, { status: "awaiting_payment", releasedAt: undefined, releasedBy: undefined, expiresAt: Date.now() + 86_400_000 });
      });
      const label = JSON.stringify({ i, rateCents, depositCents, amountPaidCents, depositPaid, pricingHidden, room: roomId ? "room" : "none", cards, invoices });

      const v = await look(s, token);
      // owed: never negative, never NaN; Infinity only for a broken rate.
      expect(Number.isNaN(v.owed), label).toBe(false);
      expect(v.owed >= 0, label).toBe(true);
      expect(v.owed === Number.POSITIVE_INFINITY, label).toBe(!(Number.isFinite(rateCents) && rateCents >= 0));
      // The amount shown: owed, or none with hidden prices or a broken rate.
      expect(v.page.state, label).toBe("locked");
      expect(v.page.balanceCents, label).toBe(pricingHidden === true || !Number.isFinite(v.owed) ? null : v.owed);
      // The rule.
      kinds[v.target.kind]++;
      if (v.target.kind !== "none") {
        const charge = await realCharge(s, v.target);
        expect(charge.cents, label).toBe(v.owed);
        expect(v.target.cents, label).toBe(v.owed);
        expect(v.owed > 0, label).toBe(true);
        // V4-01: never a button without the amount beside it.
        expect(typeof v.page.balanceCents, label).toBe("number");
        expect(charge.cents, label).toBe(v.page.balanceCents);
      } else {
        expect(v.page.payUrl, label).toBeNull();
      }
      // Release only when nothing is owed, and always then (a Final file and
      // an email are on file throughout).
      const settled = await s.t.run(async (ctx) => await onBalanceSettled(ctx, s.A.sessionId));
      await s.t.mutation(api.sessionDelivery.refresh, { token });
      const released = (await row(s)).status === "released";
      expect(released, label).toBe(v.owed === 0);
      expect(settled, label).toBe(v.owed === 0);
      if (released) kinds.released++;
    }
    // The run covered every outcome.
    console.info("[G-21 property] seed", SEED, kinds);
    expect(kinds.invoice).toBeGreaterThan(5);
    expect(kinds.checkout).toBeGreaterThan(5);
    expect(kinds.none).toBeGreaterThan(50);
    expect(kinds.released).toBeGreaterThan(5);
  }, 120_000);

  it("checkoutKindsOffered agrees with the checkout page's own checkoutView for every payment mode, deposit and status", async () => {
    const { checkoutKindsOffered } = await import("./lib/checkout");
    for (const paymentMode of ["deposit", "full"] as const) {
      for (const depositCents of [-1, 0, 1, 10000, 36000, 50000]) {
        for (const status of ["tentative", "confirmed"]) {
          const kinds = checkoutKindsOffered({ rateCents: 36000, amountPaidCents: 0, depositCents }, paymentMode);
          expect(kinds).toEqual(pageKinds({ paidCents: 0, fullyPaid: false, depositCents, status, paymentMode }));
        }
      }
    }
    for (const amountPaidCents of [1, 18000, 35999]) {
      expect(checkoutKindsOffered({ rateCents: 36000, amountPaidCents, depositCents: 10000 }, "deposit")).toEqual(["balance"]);
    }
    expect(checkoutKindsOffered({ rateCents: 36000, amountPaidCents: 36000, depositCents: 10000 }, "deposit")).toEqual([]);
  });
});
