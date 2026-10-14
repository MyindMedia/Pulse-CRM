import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* Booking requests + approval (bookingFeatures.requireApproval) and the
   booking link without prices (bookingFeatures.hidePricing).
   docs/plans/hardcover-booking.md, features A and B. */

const HOUR = 3_600_000;
const DAY = 86_400_000;
const ORG = "org_hb";

type Features = { hidePricing?: boolean; requireApproval?: boolean };

async function studio(t: ReturnType<typeof convexTest>, features?: Features) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: ORG,
      name: "Hardcover",
      slug: "hardcover",
      tier: "growth",
      status: "active",
      ownerEmail: "owner@hc.test",
      depositPolicyText: "30% deposit holds your slot.",
      directoryListed: true,
      contact: { address: "1 Sunset Blvd, Los Angeles", phone: "+13105550100" },
      ...(features ? { bookingFeatures: features } : {}),
    } as never);
    await ctx.db.insert("members", { orgId: ORG, name: "Olive Owner", role: "owner", email: "owner@hc.test", clerkUserId: "u_owner", skills: [] } as never);
    await ctx.db.insert("members", { orgId: ORG, name: "Max Manager", role: "manager", email: "mgr@hc.test", clerkUserId: "u_mgr", skills: [] } as never);
    const eng = await ctx.db.insert("members", { orgId: ORG, name: "Eve Engineer", role: "engineer", email: "eng@hc.test", clerkUserId: "u_eng", skills: [] } as never);
    const room = await ctx.db.insert("rooms", {
      orgId: ORG, name: "Room A", status: "available", bookable: true,
      hourlyRateCents: 10000, minimumHours: 1, depositPct: 30,
    } as never);
    const mic = await ctx.db.insert("equipment", {
      orgId: ORG, name: "Neumann U47", category: "mic", status: "available",
      quantity: 1, purchaseCents: 800000, currentValueCents: 600000,
      rentable: true, rentalPriceCents: 7500, installedInRoomId: room,
    } as never);
    const fee = await ctx.db.insert("feeTemplates", {
      orgId: ORG, label: "Podcast edit", amountCents: 5000, active: true, createdAt: Date.now(),
    } as never);
    const svc = await ctx.db.insert("bookableServices", {
      orgId: ORG, name: "Podcast", roomId: room, pricingMode: "hourly", priceCents: 8000,
      active: true, order: 0, addOnFeeIds: [fee], createdAt: Date.now(),
    } as never);
    return { room: room as Id<"rooms">, mic: mic as Id<"equipment">, eng: eng as Id<"members">, svc: svc as Id<"bookableServices">, fee: fee as Id<"feeTemplates"> };
  });
}

function book(t: ReturnType<typeof convexTest>, roomId: Id<"rooms">, extra: Record<string, unknown> = {}) {
  return t.mutation(api.booking.createBooking, {
    roomId,
    clientName: "Nova Client",
    clientEmail: "nova@x.test",
    clientPhone: "(310) 555-0199",
    startTime: Date.now() + 7 * DAY,
    durationHours: 2,
    ...extra,
  } as never);
}

async function notes(t: ReturnType<typeof convexTest>, sessionId: Id<"sessions">) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("notifications").collect()).filter((n) => n.sessionId === sessionId),
  );
}

/** Every key anywhere in a value that carries a price, rate, deposit or
 *  payment amount. */
function moneyKeys(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => moneyKeys(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
      const here = `${path}.${k}`;
      const bad =
        /cents$/i.test(k) ||
        /^(price|rate|deposit(?!Policy)|paymentMode|paid|balance|fullyPaid|discount|payments)/i.test(k) ||
        (k === "depositPolicy" && v !== null) ||
        (k === "pct" && v !== undefined);
      return [...(bad ? [here] : []), ...moneyKeys(v, here)];
    });
  }
  return [];
}

describe("booking requests: requireApproval", () => {
  it("lands pending with no hold expiry, holds the slot, and tells booker + owners/managers", async () => {
    const t = convexTest(schema);
    const { room } = await studio(t, { requireApproval: true });
    const res = await book(t, room);
    const s = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(s?.requestStatus).toBe("pending");
    expect(s?.status).toBe("tentative");
    expect(s?.holdExpiresAt).toBeUndefined();
    // Prices shown: the deposit is still asked for as today.
    expect(s?.depositCents).toBe(6000);
    expect(s?.pricingHidden).toBeUndefined();

    const rows = await notes(t, res.sessionId);
    const kinds = rows.map((n) => `${n.kind}:${n.channel}:${n.recipient}`).sort();
    expect(kinds).toContain("booking.request_received:email:nova@x.test");
    expect(kinds).toContain("booking.request_received:sms:+13105550199");
    expect(kinds).toContain("booking.request_staff:email:owner@hc.test");
    expect(kinds).toContain("booking.request_staff:email:mgr@hc.test");
    // The engineer is not an approver.
    expect(kinds).not.toContain("booking.request_staff:email:eng@hc.test");
    expect(rows.some((n) => n.kind === "booking.held")).toBe(false);
    // Prices shown: the request email carries the deposit pay link.
    const mail = rows.find((n) => n.kind === "booking.request_received" && n.channel === "email");
    expect(mail?.body).toContain("/checkout/");

    // The pending request holds the slot.
    await expect(book(t, room, { startTime: s!.startTime + HOUR, clientEmail: "b@x.test" })).rejects.toThrow(/taken/);
  });

  it("automation never releases a pending request, even with a stale hold stamp", async () => {
    const t = convexTest(schema);
    const { room } = await studio(t, { requireApproval: true });
    const res = await book(t, room);
    // Safety net: pretend an old hold window leaked onto the request.
    await t.run((ctx) => ctx.db.patch(res.sessionId, { holdExpiresAt: Date.now() - HOUR }));
    await t.mutation(internal.automation.tick, {});
    const s = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(s?.status).toBe("tentative");
    expect(s?.requestStatus).toBe("pending");
  });

  it("paying the deposit does not confirm a pending request", async () => {
    const t = convexTest(schema);
    const { room } = await studio(t, { requireApproval: true });
    const res = await book(t, room);
    await t.withIdentity({ subject: "u_mgr", orgId: ORG }).mutation(api.payments.record, {
      sessionId: res.sessionId, kind: "deposit",
    });
    const s = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(s?.status).toBe("tentative");
    expect(s?.depositPaid).toBe(true);
    expect(s?.requestStatus).toBe("pending");
  });

  it("engineers cannot approve or decline, or list requests; managers can", async () => {
    const t = convexTest(schema);
    const { room } = await studio(t, { requireApproval: true });
    const res = await book(t, room);
    const asEng = t.withIdentity({ subject: "u_eng", orgId: ORG });
    await expect(asEng.mutation(api.bookingRequests.approve, { sessionId: res.sessionId })).rejects.toThrow();
    await expect(asEng.mutation(api.bookingRequests.decline, { sessionId: res.sessionId })).rejects.toThrow();
    await expect(asEng.query(api.bookingRequests.pending, {})).rejects.toThrow();
    // An engineer cannot sidestep approval with a plain status change either.
    await expect(asEng.mutation(api.sessions.setStatus, { id: res.sessionId, status: "confirmed" })).rejects.toThrow(/request/);

    const asMgr = t.withIdentity({ subject: "u_mgr", orgId: ORG });
    const list = await asMgr.query(api.bookingRequests.pending, {});
    expect(list).toHaveLength(1);
    expect(list[0].clientName).toBe("Nova Client");
    expect(list[0].roomName).toBe("Room A");
  });

  it("approving with the deposit still owed keeps it tentative and sends the pay link", async () => {
    const t = convexTest(schema);
    const { room } = await studio(t, { requireApproval: true });
    const res = await book(t, room);
    const asMgr = t.withIdentity({ subject: "u_mgr", orgId: ORG });
    const out = await asMgr.mutation(api.bookingRequests.approve, { sessionId: res.sessionId });
    expect(out.depositDue).toBe(true);
    let s = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(s?.requestStatus).toBe("approved");
    expect(s?.status).toBe("tentative");
    expect(s?.requestDecidedBy).toBeDefined();
    expect(s?.requestDecidedAt).toBeDefined();
    const approved = (await notes(t, res.sessionId)).filter((n) => n.kind === "booking.request_approved");
    expect(approved.map((n) => n.channel).sort()).toEqual(["email", "sms"]);
    expect(approved.find((n) => n.channel === "email")?.body).toContain("/checkout/");

    // The deposit landing now confirms it through the normal path.
    await asMgr.mutation(api.payments.record, { sessionId: res.sessionId, kind: "deposit" });
    s = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(s?.status).toBe("confirmed");
  });

  it("approving once the deposit is paid confirms and sends date, room, engineer, address and phone", async () => {
    const t = convexTest(schema);
    const { room, eng } = await studio(t, { requireApproval: true });
    const res = await book(t, room, { engineerId: eng });
    const asOwner = t.withIdentity({ subject: "u_owner", orgId: ORG });
    await asOwner.mutation(api.payments.record, { sessionId: res.sessionId, kind: "deposit" });
    const out = await asOwner.mutation(api.bookingRequests.approve, { sessionId: res.sessionId });
    expect(out.status).toBe("confirmed");
    const s = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(s?.status).toBe("confirmed");
    const mail = (await notes(t, res.sessionId)).find(
      (n) => n.kind === "booking.request_approved" && n.channel === "email",
    );
    expect(mail?.body).toContain("Room: Room A");
    expect(mail?.body).toContain("Engineer: Eve Engineer");
    expect(mail?.body).toContain("Address: 1 Sunset Blvd, Los Angeles");
    expect(mail?.body).toContain("Studio phone: +13105550100");
    expect(mail?.body).toMatch(/Date: /);
    // Decided once: a second approve is refused.
    await expect(asOwner.mutation(api.bookingRequests.approve, { sessionId: res.sessionId })).rejects.toThrow(/already/);
  });

  it("declining cancels, frees the slot, records the reason and tells the booker", async () => {
    const t = convexTest(schema);
    const { room } = await studio(t, { requireApproval: true });
    const res = await book(t, room);
    const asMgr = t.withIdentity({ subject: "u_mgr", orgId: ORG });
    const out = await asMgr.mutation(api.bookingRequests.decline, { sessionId: res.sessionId, reason: "We're closed for a private event." });
    expect(out.refundNeededCents).toBe(0);
    const s = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(s?.requestStatus).toBe("declined");
    expect(s?.status).toBe("cancelled");
    expect(s?.declineReason).toBe("We're closed for a private event.");
    const declined = (await notes(t, res.sessionId)).filter((n) => n.kind === "booking.request_declined");
    expect(declined.map((n) => n.channel).sort()).toEqual(["email", "sms"]);
    expect(declined.find((n) => n.channel === "email")?.body).toContain("private event");
    // Slot is open again.
    await expect(book(t, room, { startTime: s!.startTime, clientEmail: "b@x.test" })).resolves.toBeDefined();
    expect(await asMgr.query(api.bookingRequests.pending, {})).toHaveLength(1);
  });

  it("declining after a paid deposit reports the refund the studio owes", async () => {
    const t = convexTest(schema);
    const { room } = await studio(t, { requireApproval: true });
    const res = await book(t, room);
    const asMgr = t.withIdentity({ subject: "u_mgr", orgId: ORG });
    await asMgr.mutation(api.payments.record, { sessionId: res.sessionId, kind: "deposit" });
    const out = await asMgr.mutation(api.bookingRequests.decline, { sessionId: res.sessionId });
    expect(out.refundNeededCents).toBe(6000);
  });

  it("an engineer saying yes to a pending request does not confirm the booking", async () => {
    const t = convexTest(schema);
    const { room, eng } = await studio(t, { requireApproval: true });
    const res = await book(t, room, { engineerId: eng });
    await t.withIdentity({ subject: "u_eng", orgId: ORG }).mutation(api.sessions.respondToEngineerRequest, {
      sessionId: res.sessionId, accept: true,
    });
    const s = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(s?.engineerRequestStatus).toBe("confirmed");
    expect(s?.status).toBe("tentative");
    expect(s?.requestStatus).toBe("pending");
  });
});

describe("booking link without prices: hidePricing", () => {
  it("strips every price from every public query", async () => {
    const t = convexTest(schema);
    const { room, svc } = await studio(t, { hidePricing: true });
    const start = Date.now() + 7 * DAY;

    const front = await t.query(api.booking.studioFront, { slug: "hardcover" });
    expect(front?.pricingHidden).toBe(true);
    expect(front?.requiresApproval).toBe(true);
    expect(front?.rooms).toHaveLength(1);
    expect(moneyKeys(front)).toEqual([]);

    const r = await t.query(api.booking.room, { roomId: room });
    expect(r?.name).toBe("Room A");
    expect(r?.pricingHidden).toBe(true);
    expect(moneyKeys(r)).toEqual([]);

    const s = await t.query(api.booking.service, { serviceId: svc });
    expect(s?.addOns).toHaveLength(1);
    expect(moneyKeys(s)).toEqual([]);

    const opts = await t.query(api.booking.addOnOptions, { roomId: room, startTime: start, durationHours: 2 });
    expect(opts.gear).toHaveLength(1);
    expect(moneyKeys(opts)).toEqual([]);

    expect(await t.query(api.booking.validateCode, { roomId: room, code: "ANY" })).toEqual({ valid: false });

    const listing = await t.query(api.directory.listing, { slug: "hardcover" });
    expect(listing?.fromHourlyCents).toBeNull();
    const search = await t.query(api.directory.search, { maxHourlyCents: 1_000_000 });
    expect(search.listings.map((l) => l.slug)).not.toContain("hardcover");
  });

  it("stores the price for billing, lands as a pending request, and never sends money back", async () => {
    const t = convexTest(schema);
    const { room, mic, eng } = await studio(t, { hidePricing: true });
    const res = await book(t, room, { addOnEquipmentIds: [mic], engineerId: eng });
    expect(moneyKeys(res)).toEqual([]);
    expect(res.requestStatus).toBe("pending");

    const s = await t.run((ctx) => ctx.db.get(res.sessionId));
    // 2h x $100 + $75 mic, kept for the studio's own billing.
    expect(s?.rateCents).toBe(27500);
    expect(s?.depositCents).toBe(0);
    expect(s?.pricingHidden).toBe(true);
    // Approval is off, but nothing was paid: still a request.
    expect(s?.requestStatus).toBe("pending");
    expect(s?.holdExpiresAt).toBeUndefined();

    const page = await t.query(api.booking.booking, { sessionId: res.sessionId });
    expect(page?.requestStatus).toBe("pending");
    expect(page?.engineerName).toBe("Eve Engineer");
    expect(moneyKeys(page)).toEqual([]);

    // No checkout is ever opened for it.
    await expect(t.action(api.booking.payViaStripe, { sessionId: res.sessionId, kind: "full" })).rejects.toThrow();

    // Request email says nothing about a deposit.
    const mail = (await notes(t, res.sessionId)).find((n) => n.kind === "booking.request_received" && n.channel === "email");
    expect(mail?.body).not.toContain("/checkout/");
    expect(mail?.body).not.toMatch(/\$/);

    // Approving confirms it: no public deposit is owed.
    const out = await t.withIdentity({ subject: "u_mgr", orgId: ORG }).mutation(api.bookingRequests.approve, { sessionId: res.sessionId });
    expect(out.status).toBe("confirmed");
  });

  it("an engineer busy on their personal calendar cannot be requested", async () => {
    const t = convexTest(schema);
    const { room, eng } = await studio(t, { hidePricing: true });
    const start = Date.now() + 7 * DAY;
    await t.run(async (ctx) => {
      await ctx.db.insert("memberCalendars", {
        orgId: ORG, memberId: eng, googleEmail: "eve@gmail.test", refreshToken: "x",
        syncDirection: "two_way", connectedAt: Date.now(),
      });
      await ctx.db.insert("memberBusyBlocks", {
        orgId: ORG, memberId: eng, googleEventId: "ev1", startTime: start, endTime: start + 3 * HOUR, updatedAt: Date.now(),
      });
    });
    const opts = await t.query(api.booking.addOnOptions, { roomId: room, startTime: start, durationHours: 2 });
    expect(opts.engineers.find((e) => e.id === eng)?.available).toBe(false);
    await expect(book(t, room, { startTime: start, engineerId: eng })).rejects.toThrow(/Eve Engineer/);
  });
});

describe("switches off: today's behavior", () => {
  it("public booking is a 60-minute hold with prices, no request state", async () => {
    const t = convexTest(schema);
    const { room } = await studio(t);
    const front = await t.query(api.booking.studioFront, { slug: "hardcover" });
    expect(front?.pricingHidden).toBe(false);
    expect(front?.requiresApproval).toBe(false);
    expect(front?.rooms[0].hourlyRateCents).toBe(10000);
    expect(front?.rooms[0].depositPct).toBe(30);
    expect(front?.org.depositPolicy).toBe("30% deposit holds your slot.");
    const r = await t.query(api.booking.room, { roomId: room });
    expect(r?.hourlyRateCents).toBe(10000);
    expect(r?.paymentMode).toBe("deposit");

    const res = await book(t, room);
    expect(res).not.toHaveProperty("requestStatus");
    expect(res.depositCents).toBe(6000);
    const s = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(s?.requestStatus).toBeUndefined();
    expect(s?.pricingHidden).toBeUndefined();
    expect(s?.holdExpiresAt).toBeGreaterThan(Date.now());
    const kinds = (await notes(t, res.sessionId)).map((n) => n.kind);
    expect(kinds).toContain("booking.held");
    expect(kinds).toContain("booking.created");
    expect(kinds.some((k) => k.startsWith("booking.request"))).toBe(false);
    // Paying the deposit confirms, as today.
    await t.withIdentity({ subject: "u_mgr", orgId: ORG }).mutation(api.payments.record, { sessionId: res.sessionId, kind: "deposit" });
    expect((await t.run((ctx) => ctx.db.get(res.sessionId)))?.status).toBe("confirmed");
  });

  it("an unpaid hold still releases on schedule", async () => {
    const t = convexTest(schema);
    const { room } = await studio(t);
    const res = await book(t, room);
    await t.run((ctx) => ctx.db.patch(res.sessionId, { holdExpiresAt: Date.now() - HOUR }));
    await t.mutation(internal.automation.tick, {});
    expect((await t.run((ctx) => ctx.db.get(res.sessionId)))?.status).toBe("cancelled");
  });

  it("approve refuses a booking that is not a request", async () => {
    const t = convexTest(schema);
    const { room } = await studio(t);
    const res = await book(t, room);
    await expect(
      t.withIdentity({ subject: "u_mgr", orgId: ORG }).mutation(api.bookingRequests.approve, { sessionId: res.sessionId }),
    ).rejects.toThrow(/already been decided/);
  });
});
