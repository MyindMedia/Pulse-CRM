import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { settlePayment } from "./payments";
import { onBalanceSettled, settleDeliveryQuietly, greetingName, LINK_TTL_MS, URL_RATE_WINDOW_MS, safeDownloadName } from "./sessionDelivery";
import { r2Env, setupStudios, uploadSessionFile, clientEmails, cardsOn, APP_URL, R2_KEY_PREFIX } from "./testing/sessionDelivery.fixture";

/* Session file delivery. Test names start with the eval id they prove
   (specs/features/session-file-delivery/eval.md) or the plan's Review Focus
   number (RF-n). */

type S = Awaited<ReturnType<typeof setupStudios>>;

async function deliveryRow(s: S, sessionId: Id<"sessions">) {
  return await s.t.run(async (ctx) =>
    await ctx.db.query("sessionDeliveries").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).take(10),
  );
}

async function deliveryEmails(s: S, sessionId: Id<"sessions">) {
  return (await clientEmails(s.t, sessionId)).filter((n) => n.kind.startsWith("delivery."));
}

/** One Final file on the booking, uploaded by the engineer. */
async function finalFile(s: S, sessionId: Id<"sessions"> = s.A.sessionId, name = "Lead vocal.wav") {
  const f = await uploadSessionFile(s.t, s.as(s.A.engineer), sessionId, name);
  await s.as(s.A.engineer).mutation(api.sessionDelivery.setFinal, { assetId: f.assetId, final: true });
  return f;
}

async function settle(s: S, sessionId: Id<"sessions">, kind: "deposit" | "balance" | "full", provider?: "simulated" | "stripe") {
  return await s.t.run(async (ctx) => await settlePayment(ctx, { sessionId, kind, provider }));
}

describe("session delivery: staff side and the payment trigger", () => {
  let s: S;
  beforeEach(async () => { r2Env(); s = await setupStudios(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  /* ── Access ─────────────────────────────────────────────── */

  it("A-08 a signed-out caller cannot call any staff function", async () => {
    const f = await finalFile(s);
    const sessionId = s.A.sessionId;
    await expect(s.t.mutation(api.sessionDelivery.setFinal, { assetId: f.assetId, final: false })).rejects.toThrow();
    expect(await s.t.query(api.sessionDelivery.status, { sessionId })).toBeNull();
    await expect(s.t.mutation(api.sessionDelivery.markReady, { sessionId })).rejects.toThrow();
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId });
    await expect(s.t.mutation(api.sessionDelivery.releaseNow, { sessionId })).rejects.toThrow();
    await expect(s.t.mutation(api.sessionDelivery.turnOff, { sessionId })).rejects.toThrow();
    await expect(s.t.mutation(api.sessionDelivery.resend, { sessionId })).rejects.toThrow();
    expect(await s.t.query(api.sessionDelivery.link, { sessionId })).toBeNull();
    expect((await deliveryRow(s, sessionId))[0].status).toBe("awaiting_payment");
  });

  it("A-09 a member of another studio cannot call any staff function on this booking", async () => {
    const f = await finalFile(s);
    const b = s.as(s.B.owner);
    const sessionId = s.A.sessionId;
    await expect(b.mutation(api.sessionDelivery.setFinal, { assetId: f.assetId, final: false })).rejects.toThrow();
    expect(await b.query(api.sessionDelivery.status, { sessionId })).toBeNull();
    await expect(b.mutation(api.sessionDelivery.markReady, { sessionId })).rejects.toThrow();
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId });
    await expect(b.mutation(api.sessionDelivery.releaseNow, { sessionId })).rejects.toThrow();
    await expect(b.mutation(api.sessionDelivery.turnOff, { sessionId })).rejects.toThrow();
    await expect(b.mutation(api.sessionDelivery.resend, { sessionId })).rejects.toThrow();
    expect(await b.query(api.sessionDelivery.link, { sessionId })).toBeNull();
    const row = (await deliveryRow(s, sessionId))[0];
    expect(row.status).toBe("awaiting_payment");
    expect(row.sendCount).toBe(1);
    const asset = await s.t.run(async (ctx) => await ctx.db.get(f.assetId));
    expect(asset!.clientFinal).toBe(true);
  });

  it("A-10 an engineer cannot releaseNow or turnOff", async () => {
    await finalFile(s);
    const eng = s.as(s.A.engineer);
    expect(await eng.mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId })).toEqual({ state: "awaiting_payment" });
    await expect(eng.mutation(api.sessionDelivery.releaseNow, { sessionId: s.A.sessionId })).rejects.toThrow();
    await expect(eng.mutation(api.sessionDelivery.turnOff, { sessionId: s.A.sessionId })).rejects.toThrow();
    const st = await eng.query(api.sessionDelivery.status, { sessionId: s.A.sessionId });
    expect(st).toMatchObject({ state: "awaiting_payment", canRelease: false, canTurnOff: false });
    expect((await deliveryRow(s, s.A.sessionId))[0].status).toBe("awaiting_payment");
  });

  it("A-11 an engineer never receives the balance amount; an owner does", async () => {
    await finalFile(s);
    const eng = await s.as(s.A.engineer).query(api.sessionDelivery.status, { sessionId: s.A.sessionId });
    expect(eng).toMatchObject({ balanceDue: true, balanceCents: null, state: "none", finalCount: 1, clientFirstName: "Jordan", clientEmail: "jordan.ellis@example.com", canMarkReady: true });
    expect(JSON.stringify(eng)).not.toContain("18000");
    const owner = await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId });
    expect(owner).toMatchObject({ balanceDue: true, balanceCents: 18000 });
  });

  it("setFinal marks and unmarks a file, and the session file list reports it", async () => {
    const f = await uploadSessionFile(s.t, s.as(s.A.engineer), s.A.sessionId);
    const list0 = await s.as(s.A.engineer).query(api.sessionFiles.list, { sessionId: s.A.sessionId });
    expect(list0!.files[0].clientFinal).toBe(false);
    await s.as(s.A.engineer).mutation(api.sessionDelivery.setFinal, { assetId: f.assetId, final: true });
    expect((await s.as(s.A.engineer).query(api.sessionFiles.list, { sessionId: s.A.sessionId }))!.files[0].clientFinal).toBe(true);
    await s.as(s.A.owner).mutation(api.sessionDelivery.setFinal, { assetId: f.assetId, final: false });
    expect((await s.as(s.A.engineer).query(api.sessionFiles.list, { sessionId: s.A.sessionId }))!.files[0].clientFinal).toBe(false);
  });

  /* ── Trigger and gate ───────────────────────────────────── */

  it("G-01 paid first, then Ready: released and one files ready email", async () => {
    await finalFile(s);
    await settle(s, s.A.sessionId, "balance");
    const res = await s.as(s.A.engineer).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    expect(res).toEqual({ state: "released" });
    const [row] = await deliveryRow(s, s.A.sessionId);
    expect(row).toMatchObject({ status: "released", releasedBy: "payment", sentTo: "jordan.ellis@example.com", sendCount: 1, readyBy: "Eli Engineer" });
    const mails = await deliveryEmails(s, s.A.sessionId);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      kind: "delivery.ready", subject: "Your files from Vocal tracking are ready", recipient: "jordan.ellis@example.com",
      accent: "#3b63e6", sessionId: s.A.sessionId,
    });
    expect(mails[0]).not.toHaveProperty("ctaLabel");
    expect(mails[0]).not.toHaveProperty("ctaUrl");
    expect(mails[0].html).toContain("Lead vocal.wav");
    // The button is in the body, in the studio's accent, linking to the client's page.
    expect(mails[0].html).toContain(`href="${APP_URL}/delivery/${row.token}"`);
    expect(mails[0].html).toContain("background-color:#3b63e6");
    expect(mails[0].html).toContain("color:#ffffff;text-decoration:none;\">Download your files</a>");
  });

  it("G-02 Ready first, then paid: one pay to unlock email, then one files ready email when the payment settles", async () => {
    // The studio takes cards online, so the pay email has its button (R3-01).
    await cardsOn(s.t);
    await finalFile(s);
    expect(await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId })).toEqual({ state: "awaiting_payment" });
    let mails = await deliveryEmails(s, s.A.sessionId);
    expect(mails.map((m) => m.kind)).toEqual(["delivery.pay"]);
    expect(mails[0]).toMatchObject({ subject: "Your files are ready. One step left" });
    expect(mails[0].html).toContain("\">Pay $180.00 and unlock</a>");
    expect(mails[0].html).toContain("background-color:#3b63e6");
    await settle(s, s.A.sessionId, "balance");
    mails = await deliveryEmails(s, s.A.sessionId);
    expect(mails.map((m) => m.kind)).toEqual(["delivery.pay", "delivery.ready"]);
    expect(mails[1].html).toContain("Payment received: $180.00. Thank you.");
    expect(mails[1].body).toContain("Payment received. Thank you.");
    expect(mails[1].body).not.toContain("$");
    const [row] = await deliveryRow(s, s.A.sessionId);
    expect(row).toMatchObject({ status: "released", releasedBy: "payment", sendCount: 2 });
  });

  it("G-03 a deposit that leaves a balance does not release", async () => {
    await finalFile(s, s.A.otherSessionId);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.otherSessionId });
    await settle(s, s.A.otherSessionId, "deposit");
    const [row] = await deliveryRow(s, s.A.otherSessionId);
    expect(row.status).toBe("awaiting_payment");
    expect((await deliveryEmails(s, s.A.otherSessionId)).map((m) => m.kind)).toEqual(["delivery.pay"]);
    // The deposit email still goes out as before.
    expect((await clientEmails(s.t, s.A.otherSessionId)).some((m) => m.subject === "Deposit received - Mix review")).toBe(true);
  });

  it("G-04 a Stripe payment releases the same way as a manual one", async () => {
    // Through the real webhook handler (billingWebhooks.handle), with the event
    // Stripe sends when the booking's checkout on the studio's connected
    // account completes. Only the signature check in the HTTP route is skipped.
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    await s.t.run(async (ctx) => {
      const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "studio_a")).first();
      await ctx.db.patch(org!._id, { stripeAccountId: "acct_studio_a" });
    });
    const event = (id: string, account: string) => ({
      id, type: "checkout.session.completed", account,
      data: { object: { id: `cs_${id}`, payment_intent: `pi_${id}`, metadata: { sessionId: s.A.sessionId, kind: "balance" } } },
    });
    // Another studio's Stripe account cannot settle this booking.
    await s.t.mutation(internal.billingWebhooks.handle, { event: event("evt_wrong", "acct_someone_else") });
    expect((await deliveryRow(s, s.A.sessionId))[0].status).toBe("awaiting_payment");

    await s.t.mutation(internal.billingWebhooks.handle, { event: event("evt_paid", "acct_studio_a") });
    expect((await deliveryRow(s, s.A.sessionId))[0]).toMatchObject({ status: "released", releasedBy: "payment" });
    expect((await deliveryEmails(s, s.A.sessionId)).map((m) => m.kind)).toEqual(["delivery.pay", "delivery.ready"]);
    // Stripe retries the same event: nothing more is sent.
    expect(await s.t.mutation(internal.billingWebhooks.handle, { event: event("evt_paid", "acct_studio_a") })).toEqual({ duplicate: true });
    expect((await deliveryEmails(s, s.A.sessionId)).map((m) => m.kind)).toEqual(["delivery.pay", "delivery.ready"]);
  });

  it("G-05 a comp that leaves nothing owed releases", async () => {
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    await s.as(s.A.owner).mutation(api.sessions.setComp, { id: s.A.sessionId, compType: "comped", compReason: "Loyal client" });
    const [row] = await deliveryRow(s, s.A.sessionId);
    expect(row).toMatchObject({ status: "released", releasedBy: "payment" });
    expect((await deliveryEmails(s, s.A.sessionId)).map((m) => m.kind)).toEqual(["delivery.pay", "delivery.ready"]);
  });

  it("G-05 a discount that still leaves a balance does not release", async () => {
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    await s.as(s.A.owner).mutation(api.sessions.setComp, { id: s.A.sessionId, compType: "discounted", chargedCents: 30000 });
    expect((await deliveryRow(s, s.A.sessionId))[0].status).toBe("awaiting_payment");
    // Discounted down to what was already paid: nothing owed, so it releases.
    await s.as(s.A.owner).mutation(api.sessions.setComp, { id: s.A.sessionId, compType: "discounted", chargedCents: 18000 });
    expect((await deliveryRow(s, s.A.sessionId))[0].status).toBe("released");
  });

  it("G-06 release happens once: a second settle call sends no second email", async () => {
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.sessionId, { amountPaidCents: 36000 }); });
    const first = await s.t.run(async (ctx) => await onBalanceSettled(ctx, s.A.sessionId, { paidCents: 18000 }));
    const second = await s.t.run(async (ctx) => await onBalanceSettled(ctx, s.A.sessionId, { paidCents: 18000 }));
    expect([first, second]).toEqual([true, false]);
    // A replayed settle on the now fully paid booking is refused before anything is sent.
    await expect(settle(s, s.A.sessionId, "balance")).rejects.toThrow("This booking is already paid in full.");
    expect((await deliveryEmails(s, s.A.sessionId)).filter((m) => m.kind === "delivery.ready")).toHaveLength(1);
  });

  it("G-07 the settling payment sends one client email, not two; with no delivery Paid in full still goes", async () => {
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    const before = (await clientEmails(s.t, s.A.sessionId)).length;
    await settle(s, s.A.sessionId, "balance");
    const after = await clientEmails(s.t, s.A.sessionId);
    const fromSettle = after.slice(before);
    expect(fromSettle).toHaveLength(1);
    expect(fromSettle[0].kind).toBe("delivery.ready");
    expect(after.some((m) => m.subject.startsWith("Paid in full - "))).toBe(false);

    // The other booking has no delivery: the plain email still goes.
    await settle(s, s.A.otherSessionId, "full");
    const other = await clientEmails(s.t, s.A.otherSessionId);
    expect(other.map((m) => m.subject)).toEqual(["Paid in full - Mix review"]);
  });

  it("G-08 markReady refuses with no Final files: clear error, no row, no email", async () => {
    await uploadSessionFile(s.t, s.as(s.A.engineer), s.A.sessionId); // a working file only
    await expect(s.as(s.A.engineer).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId })).rejects.toThrow(
      "Mark at least one file Final first.",
    );
    expect(await deliveryRow(s, s.A.sessionId)).toEqual([]);
    expect(await deliveryEmails(s, s.A.sessionId)).toEqual([]);
    const st = await s.as(s.A.engineer).query(api.sessionDelivery.status, { sessionId: s.A.sessionId });
    expect(st).toMatchObject({ finalCount: 0, canMarkReady: false });
  });

  it("G-09 markReady refuses with no client email, and status says there is none", async () => {
    await finalFile(s);
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.artistId, { email: undefined }); });
    await expect(s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId })).rejects.toThrow(
      "Add an email for this client first.",
    );
    expect(await deliveryRow(s, s.A.sessionId)).toEqual([]);
    const st = await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId });
    expect(st).toMatchObject({ clientEmail: null, canMarkReady: false, clientFirstName: "Jordan" });
  });

  it("G-10 an owner or manager's Send now anyway releases without payment and records who did it", async () => {
    await finalFile(s);
    await s.as(s.A.engineer).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    const st = await s.as(s.A.manager).query(api.sessionDelivery.status, { sessionId: s.A.sessionId });
    expect(st).toMatchObject({ canRelease: true, canTurnOff: true });
    await s.as(s.A.manager).mutation(api.sessionDelivery.releaseNow, { sessionId: s.A.sessionId });
    const [row] = await deliveryRow(s, s.A.sessionId);
    expect(row).toMatchObject({ status: "released", releasedBy: "Mo Manager" });
    const ready = (await deliveryEmails(s, s.A.sessionId)).filter((m) => m.kind === "delivery.ready");
    expect(ready).toHaveLength(1);
    expect(ready[0].body).not.toContain("Payment received");
    // Nothing left waiting: a second release is refused.
    await expect(s.as(s.A.owner).mutation(api.sessionDelivery.releaseNow, { sessionId: s.A.sessionId })).rejects.toThrow();
    // The owner too, on another booking.
    await finalFile(s, s.A.otherSessionId);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.otherSessionId });
    await s.as(s.A.owner).mutation(api.sessionDelivery.releaseNow, { sessionId: s.A.otherSessionId });
    expect((await deliveryRow(s, s.A.otherSessionId))[0]).toMatchObject({ status: "released", releasedBy: "Olu Owner" });
  });

  it("G-12 resend sends again to the booked email and starts a fresh 30 days", async () => {
    await finalFile(s);
    await settle(s, s.A.sessionId, "balance");
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    await s.t.run(async (ctx) => {
      const [row] = await ctx.db.query("sessionDeliveries").withIndex("by_session", (q) => q.eq("sessionId", s.A.sessionId)).take(1);
      await ctx.db.patch(row._id, { expiresAt: Date.now() + 1000 });
    });
    // Past the two-minute resend throttle (F2-06).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 121_000);
    const t0 = Date.now();
    await s.as(s.A.engineer).mutation(api.sessionDelivery.resend, { sessionId: s.A.sessionId });
    const [row] = await deliveryRow(s, s.A.sessionId);
    expect(row.sendCount).toBe(2);
    expect(row.sentTo).toBe("jordan.ellis@example.com");
    expect(row.expiresAt).toBeGreaterThanOrEqual(t0 + LINK_TTL_MS);
    const ready = (await deliveryEmails(s, s.A.sessionId)).filter((m) => m.kind === "delivery.ready");
    expect(ready).toHaveLength(2);
    expect(ready.every((m) => m.recipient === "jordan.ellis@example.com")).toBe(true);
  });

  it("G-12 resend on a waiting delivery sends the pay email again", async () => {
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    // Past the two-minute resend throttle (F2-06).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 121_000);
    await s.as(s.A.engineer).mutation(api.sessionDelivery.resend, { sessionId: s.A.sessionId });
    expect((await deliveryEmails(s, s.A.sessionId)).map((m) => m.kind)).toEqual(["delivery.pay", "delivery.pay"]);
    expect((await deliveryRow(s, s.A.sessionId))[0].status).toBe("awaiting_payment");
  });

  it("G-13 Ready to deliver after Turn off issues a new token; the old one stays dead", async () => {
    await finalFile(s);
    await settle(s, s.A.sessionId, "balance");
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    const [before] = await deliveryRow(s, s.A.sessionId);
    await s.as(s.A.owner).mutation(api.sessionDelivery.turnOff, { sessionId: s.A.sessionId });
    expect((await deliveryRow(s, s.A.sessionId))[0]).toMatchObject({ status: "off" });
    expect(await s.as(s.A.owner).query(api.sessionDelivery.link, { sessionId: s.A.sessionId })).toBeNull();
    const st = await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId });
    expect(st).toMatchObject({ state: "off", canMarkReady: true });
    expect(st!.offAt).toBeGreaterThan(0);
    expect(await s.as(s.A.engineer).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId })).toEqual({ state: "released" });
    const rows = await deliveryRow(s, s.A.sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].token).not.toBe(before.token);
    expect(rows[0].token).toMatch(/^[0-9a-f]{64}$/);
    const old = await s.t.run(async (ctx) => await ctx.db.query("sessionDeliveries").withIndex("by_token", (q) => q.eq("token", before.token)).first());
    expect(old).toBeNull();
    const link = await s.as(s.A.engineer).query(api.sessionDelivery.link, { sessionId: s.A.sessionId });
    expect(link).toEqual({ url: `${APP_URL}/delivery/${rows[0].token}` });
  });

  it("G-14 a cancelled booking cannot be marked ready, and a delivery on it does not release", async () => {
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    expect(await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId })).toMatchObject({ cancelled: false });
    await finalFile(s, s.A.otherSessionId);
    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.A.otherSessionId, { status: "cancelled" });
      await ctx.db.patch(s.A.sessionId, { status: "cancelled", amountPaidCents: 36000 });
    });
    await expect(s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.otherSessionId })).rejects.toThrow(
      "This booking was cancelled.",
    );
    expect(await s.t.run(async (ctx) => await onBalanceSettled(ctx, s.A.sessionId))).toBe(false);
    expect((await deliveryRow(s, s.A.sessionId))[0].status).toBe("awaiting_payment");
    await expect(s.as(s.A.owner).mutation(api.sessionDelivery.releaseNow, { sessionId: s.A.sessionId })).rejects.toThrow(
      "This booking was cancelled.",
    );
    // F2-13: the staff panel is told why, and resend says the same.
    expect(await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId })).toMatchObject({ cancelled: true });
    await expect(s.as(s.A.owner).mutation(api.sessionDelivery.resend, { sessionId: s.A.sessionId })).rejects.toThrow(
      "This booking was cancelled.",
    );
    expect((await deliveryEmails(s, s.A.sessionId)).map((m) => m.kind)).toEqual(["delivery.pay"]);
  });

  /* ── B-01: no partial write behind settlePayment's catch ─── */

  it("B-01 a payment that cannot release (no Final file left) leaves the delivery row unchanged and Paid in full still goes", async () => {
    const f = await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    await s.as(s.A.owner).mutation(api.sessionDelivery.setFinal, { assetId: f.assetId, final: false });
    const [before] = await deliveryRow(s, s.A.sessionId);
    await settle(s, s.A.sessionId, "balance");
    expect(await deliveryRow(s, s.A.sessionId)).toEqual([before]);
    const session = await s.t.run(async (ctx) => await ctx.db.get(s.A.sessionId));
    expect(session!.amountPaidCents).toBe(36000);
    const mails = await clientEmails(s.t, s.A.sessionId);
    expect(mails.filter((m) => m.subject === "Paid in full - Vocal tracking")).toHaveLength(1);
    expect(mails.filter((m) => m.kind === "delivery.ready")).toHaveLength(0);
  });

  it("B-01 the client row is gone: the payment lands, the delivery row is unchanged, the team is told", async () => {
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    await s.t.run(async (ctx) => { await ctx.db.delete(s.A.artistId); });
    const [before] = await deliveryRow(s, s.A.sessionId);
    await settle(s, s.A.sessionId, "balance");
    expect(await deliveryRow(s, s.A.sessionId)).toEqual([before]);
    const { session, team, ready } = await s.t.run(async (ctx) => {
      const rows = await ctx.db.query("notifications").withIndex("by_session", (q) => q.eq("sessionId", s.A.sessionId)).take(50);
      return {
        session: await ctx.db.get(s.A.sessionId),
        team: rows.filter((r) => r.kind === "payment.received"),
        ready: rows.filter((r) => r.kind === "delivery.ready"),
      };
    });
    expect(session!.amountPaidCents).toBe(36000);
    expect(team).toHaveLength(1);
    expect(ready).toHaveLength(0);
  });

  it("B-01 onBalanceSettled writes nothing and returns false when it cannot send the files email", async () => {
    const f = await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.sessionId, { amountPaidCents: 36000 }); });
    const [before] = await deliveryRow(s, s.A.sessionId);
    const mailsBefore = await clientEmails(s.t, s.A.sessionId);

    // No email on file.
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.artistId, { email: undefined }); });
    expect(await s.t.run(async (ctx) => await onBalanceSettled(ctx, s.A.sessionId))).toBe(false);
    expect(await deliveryRow(s, s.A.sessionId)).toEqual([before]);

    // Email back, but no Final file left.
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.artistId, { email: "jordan.ellis@example.com" }); });
    await s.as(s.A.owner).mutation(api.sessionDelivery.setFinal, { assetId: f.assetId, final: false });
    expect(await s.t.run(async (ctx) => await onBalanceSettled(ctx, s.A.sessionId))).toBe(false);
    expect(await deliveryRow(s, s.A.sessionId)).toEqual([before]);
    expect(await clientEmails(s.t, s.A.sessionId)).toEqual(mailsBefore);

    // Both back: it releases, once.
    await s.as(s.A.owner).mutation(api.sessionDelivery.setFinal, { assetId: f.assetId, final: true });
    expect(await s.t.run(async (ctx) => await onBalanceSettled(ctx, s.A.sessionId))).toBe(true);
    expect((await deliveryRow(s, s.A.sessionId))[0]).toMatchObject({ status: "released", sendCount: 2 });
  });

  /* ── B-03: no amount and no link for staff without money sight ── */

  it("B-03 the message log (forSession, recent) carries no amount, no link and no designed html", async () => {
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    await settle(s, s.A.sessionId, "balance");
    const [row] = await deliveryRow(s, s.A.sessionId);
    // The stored rows still hold the designed email (with the amount) for sending.
    const stored = await deliveryEmails(s, s.A.sessionId);
    expect(stored.map((m) => m.kind)).toEqual(["delivery.pay", "delivery.ready"]);
    expect(stored[0].html).toContain("$180.00");
    for (const m of stored) expect(m.body).not.toContain("$");

    const eng = (await s.as(s.A.engineer).query(api.notifications.forSession, { sessionId: s.A.sessionId })) as Array<Record<string, unknown>>;
    const owner = (await s.as(s.A.owner).query(api.notifications.recent, { limit: 50 })) as Array<Record<string, unknown>>;
    for (const rows of [eng, owner]) {
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r).not.toHaveProperty("html");
        expect(r).not.toHaveProperty("ctaUrl");
        expect(r).not.toHaveProperty("ctaLabel");
      }
      expect(JSON.stringify(rows)).not.toContain(row.token);
      expect(JSON.stringify(rows)).not.toContain("/delivery/");
      const delivery = rows.filter((r) => String(r.kind).startsWith("delivery."));
      expect(delivery).toHaveLength(2);
      expect(JSON.stringify(delivery)).not.toContain("$");
      expect(delivery.map((r) => r.body).join("\n")).toContain("There is a balance on this booking.");
    }
  });

  /* ── Review Focus ───────────────────────────────────────── */

  it("RF-3 two Ready to deliver taps leave one row and one email", async () => {
    await finalFile(s);
    await s.as(s.A.engineer).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    await Promise.all([
      s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId }),
      s.as(s.A.manager).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId }),
    ]);
    expect(await deliveryRow(s, s.A.sessionId)).toHaveLength(1);
    expect(await deliveryEmails(s, s.A.sessionId)).toHaveLength(1);
  });

  it("RF-3 the same holds for a paid booking (released on the first tap)", async () => {
    await finalFile(s);
    await settle(s, s.A.sessionId, "balance");
    await s.as(s.A.engineer).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    await s.as(s.A.engineer).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    expect(await deliveryRow(s, s.A.sessionId)).toHaveLength(1);
    expect((await deliveryEmails(s, s.A.sessionId)).map((m) => m.kind)).toEqual(["delivery.ready"]);
  });

  it("RF-4 a booking comped to 0 before anyone taps Ready releases straight away", async () => {
    await finalFile(s, s.A.otherSessionId);
    await s.as(s.A.owner).mutation(api.sessions.setComp, { id: s.A.otherSessionId, compType: "comped" });
    expect(await s.as(s.A.engineer).mutation(api.sessionDelivery.markReady, { sessionId: s.A.otherSessionId })).toEqual({ state: "released" });
    expect((await deliveryEmails(s, s.A.otherSessionId)).map((m) => m.kind)).toEqual(["delivery.ready"]);
  });

  it("A-15 the message log copy carries no link token", async () => {
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    await settle(s, s.A.sessionId, "balance");
    const [row] = await deliveryRow(s, s.A.sessionId);
    for (const m of await deliveryEmails(s, s.A.sessionId)) expect(m.body).not.toContain(row.token);
  });
});

/* ── Public side: the token page and signed downloads ───────── */

const NOT_AVAILABLE = "That file is not available.";

/** A released delivery with two Final files and one working file. */
async function released(s: S) {
  const a = await finalFile(s, s.A.sessionId, "Lead vocal.wav");
  const b = await uploadSessionFile(s.t, s.as(s.A.engineer), s.A.sessionId, "Stems.zip", "application/zip", 80_000_000);
  await s.as(s.A.engineer).mutation(api.sessionDelivery.setFinal, { assetId: b.assetId, final: true });
  const working = await uploadSessionFile(s.t, s.as(s.A.engineer), s.A.sessionId, "Rough idea.wav");
  await settle(s, s.A.sessionId, "balance");
  await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
  const [row] = await deliveryRow(s, s.A.sessionId);
  return { a, b, working, token: row.token, row };
}

/** A delivery waiting for payment with one Final file. */
async function waiting(s: S) {
  const a = await finalFile(s, s.A.sessionId, "Lead vocal.wav");
  await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
  const [row] = await deliveryRow(s, s.A.sessionId);
  return { a, token: row.token, row };
}

describe("session delivery: public page and downloads", () => {
  let s: S;
  beforeEach(async () => { r2Env(); s = await setupStudios(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("page: an unlocked delivery lists the Final files only, newest first, with the studio's brand", async () => {
    const { a, b, token } = await released(s);
    const p = await s.t.query(api.sessionDelivery.page, { token });
    expect(p).toMatchObject({
      studio: { name: "Studio A", logoUrl: null, accent: "#3b63e6" },
      booking: { title: "Vocal tracking", startTime: s.start, roomName: null },
      clientFirstName: "Jordan",
      state: "unlocked",
      balanceCents: null,
      payUrl: null,
      totalBytes: 85_000_000,
    });
    expect(p!.files.map((f) => [f.versionId, f.name, f.size, f.mimeType])).toEqual([
      [b.versionId, "Stems.zip", 80_000_000, "application/zip"],
      [a.versionId, "Lead vocal.wav", 5_000_000, "audio/wav"],
    ]);
    expect(p!.expiresAt).toBeGreaterThan(Date.now());
    const dl = await s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: a.versionId });
    expect(dl.url).toContain("X-Amz-Signature");
    expect(dl.fileName).toBe("Lead vocal.wav");
    // Saves under the original name, with a ten minute signature.
    const u = new URL(dl.url);
    expect(u.searchParams.get("response-content-disposition")).toContain('filename="Lead vocal.wav"');
    expect(u.searchParams.get("X-Amz-Expires")).toBe("600");
    expect((await deliveryRow(s, s.A.sessionId))[0].downloadCount).toBe(1);
  });

  it("page: a waiting delivery is locked with the balance and the booking's checkout", async () => {
    await cardsOn(s.t);
    const { token } = await waiting(s);
    const p = await s.t.query(api.sessionDelivery.page, { token });
    expect(p).toMatchObject({
      state: "locked",
      balanceCents: 18000,
      payUrl: `${APP_URL}/book/studio-a/checkout/${s.A.sessionId}`,
    });
    expect(p!.files.map((f) => f.name)).toEqual(["Lead vocal.wav"]);
  });

  it("A-01 unknown, malformed, off and expired tokens all get the same null from page", async () => {
    const { token } = await released(s);
    const unknown = "a".repeat(64);
    const malformed = "not-a-token";
    const results = [await s.t.query(api.sessionDelivery.page, { token: unknown }), await s.t.query(api.sessionDelivery.page, { token: malformed })];
    await s.as(s.A.owner).mutation(api.sessionDelivery.turnOff, { sessionId: s.A.sessionId });
    results.push(await s.t.query(api.sessionDelivery.page, { token }));
    // A second booking's delivery, expired.
    await finalFile(s, s.A.otherSessionId);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.otherSessionId });
    const [other] = await deliveryRow(s, s.A.otherSessionId);
    await s.t.run(async (ctx) => { await ctx.db.patch(other._id, { expiresAt: Date.now() - 1 }); });
    results.push(await s.t.query(api.sessionDelivery.page, { token: other.token }));
    expect(results).toEqual([null, null, null, null]);
  });

  it("A-02 fileUrl refuses while the delivery is waiting for payment", async () => {
    const { a, token } = await waiting(s);
    await expect(s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: a.versionId })).rejects.toThrow(NOT_AVAILABLE);
    expect((await deliveryRow(s, s.A.sessionId))[0].downloadCount).toBe(0);
  });

  it("A-03 fileUrl refuses a file that is not marked Final", async () => {
    const { working, token } = await released(s);
    await expect(s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: working.versionId })).rejects.toThrow(NOT_AVAILABLE);
    const p = await s.t.query(api.sessionDelivery.page, { token });
    expect(p!.files.map((f) => f.name)).not.toContain("Rough idea.wav");
  });

  it("A-04 fileUrl refuses a Final file from another booking of the same studio", async () => {
    const { token } = await released(s);
    const other = await finalFile(s, s.A.otherSessionId, "Other booking.wav");
    await expect(s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: other.versionId })).rejects.toThrow(NOT_AVAILABLE);
  });

  it("A-05 fileUrl refuses a file from another studio", async () => {
    const { token } = await released(s);
    const theirs = await uploadSessionFile(s.t, s.as(s.B.owner), s.B.sessionId, "B master.wav");
    await s.as(s.B.owner).mutation(api.sessionDelivery.setFinal, { assetId: theirs.assetId, final: true });
    await expect(s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: theirs.versionId })).rejects.toThrow(NOT_AVAILABLE);
  });

  it("A-06 fileUrl refuses after Turn off link and after expiry", async () => {
    const { a, token } = await released(s);
    await s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: a.versionId });
    await s.as(s.A.owner).mutation(api.sessionDelivery.turnOff, { sessionId: s.A.sessionId });
    await expect(s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: a.versionId })).rejects.toThrow(NOT_AVAILABLE);

    // A fresh link, then let it run out.
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    const [row] = await deliveryRow(s, s.A.sessionId);
    await s.t.mutation(api.sessionDelivery.fileUrl, { token: row.token, versionId: a.versionId });
    await s.t.run(async (ctx) => { await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 }); });
    await expect(s.t.mutation(api.sessionDelivery.fileUrl, { token: row.token, versionId: a.versionId })).rejects.toThrow(NOT_AVAILABLE);
  });

  it("A-07 page never returns a file URL, an R2 key or the token", async () => {
    for (const { token } of [await released(s)]) {
      const p = await s.t.query(api.sessionDelivery.page, { token });
      const json = JSON.stringify(p);
      const keys = await s.t.run(async (ctx) => (await ctx.db.query("mediaFiles").take(50)).map((m) => m.key));
      expect(json).not.toContain("http");
      expect(json).not.toContain("r2.cloudflarestorage.com");
      expect(json).not.toContain("X-Amz");
      expect(json).not.toContain(`${R2_KEY_PREFIX}/`);
      for (const k of keys) expect(json).not.toContain(k);
      expect(json).not.toContain(token);
    }
    // Locked too, with a Pay button (the studio takes cards online).
    s = await setupStudios();
    await cardsOn(s.t);
    const w = await waiting(s);
    const json = JSON.stringify(await s.t.query(api.sessionDelivery.page, { token: w.token }));
    expect(json).toContain("/checkout/"); // the pay link is the only URL, and it is the app's own
    expect(json).not.toContain("r2.cloudflarestorage.com");
    // Storage keys look like "<prefix>/<studio>/deliverable/<name>-<uuid>.<ext>".
    expect(json).not.toContain(`${R2_KEY_PREFIX}/studio_`);
    for (const k of await s.t.run(async (ctx) => (await ctx.db.query("mediaFiles").take(50)).map((m) => m.key))) expect(json).not.toContain(k);
    expect(json).not.toContain(w.token);
  });

  it("A-07 with a studio logo: the logo is a public media URL and nothing from the private bucket appears", async () => {
    const { token } = await released(s);
    await s.t.run(async (ctx) => {
      const logo = await ctx.db.insert("mediaFiles", {
        orgId: "studio_a", bucket: "media", key: `${R2_KEY_PREFIX}/studio_a/logo/mark-1.png`, purpose: "logo",
        fileName: "mark.png", mimeType: "image/png", size: 2048, status: "ready", uploadedBy: "u_owner", createdAt: Date.now(),
      });
      const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "studio_a")).first();
      await ctx.db.patch(org!._id, { logoId: logo });
    });
    const p = await s.t.query(api.sessionDelivery.page, { token });
    expect(p!.studio.logoUrl).toBe(`https://media.example.test/${R2_KEY_PREFIX}/studio_a/logo/mark-1.png`);
    const json = JSON.stringify(p);
    expect(json).not.toContain("r2.cloudflarestorage.com");
    expect(json).not.toContain("X-Amz");
    expect(json).not.toContain("pulse-private");
    const privateKeys = await s.t.run(async (ctx) =>
      (await ctx.db.query("mediaFiles").take(50)).filter((m) => m.bucket === "private").map((m) => m.key),
    );
    expect(privateKeys.length).toBeGreaterThan(0);
    for (const k of privateKeys) expect(json).not.toContain(k);
    expect(json).not.toContain(token);
  });

  it("A-07 a logo that points at a private-bucket file is not signed onto the public page", async () => {
    const { a, token } = await released(s);
    await s.t.run(async (ctx) => {
      const version = await ctx.db.get(a.versionId);
      const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "studio_a")).first();
      await ctx.db.patch(org!._id, { logoId: version!.mediaId });
    });
    const p = await s.t.query(api.sessionDelivery.page, { token });
    expect(p!.studio.logoUrl).toBeNull();
    const json = JSON.stringify(p);
    expect(json).not.toContain("X-Amz");
    expect(json).not.toContain("r2.cloudflarestorage.com");
  });

  it("A-12 unmarking Final removes the file from the page and from fileUrl at once", async () => {
    const { a, b, token } = await released(s);
    await s.as(s.A.engineer).mutation(api.sessionDelivery.setFinal, { assetId: a.assetId, final: false });
    const p = await s.t.query(api.sessionDelivery.page, { token });
    expect(p!.files.map((f) => f.versionId)).toEqual([b.versionId]);
    await expect(s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: a.versionId })).rejects.toThrow(NOT_AVAILABLE);
  });

  it("A-13 deleting a Final file removes it from the client page", async () => {
    const { a, b, token } = await released(s);
    await s.as(s.A.owner).mutation(api.sessionFiles.remove, { assetId: a.assetId });
    const p = await s.t.query(api.sessionDelivery.page, { token });
    expect(p!.files.map((f) => f.versionId)).toEqual([b.versionId]);
  });

  it("A-14 fileUrl is rate limited: 120 an hour, the 121st refused, the next window allowed", async () => {
    const { a, token } = await released(s);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now());
    for (let i = 0; i < 120; i++) await s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: a.versionId });
    await expect(s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: a.versionId })).rejects.toThrow(
      "Too many downloads. Try again in an hour.",
    );
    expect((await deliveryRow(s, s.A.sessionId))[0].downloadCount).toBe(120);
    vi.setSystemTime(Date.now() + URL_RATE_WINDOW_MS + 1000);
    const dl = await s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: a.versionId });
    expect(dl.url).toContain("X-Amz-Signature");
  });

  it("F2-09 a play is not counted as a download, but every mint counts toward the rate limit", async () => {
    const { a, token } = await released(s);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now());
    const play = await s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: a.versionId, purpose: "play" });
    expect(play.url).toContain("X-Amz-Signature");
    let row = (await deliveryRow(s, s.A.sessionId))[0];
    expect(row.downloadCount).toBe(0);
    expect(row.urlCount).toBe(1);

    await s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: a.versionId, purpose: "download" });
    await s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: a.versionId });
    row = (await deliveryRow(s, s.A.sessionId))[0];
    expect(row.downloadCount).toBe(2);
    expect(row.urlCount).toBe(3);

    for (let i = 0; i < 117; i++) {
      await s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: a.versionId, purpose: "play" });
    }
    await expect(
      s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: a.versionId, purpose: "play" }),
    ).rejects.toThrow("Too many downloads. Try again in an hour.");
    expect((await deliveryRow(s, s.A.sessionId))[0].downloadCount).toBe(2);
  });

  it("A-15 public results carry no token", async () => {
    const { a, token } = await released(s);
    const dl = await s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: a.versionId });
    expect(JSON.stringify(dl)).not.toContain(token);
    expect(await s.t.mutation(api.sessionDelivery.opened, { token })).toBeNull();
    expect(JSON.stringify(await s.t.query(api.sessionDelivery.page, { token }))).not.toContain(token);
  });

  it("G-11 a released delivery stays released after the rate is raised", async () => {
    const { token } = await released(s);
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.sessionId, { rateCents: 99_000 }); });
    const p = await s.t.query(api.sessionDelivery.page, { token });
    expect(p).toMatchObject({ state: "unlocked", balanceCents: null, payUrl: null });
  });

  it("G-13 the old link stays dead after a new Ready to deliver", async () => {
    const { a, token } = await released(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.turnOff, { sessionId: s.A.sessionId });
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    const [row] = await deliveryRow(s, s.A.sessionId);
    expect(await s.t.query(api.sessionDelivery.page, { token })).toBeNull();
    await expect(s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: a.versionId })).rejects.toThrow(NOT_AVAILABLE);
    expect((await s.t.query(api.sessionDelivery.page, { token: row.token }))!.state).toBe("unlocked");
  });

  it("B-02 refresh releases a waiting delivery once nothing is owed, exactly once", async () => {
    const { token } = await waiting(s);
    // A path that lowered what is owed without calling the hook.
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.sessionId, { rateCents: 18000 }); });
    expect(await s.t.mutation(api.sessionDelivery.refresh, { token })).toBeNull();
    const [row] = await deliveryRow(s, s.A.sessionId);
    expect(row).toMatchObject({ status: "released", releasedBy: "payment", sendCount: 2, sentTo: "jordan.ellis@example.com" });
    expect((await deliveryEmails(s, s.A.sessionId)).map((m) => m.kind)).toEqual(["delivery.pay", "delivery.ready"]);
    expect((await s.t.query(api.sessionDelivery.page, { token }))!.state).toBe("unlocked");
    // A second refresh queues nothing and changes nothing.
    expect(await s.t.mutation(api.sessionDelivery.refresh, { token })).toBeNull();
    expect(await deliveryRow(s, s.A.sessionId)).toEqual([row]);
    expect(await deliveryEmails(s, s.A.sessionId)).toHaveLength(2);
  });

  it("B-02 refresh with a balance still owed changes nothing", async () => {
    const { token, row } = await waiting(s);
    expect(await s.t.mutation(api.sessionDelivery.refresh, { token })).toBeNull();
    expect(await deliveryRow(s, s.A.sessionId)).toEqual([row]);
    expect((await deliveryEmails(s, s.A.sessionId)).map((m) => m.kind)).toEqual(["delivery.pay"]);
  });

  it("B-02 refresh never throws for a bad token, and a dead link never releases", async () => {
    for (const token of ["nope", "", "d".repeat(64), "D".repeat(64)]) {
      expect(await s.t.mutation(api.sessionDelivery.refresh, { token })).toBeNull();
    }
    const { token } = await waiting(s);
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.sessionId, { rateCents: 18000 }); });
    // Expired.
    const [row] = await deliveryRow(s, s.A.sessionId);
    await s.t.run(async (ctx) => { await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 }); });
    expect(await s.t.mutation(api.sessionDelivery.refresh, { token })).toBeNull();
    expect((await deliveryRow(s, s.A.sessionId))[0].status).toBe("awaiting_payment");
    // Cancelled booking.
    await s.t.run(async (ctx) => {
      await ctx.db.patch(row._id, { expiresAt: Date.now() + LINK_TTL_MS });
      await ctx.db.patch(s.A.sessionId, { status: "cancelled" });
    });
    expect(await s.t.mutation(api.sessionDelivery.refresh, { token })).toBeNull();
    // Turned off.
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.sessionId, { status: "confirmed" }); });
    await s.as(s.A.owner).mutation(api.sessionDelivery.turnOff, { sessionId: s.A.sessionId });
    expect(await s.t.mutation(api.sessionDelivery.refresh, { token })).toBeNull();
    expect((await deliveryRow(s, s.A.sessionId))[0].status).toBe("off");
    expect((await deliveryEmails(s, s.A.sessionId)).map((m) => m.kind)).toEqual(["delivery.pay"]);
  });

  it("B-02 a package redemption that leaves nothing owed releases", async () => {
    await waiting(s);
    const creditId = await s.t.run(async (ctx) =>
      await ctx.db.insert("packageCredits", {
        orgId: "studio_a", artistId: s.A.artistId, name: "10 hours", hoursTotal: 10, hoursRemaining: 10,
        priceCents: 100_000, status: "active", purchasedAt: Date.now(),
      }),
    );
    // 2 hours at $100 an hour: the rate drops to $160, under the $180 already paid.
    await s.as(s.A.owner).mutation(api.packages.redeem, { sessionId: s.A.sessionId, creditId, hours: 2 });
    expect((await deliveryRow(s, s.A.sessionId))[0]).toMatchObject({ status: "released", releasedBy: "payment" });
    expect((await deliveryEmails(s, s.A.sessionId)).map((m) => m.kind)).toEqual(["delivery.pay", "delivery.ready"]);
  });

  it("B-02 a shorter session that leaves nothing owed releases", async () => {
    await waiting(s);
    // Four hours at $360 cut to two: $180, all of it already paid.
    await s.as(s.A.owner).mutation(api.sessions.extend, { id: s.A.sessionId, addMinutes: -120 });
    expect((await deliveryRow(s, s.A.sessionId))[0]).toMatchObject({ status: "released", releasedBy: "payment" });
    expect((await deliveryEmails(s, s.A.sessionId)).map((m) => m.kind)).toEqual(["delivery.pay", "delivery.ready"]);
  });

  it("B-02 a recorded deposit that covers the whole rate releases", async () => {
    await finalFile(s, s.A.otherSessionId);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.otherSessionId });
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.otherSessionId, { depositCents: 20000 }); });
    await s.as(s.A.owner).mutation(api.sessions.payDeposit, { id: s.A.otherSessionId });
    expect((await deliveryRow(s, s.A.otherSessionId))[0]).toMatchObject({ status: "released", releasedBy: "payment" });
    expect((await deliveryEmails(s, s.A.otherSessionId)).map((m) => m.kind)).toEqual(["delivery.pay", "delivery.ready"]);
  });

  it("opened stamps first and last opened at most once a minute, and never throws", async () => {
    const { token } = await released(s);
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = Date.now();
    vi.setSystemTime(t0);
    await s.t.mutation(api.sessionDelivery.opened, { token });
    vi.setSystemTime(t0 + 30_000);
    await s.t.mutation(api.sessionDelivery.opened, { token });
    let [row] = await deliveryRow(s, s.A.sessionId);
    expect(row.firstOpenedAt).toBe(t0);
    expect(row.lastOpenedAt).toBe(t0);
    vi.setSystemTime(t0 + 61_000);
    await s.t.mutation(api.sessionDelivery.opened, { token });
    [row] = await deliveryRow(s, s.A.sessionId);
    expect(row).toMatchObject({ firstOpenedAt: t0, lastOpenedAt: t0 + 61_000 });
    expect(await s.t.mutation(api.sessionDelivery.opened, { token: "nope" })).toBeNull();
    expect(await s.t.mutation(api.sessionDelivery.opened, { token: "b".repeat(64) })).toBeNull();
    const st = await s.as(s.A.engineer).query(api.sessionDelivery.status, { sessionId: s.A.sessionId });
    expect(st!.firstOpenedAt).toBe(t0);
  });

  it("RF-1 safeDownloadName: quotes, slashes, backslashes and newlines are gone, letters stay", () => {
    const out = safeDownloadName('a"b/c\\d\n.wav');
    for (const ch of ['"', "/", "\\", "\n", "\r"]) expect(out).not.toContain(ch);
    expect(out).toContain(".wav");
    expect(safeDownloadName('""""')).toBe("download");
    expect(safeDownloadName("   ")).toBe("download");
    expect(safeDownloadName("Ünïcode ✓.wav")).toBe("Ünïcode ✓.wav");
    expect(safeDownloadName("x\u0000y\u001fz\u007f.wav")).toBe("xyz.wav");
    const long = safeDownloadName(`${"n".repeat(400)}.wav`);
    expect(long.length).toBeLessThanOrEqual(150);
    expect(long.endsWith(".wav")).toBe(true);
  });

  it("RF-1 a hostile file name downloads under a safe name and the header stays whole", async () => {
    const f = await uploadSessionFile(s.t, s.as(s.A.engineer), s.A.sessionId, 'Mix "final"/v2\\x\r\nSet-Cookie: a=b.wav');
    await s.as(s.A.engineer).mutation(api.sessionDelivery.setFinal, { assetId: f.assetId, final: true });
    const u = await uploadSessionFile(s.t, s.as(s.A.engineer), s.A.sessionId, "Ünïcode ✓.wav");
    await s.as(s.A.engineer).mutation(api.sessionDelivery.setFinal, { assetId: u.assetId, final: true });
    await settle(s, s.A.sessionId, "balance");
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    const [row] = await deliveryRow(s, s.A.sessionId);

    const dl = await s.t.mutation(api.sessionDelivery.fileUrl, { token: row.token, versionId: f.versionId });
    const cd = new URL(dl.url).searchParams.get("response-content-disposition")!;
    for (const ch of ["\r", "\n", "\\"]) expect(cd).not.toContain(ch);
    // Exactly one quoted name: no quote inside it can end it early.
    expect(cd.match(/"/g)).toHaveLength(2);
    expect(dl.fileName).not.toMatch(/["/\\\r\n]/);

    const uni = await s.t.mutation(api.sessionDelivery.fileUrl, { token: row.token, versionId: u.versionId });
    const ucd = new URL(uni.url).searchParams.get("response-content-disposition")!;
    expect(uni.fileName).toBe("Ünïcode ✓.wav");
    expect(ucd).toContain("filename*=UTF-8''%C3%9Cn%C3%AFcode%20%E2%9C%93.wav");
    // The plain fallback is ASCII only.
    expect(/filename="([^"]*)"/.exec(ucd)![1]).toMatch(/^[\x20-\x7e]+$/);
  });

  it("RF-2 a Final file with a newer version: the page lists and serves only the latest", async () => {
    const { a, token } = await released(s);
    const prep = await s.as(s.A.owner).mutation(api.mediaLibrary.prepareUpload, { fileName: "Lead vocal v2.wav", mimeType: "audio/wav", size: 6_000_000 });
    await s.t.mutation(internal.media._markReady, { mediaId: prep.mediaId, size: 6_000_000 });
    const v2 = await s.as(s.A.owner).mutation(api.mediaLibrary.addVersion, { mediaId: prep.mediaId, assetId: a.assetId });
    const p = await s.t.query(api.sessionDelivery.page, { token });
    const entry = p!.files.find((f) => f.name === "Lead vocal.wav")!;
    expect(entry.versionId).toBe(v2.versionId);
    expect(entry.size).toBe(6_000_000);
    expect(p!.files.some((f) => f.versionId === a.versionId)).toBe(false);
    await expect(s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: a.versionId })).rejects.toThrow(NOT_AVAILABLE);
    const dl = await s.t.mutation(api.sessionDelivery.fileUrl, { token, versionId: v2.versionId });
    expect(dl.fileName).toBe("Lead vocal v2.wav");
  });

  it("RF-5 every Final file unmarked, or deleted, or the booking cancelled: the page answers like an unknown link", async () => {
    const unknown = await s.t.query(api.sessionDelivery.page, { token: "c".repeat(64) });
    expect(unknown).toBeNull();

    let r = await released(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.setFinal, { assetId: r.a.assetId, final: false });
    await s.as(s.A.owner).mutation(api.sessionDelivery.setFinal, { assetId: r.b.assetId, final: false });
    expect(await s.t.query(api.sessionDelivery.page, { token: r.token })).toEqual(unknown);

    s = await setupStudios();
    r = await released(s);
    await s.as(s.A.owner).mutation(api.sessionFiles.remove, { assetId: r.a.assetId });
    await s.as(s.A.owner).mutation(api.sessionFiles.remove, { assetId: r.b.assetId });
    expect(await s.t.query(api.sessionDelivery.page, { token: r.token })).toEqual(unknown);

    s = await setupStudios();
    r = await released(s);
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.sessionId, { status: "cancelled" }); });
    expect(await s.t.query(api.sessionDelivery.page, { token: r.token })).toEqual(unknown);
    await expect(s.t.mutation(api.sessionDelivery.fileUrl, { token: r.token, versionId: r.a.versionId })).rejects.toThrow(NOT_AVAILABLE);
  });
});

/* ── F2-01: a paid invoice on the booking counts toward "nothing owed" ── */

describe("session delivery: paid invoices count, every trigger guarded (F2-01, F2-03, F2-04)", () => {
  let s: S;
  beforeEach(async () => {
    r2Env();
    s = await setupStudios();
    // The studio's connected Stripe account, so the real webhook handler accepts its events.
    await s.t.run(async (ctx) => {
      const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "studio_a")).first();
      await ctx.db.patch(org!._id, { stripeAccountId: "acct_studio_a" });
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  let n = 0;
  /** An invoice on a booking, in the given state. */
  async function invoice(
    sessionId: Id<"sessions"> | undefined,
    status: "draft" | "sent" | "viewed" | "paid" | "overdue" | "void",
    amountCents: number,
    orgId = "studio_a",
  ): Promise<Id<"invoices">> {
    n++;
    return await s.t.run(async (ctx) => {
      const artistId = orgId === "studio_a" ? s.A.artistId : (await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).first())!._id;
      return await ctx.db.insert("invoices", {
        orgId, number: `PLS-${900000 + n}`, artistId, sessionId, status,
        lineItems: [{ label: "Vocal tracking - balance", amountCents }], amountCents,
        dueDate: Date.now() + 14 * 86_400_000, ...(status === "paid" ? { paidAt: Date.now(), paymentMethod: "cash" as const } : {}),
      });
    });
  }

  /** The invoice paid online: the Stripe webhook's real handler. */
  async function payOnline(invoiceId: Id<"invoices">, eventId = `evt_${invoiceId}`) {
    await s.t.mutation(internal.billingWebhooks.handle, {
      event: { id: eventId, type: "checkout.session.completed", account: "acct_studio_a", data: { object: { metadata: { invoiceId }, payment_intent: "pi_x" } } },
    });
  }

  /** Every client email to Jordan (invoice receipts carry no sessionId). */
  async function allClientEmails() {
    return await s.t.run(async (ctx) =>
      (await ctx.db.query("notifications").withIndex("by_org", (q) => q.eq("orgId", "studio_a")).take(200))
        .filter((r) => r.channel === "email" && r.recipient === "jordan.ellis@example.com")
        .sort((a, b) => a._creationTime - b._creationTime),
    );
  }

  it("G-15 Ready first, then the balance invoice is paid online: released, one files email, no separate invoice receipt", async () => {
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    const inv = await invoice(s.A.sessionId, "sent", 18000);
    const before = (await allClientEmails()).length;
    await payOnline(inv);
    expect((await s.t.run(async (ctx) => await ctx.db.get(inv)))!.status).toBe("paid");
    const [row] = await deliveryRow(s, s.A.sessionId);
    expect(row).toMatchObject({ status: "released", releasedBy: "payment", sendCount: 2 });
    const fromPayment = (await allClientEmails()).slice(before);
    expect(fromPayment.map((m) => m.kind)).toEqual(["delivery.ready"]);
    expect(fromPayment[0].html).toContain("Payment received: $180.00. Thank you.");
    // The team still hears about it.
    const team = await s.t.run(async (ctx) =>
      (await ctx.db.query("notifications").withIndex("by_org", (q) => q.eq("orgId", "studio_a")).take(200)).filter((r) => r.recipient === "owner@studio-a.example.com" && r.kind === "invoice.paid"),
    );
    expect(team).toHaveLength(1);
    expect((await s.t.query(api.sessionDelivery.page, { token: row.token }))!.state).toBe("unlocked");
  });

  it("G-15 with no delivery on the booking the invoice receipt still goes", async () => {
    const inv = await invoice(s.A.sessionId, "sent", 18000);
    await payOnline(inv);
    expect((await allClientEmails()).map((m) => m.subject)).toContain(`Payment received - invoice ${(await s.t.run(async (ctx) => await ctx.db.get(inv)))!.number}`);
  });

  it("G-16 balance invoice paid first, then Ready: released at once, no pay to unlock email", async () => {
    await finalFile(s);
    await payOnline(await invoice(s.A.sessionId, "sent", 18000));
    expect(await s.as(s.A.engineer).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId })).toEqual({ state: "released" });
    expect((await deliveryEmails(s, s.A.sessionId)).map((m) => m.kind)).toEqual(["delivery.ready"]);
    const st = await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId });
    expect(st).toMatchObject({ state: "released", balanceDue: false, balanceCents: 0 });
  });

  it("G-17 marking the invoice paid by hand releases the same way, with one email", async () => {
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    const inv = await invoice(s.A.sessionId, "sent", 18000);
    const before = (await allClientEmails()).length;
    await s.as(s.A.owner).mutation(api.invoices.setStatus, { id: inv, status: "paid", paymentMethod: "zelle" });
    expect((await deliveryRow(s, s.A.sessionId))[0]).toMatchObject({ status: "released", releasedBy: "payment" });
    const fromPayment = (await allClientEmails()).slice(before);
    expect(fromPayment.map((m) => m.kind)).toEqual(["delivery.ready"]);
    expect(fromPayment[0].html).toContain("Payment received: $180.00. Thank you.");
  });

  it("G-17 charging a saved card releases the same way", async () => {
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    const inv = await invoice(s.A.sessionId, "sent", 18000);
    await s.t.mutation(internal.cardOnFile._markFeePaid, { sessionId: s.A.sessionId, invoiceId: inv, amountCents: 18000, reference: "pi_card" });
    expect((await deliveryRow(s, s.A.sessionId))[0]).toMatchObject({ status: "released", releasedBy: "payment" });
    expect((await deliveryEmails(s, s.A.sessionId)).map((m) => m.kind)).toEqual(["delivery.pay", "delivery.ready"]);
  });

  it("G-18 a paid invoice smaller than what is owed does not release", async () => {
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    const inv = await invoice(s.A.sessionId, "sent", 10000);
    await payOnline(inv);
    const [row] = await deliveryRow(s, s.A.sessionId);
    expect(row.status).toBe("awaiting_payment");
    expect((await deliveryEmails(s, s.A.sessionId)).map((m) => m.kind)).toEqual(["delivery.pay"]);
    // The smaller invoice's receipt goes as usual.
    expect((await allClientEmails()).some((m) => m.kind === "invoice.paid")).toBe(true);
    // The page and the card show what is still owed, net of the invoice.
    expect(await s.t.query(api.sessionDelivery.page, { token: row.token })).toMatchObject({ state: "locked", balanceCents: 8000 });
    expect(await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId })).toMatchObject({ balanceDue: true, balanceCents: 8000 });
    expect(await s.t.mutation(api.sessionDelivery.refresh, { token: row.token })).toBeNull();
    expect((await deliveryRow(s, s.A.sessionId))[0].status).toBe("awaiting_payment");
  });

  it("G-18 a void invoice and a draft invoice count for nothing", async () => {
    await finalFile(s);
    await invoice(s.A.sessionId, "void", 18000);
    await invoice(s.A.sessionId, "draft", 18000);
    await invoice(s.A.sessionId, "sent", 18000);
    await invoice(s.A.sessionId, "overdue", 18000);
    expect(await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId })).toEqual({ state: "awaiting_payment" });
    const [row] = await deliveryRow(s, s.A.sessionId);
    expect(await s.t.run(async (ctx) => await onBalanceSettled(ctx, s.A.sessionId))).toBe(false);
    expect(await s.t.mutation(api.sessionDelivery.refresh, { token: row.token })).toBeNull();
    expect((await deliveryRow(s, s.A.sessionId))[0].status).toBe("awaiting_payment");
    expect(await s.t.query(api.sessionDelivery.page, { token: row.token })).toMatchObject({ balanceCents: 18000 });
  });

  it("G-18 an invoice from another studio naming this booking counts for nothing", async () => {
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    await invoice(s.A.sessionId, "paid", 18000, "studio_b");
    expect(await s.t.run(async (ctx) => await onBalanceSettled(ctx, s.A.sessionId))).toBe(false);
    expect((await deliveryRow(s, s.A.sessionId))[0].status).toBe("awaiting_payment");
  });

  it("G-18 a paid fee invoice on a cancelled booking delivers nothing", async () => {
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    const [row] = await deliveryRow(s, s.A.sessionId);
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.sessionId, { status: "cancelled" }); });
    const fee = await invoice(s.A.sessionId, "sent", 18000);
    await s.t.run(async (ctx) => { await ctx.db.patch(fee, { lineItems: [{ label: "Vocal tracking - late cancellation fee", amountCents: 18000 }] }); });
    await s.t.mutation(internal.cardOnFile._markFeePaid, { sessionId: s.A.sessionId, invoiceId: fee, amountCents: 18000, reference: "pi_fee" });
    expect((await deliveryRow(s, s.A.sessionId))[0].status).toBe("awaiting_payment");
    expect(await s.t.query(api.sessionDelivery.page, { token: row.token })).toBeNull();
    expect(await s.t.mutation(api.sessionDelivery.refresh, { token: row.token })).toBeNull();
    expect((await deliveryEmails(s, s.A.sessionId)).map((m) => m.kind)).toEqual(["delivery.pay"]);
  });

  it("G-19 the locked page's Pay button goes to the open invoice when one exists, to checkout only with no invoice, and nowhere while a draft waits (Addendum 3)", async () => {
    await cardsOn(s.t);
    const { token } = await waiting(s);
    const checkout = `${APP_URL}/book/studio-a/checkout/${s.A.sessionId}`;
    const onPage = async () => {
      const p = await s.t.query(api.sessionDelivery.page, { token });
      const st = await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId });
      expect(p!.balanceCents).toBe(18000);
      return { url: p!.payUrl, pay: st!.onlinePay, reason: st!.onlinePayReason };
    };
    expect(await onPage()).toEqual({ url: checkout, pay: "checkout", reason: null });
    await invoice(s.A.sessionId, "void", 18000);
    await invoice(s.A.otherSessionId, "sent", 20000); // another booking's open invoice
    expect(await onPage()).toEqual({ url: checkout, pay: "checkout", reason: null });
    // A draft is in play: the checkout no longer settles the booking's money
    // on its own, and the draft cannot be paid until it is sent.
    await invoice(s.A.sessionId, "draft", 18000);
    expect(await onPage()).toEqual({ url: null, pay: "none", reason: "invoice_not_sent" });
    for (const status of ["sent", "viewed", "overdue"] as const) {
      const open = await invoice(s.A.sessionId, status, 18000);
      expect(await onPage()).toEqual({ url: `${APP_URL}/pay/invoice/${open}`, pay: "invoice", reason: null });
      await s.t.run(async (ctx) => { await ctx.db.patch(open, { status: "void" }); });
    }
    expect(await onPage()).toEqual({ url: null, pay: "none", reason: "invoice_not_sent" });
  });

  it("G-20 a non-finite or negative rate never releases", async () => {
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    const [row] = await deliveryRow(s, s.A.sessionId);
    for (const rateCents of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
      await s.t.run(async (ctx) => { await ctx.db.patch(s.A.sessionId, { rateCents, amountPaidCents: 36000 }); });
      expect(await s.t.run(async (ctx) => await onBalanceSettled(ctx, s.A.sessionId))).toBe(false);
      expect(await s.t.mutation(api.sessionDelivery.refresh, { token: row.token })).toBeNull();
      await s.as(s.A.engineer).mutation(api.sessionDelivery.resend, { sessionId: s.A.sessionId }).catch(() => undefined);
      expect((await deliveryRow(s, s.A.sessionId))[0].status).toBe("awaiting_payment");
      const st = await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId });
      expect(st).toMatchObject({ balanceDue: true, balanceCents: null });
      expect(await s.t.query(api.sessionDelivery.page, { token: row.token })).toMatchObject({ state: "locked", balanceCents: null });
    }
    expect((await deliveryEmails(s, s.A.sessionId)).filter((m) => m.kind === "delivery.ready")).toHaveLength(0);
    // A booking with a broken price cannot send a pay email either.
    await finalFile(s, s.A.otherSessionId);
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.otherSessionId, { rateCents: Number.NaN }); });
    await expect(s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.otherSessionId })).rejects.toThrow(
      "This booking's price needs fixing first.",
    );
    expect(await deliveryRow(s, s.A.otherSessionId)).toEqual([]);
  });

  it("G-20 setComp refuses a non-finite amount and writes nothing", async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      await expect(s.as(s.A.owner).mutation(api.sessions.setComp, { id: s.A.sessionId, compType: "discounted", chargedCents: bad })).rejects.toThrow();
      await expect(s.as(s.A.owner).mutation(api.sessions.setComp, { id: s.A.sessionId, compType: "comped", listValueCents: bad })).rejects.toThrow();
    }
    const session = await s.t.run(async (ctx) => await ctx.db.get(s.A.sessionId));
    expect(session).toMatchObject({ rateCents: 36000 });
    expect(session!.compType).toBeUndefined();
  });

  it("F2-03 settleDeliveryQuietly swallows a failure, logs only its message and returns false", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = { db: { query: () => { throw new Error("boom"); } } } as unknown as Parameters<typeof settleDeliveryQuietly>[0];
    expect(await settleDeliveryQuietly(broken, s.A.sessionId)).toBe(false);
    expect(log).toHaveBeenCalledWith("[sessionDelivery] release failed:", "boom");
  });

  it("F2-03 every caller outside sessionDelivery.ts goes through the guarded helper", () => {
    const raw = import.meta.glob(["./*.ts", "./lib/*.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const direct = Object.entries(raw)
      .filter(([path]) => !path.includes(".test.") && !path.includes(".fixture.") && path !== "./sessionDelivery.ts")
      .filter(([, text]) => /\bonBalanceSettled\b/.test(text))
      .map(([path]) => path);
    expect(direct).toEqual([]);
    const callers = Object.entries(raw)
      .filter(([path, text]) => path !== "./sessionDelivery.ts" && !path.includes(".test.") && /settleDelivery(Quietly|ForInvoice)\(/.test(text))
      .map(([path]) => path)
      .sort();
    expect(callers).toEqual(["./cardOnFile.ts", "./invoicePay.ts", "./invoices.ts", "./packages.ts", "./payments.ts", "./sessions.ts"]);
  });

  it("F2-03 a payment that leaves nothing owed through invoices plus a deposit releases (no stale caller check)", async () => {
    await finalFile(s, s.A.otherSessionId);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.otherSessionId });
    // $100 of the $200 paid by invoice; then the $100 deposit is recorded.
    await payOnline(await invoice(s.A.otherSessionId, "sent", 10000));
    await settle(s, s.A.otherSessionId, "deposit");
    expect((await deliveryRow(s, s.A.otherSessionId))[0]).toMatchObject({ status: "released" });
    expect((await deliveryEmails(s, s.A.otherSessionId)).map((m) => m.kind)).toEqual(["delivery.pay", "delivery.ready"]);
  });
});

/* ── F2-02: erasing a client turns their links off ─────────────── */

describe("session delivery: erasure (F2-02)", () => {
  let s: S;
  beforeEach(async () => { r2Env(); s = await setupStudios(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("A-16 erasing a client turns their link off and the old link answers like an unknown one", async () => {
    const r = await released(s);
    // A second booking of the same client, waiting for payment.
    await finalFile(s, s.A.otherSessionId);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.otherSessionId });
    const [waitingRow] = await deliveryRow(s, s.A.otherSessionId);
    const unknown = await s.t.query(api.sessionDelivery.page, { token: "e".repeat(64) });

    await s.as(s.A.owner).mutation(api.dataRights.eraseArtist, { artistId: s.A.artistId });

    for (const [sessionId, oldToken] of [[s.A.sessionId, r.token], [s.A.otherSessionId, waitingRow.token]] as const) {
      const [row] = await deliveryRow(s, sessionId);
      expect(row.status).toBe("off");
      expect(row.offAt).toBeGreaterThan(0);
      expect(row.token).not.toBe(oldToken);
      expect(row.token).toMatch(/^[0-9a-f]{64}$/);
      expect(row.sentTo).toBe("[erased]");
      expect(await s.t.query(api.sessionDelivery.page, { token: oldToken })).toEqual(unknown);
      expect(await s.t.query(api.sessionDelivery.page, { token: row.token })).toEqual(unknown);
      expect(await s.t.mutation(api.sessionDelivery.refresh, { token: oldToken })).toBeNull();
      expect(await s.t.mutation(api.sessionDelivery.opened, { token: oldToken })).toBeNull();
      expect(await s.as(s.A.owner).query(api.sessionDelivery.link, { sessionId })).toBeNull();
    }
    await expect(s.t.mutation(api.sessionDelivery.fileUrl, { token: r.token, versionId: r.a.versionId })).rejects.toThrow(NOT_AVAILABLE);
    // A payment afterwards releases nothing.
    await settle(s, s.A.otherSessionId, "full");
    expect((await deliveryRow(s, s.A.otherSessionId))[0].status).toBe("off");
  });

  it("F2-02 erasure also revokes the client's portal links (the same class: a live credential left behind)", async () => {
    const grants = await s.t.run(async (ctx) => {
      const base = { orgId: "studio_a", capabilities: ["songs.read"], expiresAt: Date.now() + 86_400_000, invitedBy: "u_owner", useCount: 0 };
      return {
        portal: await ctx.db.insert("collaboratorGrants", { ...base, email: "jordan.ellis@example.com", name: "Jordan Ellis", scope: "artist_portal", entityId: s.A.artistId, token: "portal-token" }),
        byEmail: await ctx.db.insert("collaboratorGrants", { ...base, email: "Jordan.Ellis@example.com", name: "Jordan Ellis", scope: "session", entityId: s.A.sessionId, token: "session-token" }),
        someoneElse: await ctx.db.insert("collaboratorGrants", { ...base, email: "producer@example.com", name: "Pat Producer", scope: "session", entityId: s.A.sessionId, token: "other-token" }),
        otherStudio: await ctx.db.insert("collaboratorGrants", { ...base, orgId: "studio_b", email: "jordan.ellis@example.com", name: "Jordan Ellis", scope: "session", entityId: s.B.sessionId, token: "b-token" }),
      };
    });
    await s.as(s.A.owner).mutation(api.dataRights.eraseArtist, { artistId: s.A.artistId });
    const after = await s.t.run(async (ctx) => ({
      portal: await ctx.db.get(grants.portal),
      byEmail: await ctx.db.get(grants.byEmail),
      someoneElse: await ctx.db.get(grants.someoneElse),
      otherStudio: await ctx.db.get(grants.otherStudio),
    }));
    expect(after.portal!.revoked).toBe(true);
    expect(after.byEmail!.revoked).toBe(true);
    expect(after.someoneElse!.revoked).toBeUndefined();
    expect(after.otherStudio!.revoked).toBeUndefined();
  });
});

describe("session delivery: erasure reads grants through bounded indexes (V3-04)", () => {
  let s: S;
  beforeEach(async () => { r2Env(); s = await setupStudios(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("V3-04 eraseArtist never collects collaboratorGrants; every grant read is an index narrowed to this client with a bound", () => {
    const raw = import.meta.glob("./dataRights.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const src = raw["./dataRights.ts"];
    const reads = src.split('query("collaboratorGrants")').slice(1).map((rest) => rest.slice(0, rest.search(/\)\s*;|\)\s*,|\)\s*\]/) + 1));
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) {
      expect(r, r).not.toContain(".collect()");
      expect(r, r).toMatch(/\.take\(/);
      expect(r, r).toMatch(/withIndex\("by_(entity|org_email)"/);
    }
  });

  it("V3-04 erasure revokes every grant of the client, past the first page, and no one else's", async () => {
    const base = { orgId: "studio_a", capabilities: ["songs.read"], expiresAt: Date.now() + 86_400_000, invitedBy: "u_owner", useCount: 0, name: "x" };
    const ids = await s.t.run(async (ctx) => {
      const mine: Id<"collaboratorGrants">[] = [];
      const others: Id<"collaboratorGrants">[] = [];
      // 130 portal links on the client (more than one page of reads).
      for (let i = 0; i < 130; i++) mine.push(await ctx.db.insert("collaboratorGrants", { ...base, email: "jordan.ellis@example.com", scope: "artist_portal", entityId: s.A.artistId, token: `p${i}` }));
      // Addressed to the client's email on someone else's song, exact and padded.
      mine.push(await ctx.db.insert("collaboratorGrants", { ...base, email: "jordan.ellis@example.com", scope: "song", entityId: "song_of_someone_else", token: "e1" }));
      // Any letter case, on the client's own booking.
      mine.push(await ctx.db.insert("collaboratorGrants", { ...base, email: "JORDAN.Ellis@example.com ", scope: "session", entityId: s.A.otherSessionId, token: "e2" }));
      // 150 grants for other people in the studio, and one in another studio.
      for (let i = 0; i < 150; i++) others.push(await ctx.db.insert("collaboratorGrants", { ...base, email: `guest${i}@example.com`, scope: "session", entityId: s.A.sessionId, token: `o${i}` }));
      others.push(await ctx.db.insert("collaboratorGrants", { ...base, orgId: "studio_b", email: "jordan.ellis@example.com", scope: "session", entityId: s.B.sessionId, token: "b1" }));
      return { mine, others };
    });
    await s.as(s.A.owner).mutation(api.dataRights.eraseArtist, { artistId: s.A.artistId });
    const after = await s.t.run(async (ctx) => ({
      mine: await Promise.all(ids.mine.map((id) => ctx.db.get(id))),
      others: await Promise.all(ids.others.map((id) => ctx.db.get(id))),
    }));
    expect(after.mine.filter((g) => g!.revoked !== true)).toEqual([]);
    expect(after.others.filter((g) => g!.revoked === true)).toEqual([]);
  });
});

describe("session delivery: who the client is greeted as (V3-02) and the title (V3-06)", () => {
  let s: S;
  beforeEach(async () => { r2Env(); s = await setupStudios(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("V3-02 greetingName: a person by first name, a band, label or other client by the whole name", () => {
    const g = (name: string, type: Doc<"artists">["type"]) => greetingName({ name, type });
    expect(g("Jordan Ellis", "artist")).toBe("Jordan");
    expect(g("  Jordan   Ellis ", "producer")).toBe("Jordan");
    expect(g("Sam Rivera", "songwriter")).toBe("Sam");
    expect(g("The Midnight Tape", "band")).toBe("The Midnight Tape");
    expect(g("The Midnight Tape", "artist")).toBe("The Midnight Tape");
    expect(g("A Tribe Of Two", "artist")).toBe("A Tribe Of Two");
    expect(g("An Echo", "artist")).toBe("An Echo");
    expect(g("Crosstown Records", "label")).toBe("Crosstown Records");
    expect(g("Crosstown Records", "other")).toBe("Crosstown Records");
    expect(g("Midnight Tape", "band")).toBe("Midnight Tape");
    expect(g("Prince", "artist")).toBe("Prince");
    expect(g("", "artist")).toBe("");
    expect(g("   ", "band")).toBe("");
    expect(greetingName(null)).toBe("");
  });

  it("R4-05 greetingName: a stage name or a short first word is greeted whole; an erased client is not greeted", () => {
    const g = (name: string, type: Doc<"artists">["type"] = "artist", erasedAt?: number) => greetingName({ name, type, erasedAt });
    expect(g("Jordan Ellis")).toBe("Jordan");
    expect(g("Jordan Lee Ellis")).toBe("Jordan");
    for (const name of ["Lil Baby", "DJ Premier", "MC Lyte", "The Midnight Tape", "Prince", "Big Sean", "Young Thug", "Yung Gravy",
      "Dr. Dre", "Dr Dre", "Mr. Eazi", "Mrs. Green Apple", "Ms. Lauryn Hill", "Sir Mix", "King Princess", "Queen Latifah", "Saint Jhn",
      "St. Vincent", "St Vincent", "A Boogie", "An Echo", "dj premier", "LIL BABY", "Jo Smith", "Ty Dolla Sign", "Jordan Lee Ellis Smith"]) {
      expect(g(name), name).toBe(name);
    }
    expect(g("Crosstown Records", "label")).toBe("Crosstown Records");
    expect(g("Crosstown Records", "other")).toBe("Crosstown Records");
    expect(g("Midnight Tape", "band")).toBe("Midnight Tape");
    expect(g("Sam Rivera", "producer")).toBe("Sam");
    // Whole first words only: "Drake" and "Kingston" are not "dr" and "king".
    expect(g("Drake Graham")).toBe("Drake");
    expect(g("Kingston Rhodes")).toBe("Kingston");
    expect(g("Stella Mae")).toBe("Stella");
    expect(g("Jordan Ellis", "artist", Date.now())).toBe("");
    expect(g("Erased client a1b2c3", "artist", Date.now())).toBe("");
  });

  it("R5-04 greetingName: a name with a comma is greeted whole; the first word is matched and returned without punctuation", () => {
    const g = (name: string, type: Doc<"artists">["type"] = "artist") => greetingName({ name, type });
    for (const name of ["Tyler, The Creator", "Ellis, Jordan", "Jordan, Ellis", "Lil' Kim", "Lil, Kim", "Earth, Wind", "\u201cLil\u201d Kim", "Dr.. Dre", "(DJ) Premier"]) {
      expect(g(name), name).toBe(name);
    }
    expect(g("Ellis, Jordan", "producer")).toBe("Ellis, Jordan");
    expect(g("Jordan Ellis")).toBe("Jordan");
    // Punctuation around a real first name is not part of the greeting.
    expect(g("\"Jordan\" Ellis")).toBe("Jordan");
    expect(g("Jordan! Ellis")).toBe("Jordan");
    // Letters other than A to Z still count as letters.
    expect(g("Zoë Kravitz")).toBe("Zoë");
    expect(g("José Gonzalez")).toBe("José");
    // Nothing but punctuation left: the whole name.
    expect(g("... Ellis")).toBe("... Ellis");
  });

  it("R4-05 an erased client is greeted by no name on the card", async () => {
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.artistId, { name: "Erased client abc123", erasedAt: Date.now() }); });
    expect(await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId })).toMatchObject({ clientFirstName: "" });
  });

  it("V3-02 a band is greeted by its whole name on the card, in both emails and on the page", async () => {
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.artistId, { name: "The Midnight Tape", type: "band" }); });
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    expect(await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId })).toMatchObject({ clientFirstName: "The Midnight Tape" });
    const [row] = await deliveryRow(s, s.A.sessionId);
    expect((await s.t.query(api.sessionDelivery.page, { token: row.token }))!.clientFirstName).toBe("The Midnight Tape");
    await settle(s, s.A.sessionId, "balance");
    const mails = await deliveryEmails(s, s.A.sessionId);
    expect(mails.map((m) => m.kind)).toEqual(["delivery.pay", "delivery.ready"]);
    expect(mails[0].html).toContain("Your files are finished, The Midnight Tape</h1>");
    expect(mails[1].html).toContain("Your files are ready, The Midnight Tape</h1>");
    for (const m of mails) expect(m.body).not.toMatch(/, The\n/);
  });

  it("V3-02 a label is greeted as itself; a person still by first name", async () => {
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.artistId, { name: "Crosstown Records", type: "label" }); });
    expect(await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId })).toMatchObject({ clientFirstName: "Crosstown Records" });
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.artistId, { name: "Jordan Ellis", type: "artist" }); });
    expect(await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId })).toMatchObject({ clientFirstName: "Jordan" });
  });

  it("V3-06 a booking titled Writing session: the emails say it once, and the log copy has a blank line after the heading", async () => {
    await s.t.run(async (ctx) => { await ctx.db.patch(s.A.sessionId, { title: "Writing session" }); });
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    await settle(s, s.A.sessionId, "balance");
    const mails = await deliveryEmails(s, s.A.sessionId);
    expect(mails).toHaveLength(2);
    for (const m of mails) {
      expect(m.html!.toLowerCase()).not.toContain("session session");
      expect(m.body.toLowerCase()).not.toContain("session session");
      expect(m.body).toMatch(/^Your files are (finished|ready), Jordan\n\nYour Writing session|^Your files are (finished|ready), Jordan\n\nEverything from your Writing session on/);
    }
  });
});

/* ── F2-05: the Final flag does not follow a file to another booking ── */

describe("session delivery: moving a file (F2-05)", () => {
  let s: S;
  beforeEach(async () => { r2Env(); s = await setupStudios(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("A-17 a Final file moved to another booking is no longer Final", async () => {
    const r = await released(s);
    await s.as(s.A.owner).mutation(api.mediaLibrary.updateAsset, { assetId: r.a.assetId, sessionId: s.A.otherSessionId });
    const moved = await s.t.run(async (ctx) => await ctx.db.get(r.a.assetId));
    expect(moved).toMatchObject({ sessionId: s.A.otherSessionId });
    expect(moved!.clientFinal).not.toBe(true);
    // Gone from the old booking's page and refused by fileUrl.
    expect((await s.t.query(api.sessionDelivery.page, { token: r.token }))!.files.map((f) => f.versionId)).toEqual([r.b.versionId]);
    await expect(s.t.mutation(api.sessionDelivery.fileUrl, { token: r.token, versionId: r.a.versionId })).rejects.toThrow(NOT_AVAILABLE);
    // Not a Final file of the new booking either.
    expect(await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.otherSessionId })).toMatchObject({ finalCount: 0 });

    // Taken off any booking: also cleared.
    await s.as(s.A.owner).mutation(api.mediaLibrary.updateAsset, { assetId: r.b.assetId, sessionId: null });
    expect((await s.t.run(async (ctx) => await ctx.db.get(r.b.assetId)))!.clientFinal).not.toBe(true);
  });

  it("A-17 editing a Final file without moving it keeps it Final", async () => {
    const r = await released(s);
    await s.as(s.A.owner).mutation(api.mediaLibrary.updateAsset, { assetId: r.a.assetId, name: "Lead vocal (final).wav", tags: ["final"] });
    await s.as(s.A.owner).mutation(api.mediaLibrary.updateAsset, { assetId: r.a.assetId, sessionId: s.A.sessionId });
    expect((await s.t.run(async (ctx) => await ctx.db.get(r.a.assetId)))!.clientFinal).toBe(true);
  });
});

/* ── F2-06: resend is throttled ─────────────────────────────── */

describe("session delivery: resend throttle (F2-06)", () => {
  let s: S;
  beforeEach(async () => { r2Env(); s = await setupStudios(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("A-18 resend within 2 minutes of the last send is refused and sends nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = Date.now();
    vi.setSystemTime(t0);
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    const tooSoon = "Sent a moment ago. Try again in a couple of minutes.";
    vi.setSystemTime(t0 + 119_000);
    await expect(s.as(s.A.engineer).mutation(api.sessionDelivery.resend, { sessionId: s.A.sessionId })).rejects.toThrow(tooSoon);
    expect((await deliveryRow(s, s.A.sessionId))[0]).toMatchObject({ sendCount: 1, lastSentAt: t0 });
    expect(await deliveryEmails(s, s.A.sessionId)).toHaveLength(1);
    vi.setSystemTime(t0 + 120_000);
    await s.as(s.A.engineer).mutation(api.sessionDelivery.resend, { sessionId: s.A.sessionId });
    expect((await deliveryRow(s, s.A.sessionId))[0]).toMatchObject({ sendCount: 2, lastSentAt: t0 + 120_000 });
    // And again straight after: refused.
    await expect(s.as(s.A.owner).mutation(api.sessionDelivery.resend, { sessionId: s.A.sessionId })).rejects.toThrow(tooSoon);
    expect(await deliveryEmails(s, s.A.sessionId)).toHaveLength(2);
  });
});

/* ── F2-07: the read cap applies to Final files, not to every file ── */

describe("session delivery: many working files (F2-07)", () => {
  let s: S;
  beforeEach(async () => { r2Env(); s = await setupStudios(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("F2-07 a booking with 205 working files and 3 Final files lists all 3", async () => {
    await s.t.run(async (ctx) => {
      for (let i = 0; i < 205; i++) {
        await ctx.db.insert("mediaAssets", {
          orgId: "studio_a", name: `Take ${i}.wav`, kind: "session", tags: [], sessionId: s.A.sessionId,
          currentVersion: 1, versionCount: 1, totalBytes: 1000, searchText: `take ${i}`, createdBy: "Eli Engineer",
          createdAt: Date.now(), updatedAt: Date.now(),
        });
      }
    });
    const finals = [];
    for (const name of ["Master.wav", "Stems.zip", "Notes.pdf"]) finals.push(await finalFile(s, s.A.sessionId, name));
    await settle(s, s.A.sessionId, "balance");
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    const [row] = await deliveryRow(s, s.A.sessionId);
    const p = await s.t.query(api.sessionDelivery.page, { token: row.token });
    expect(p!.files.map((f) => f.name).sort()).toEqual(["Master.wav", "Notes.pdf", "Stems.zip"]);
    expect(await s.as(s.A.owner).query(api.sessionDelivery.status, { sessionId: s.A.sessionId })).toMatchObject({ finalCount: 3 });
    const mail = (await deliveryEmails(s, s.A.sessionId))[0];
    for (const name of ["Master.wav", "Notes.pdf", "Stems.zip"]) expect(mail.html).toContain(name);
  });
});

describe("session delivery: dates in the studio's zone (F2-10)", () => {
  let s: S;
  beforeEach(async () => { r2Env(); s = await setupStudios(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("C-13 a session at 11 PM Pacific shows the same date in the email and on the page", async () => {
    // 11 PM on November 10 in Los Angeles is already November 11 in UTC.
    const elevenPmPacific = Date.UTC(2026, 10, 11, 7, 0);
    await s.t.run(async (ctx) => {
      const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "studio_a")).first();
      await ctx.db.patch(org!._id, { timezone: "America/Los_Angeles" });
      await ctx.db.patch(s.A.sessionId, { startTime: elevenPmPacific, endTime: elevenPmPacific + 3_600_000 });
    });
    const { token, row } = await released(s);
    // 10 PM on December 13 in Los Angeles is December 14 in UTC.
    const expiresAt = Date.UTC(2026, 11, 14, 6, 0);
    await s.t.run(async (ctx) => { await ctx.db.patch(row._id, { expiresAt }); });

    const mail = (await deliveryEmails(s, s.A.sessionId))[0];
    expect(mail.html).toContain("November 10");
    expect(mail.html).not.toContain("November 11");

    const p = await s.t.query(api.sessionDelivery.page, { token });
    expect(p!.booking.dateLabel).toBe("November 10, 2026");
    expect(p!.expiresLabel).toBe("Dec 13, 2026");
  });
});
