import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { settlePayment } from "./payments";
import { onBalanceSettled, LINK_TTL_MS } from "./sessionDelivery";
import { r2Env, setupStudios, uploadSessionFile, clientEmails, APP_URL } from "./testing/sessionDelivery.fixture";

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
      ctaLabel: "Download your files", ctaUrl: `${APP_URL}/delivery/${row.token}`, accent: "#3b63e6", sessionId: s.A.sessionId,
    });
    expect(mails[0].html).toContain("Lead vocal.wav");
  });

  it("G-02 Ready first, then paid: one pay to unlock email, then one files ready email when the payment settles", async () => {
    await finalFile(s);
    expect(await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId })).toEqual({ state: "awaiting_payment" });
    let mails = await deliveryEmails(s, s.A.sessionId);
    expect(mails.map((m) => m.kind)).toEqual(["delivery.pay"]);
    expect(mails[0]).toMatchObject({ subject: "Your files are ready. One step left", ctaLabel: "Pay $180 and unlock" });
    await settle(s, s.A.sessionId, "balance");
    mails = await deliveryEmails(s, s.A.sessionId);
    expect(mails.map((m) => m.kind)).toEqual(["delivery.pay", "delivery.ready"]);
    expect(mails[1].body).toContain("Payment received: $180. Thank you.");
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
    await finalFile(s);
    await s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.sessionId });
    await settle(s, s.A.sessionId, "balance", "stripe");
    expect((await deliveryRow(s, s.A.sessionId))[0]).toMatchObject({ status: "released", releasedBy: "payment" });
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
    await finalFile(s, s.A.otherSessionId);
    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.A.otherSessionId, { status: "cancelled" });
      await ctx.db.patch(s.A.sessionId, { status: "cancelled", amountPaidCents: 36000 });
    });
    await expect(s.as(s.A.owner).mutation(api.sessionDelivery.markReady, { sessionId: s.A.otherSessionId })).rejects.toThrow(
      "This booking was released.",
    );
    expect(await s.t.run(async (ctx) => await onBalanceSettled(ctx, s.A.sessionId))).toBe(false);
    expect((await deliveryRow(s, s.A.sessionId))[0].status).toBe("awaiting_payment");
    await expect(s.as(s.A.owner).mutation(api.sessionDelivery.releaseNow, { sessionId: s.A.sessionId })).rejects.toThrow();
    expect((await deliveryEmails(s, s.A.sessionId)).map((m) => m.kind)).toEqual(["delivery.pay"]);
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
