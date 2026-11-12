import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* truth-autocancel-studio-billed: a request from a booking link without prices
   is billed by the studio itself. Once approved it is confirmed with nothing
   paid in Pulse, and the booking automation used to send the client a pay link
   that does not open (T-4h) and then cancel the booking (T-2h). Pulse never
   auto-cancels a studio-billed booking; the team gets one heads-up instead. */

const HOUR = 3_600_000;
const DAY = 86_400_000;
const ORG = "org_sb";

type T = ReturnType<typeof convexTest>;

async function studio(t: T, features: { hidePricing?: boolean; requireApproval?: boolean } = { hidePricing: true }) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: ORG, name: "Hardcover", slug: "hardcover", tier: "growth", status: "active",
      ownerEmail: "owner@sb.test", bookingFeatures: features,
    } as never);
    await ctx.db.insert("members", { orgId: ORG, name: "Olive Owner", role: "owner", email: "owner@sb.test", clerkUserId: "u_owner", skills: [] } as never);
    await ctx.db.insert("members", { orgId: ORG, name: "Max Manager", role: "manager", email: "mgr@sb.test", clerkUserId: "u_mgr", skills: [] } as never);
    const room = await ctx.db.insert("rooms", {
      orgId: ORG, name: "Room A", status: "available", bookable: true,
      hourlyRateCents: 10000, minimumHours: 1, depositPct: 30,
    } as never);
    return room as Id<"rooms">;
  });
}

async function book(t: T, roomId: Id<"rooms">) {
  return (await t.mutation(api.booking.createBooking, {
    roomId, clientName: "Nova Client", clientEmail: "nova@sb.test", clientPhone: "(310) 555-0199",
    startTime: Date.now() + 7 * DAY, durationHours: 2,
  } as never)) as { sessionId: Id<"sessions"> };
}

/** Book a studio-billed request, approve it, then move it to start `hoursOut` from now. */
async function approvedStudioBilled(t: T, hoursOut: number) {
  const room = await studio(t);
  const { sessionId } = await book(t, room);
  await t.withIdentity({ subject: "u_mgr", orgId: ORG }).mutation(api.bookingRequests.approve, { sessionId });
  await moveTo(t, sessionId, hoursOut);
  return sessionId;
}

async function moveTo(t: T, sessionId: Id<"sessions">, hoursOut: number) {
  await t.run(async (ctx) => {
    const start = Date.now() + hoursOut * HOUR;
    await ctx.db.patch(sessionId, { startTime: start, endTime: start + 2 * HOUR });
  });
}

const notes = (t: T, sessionId: Id<"sessions">) =>
  t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.sessionId === sessionId));
const clientNotes = async (t: T, sessionId: Id<"sessions">) =>
  (await notes(t, sessionId)).filter((n) => n.recipient === "nova@sb.test" || n.recipient === "+13105550199");
const scheduledSms = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) => f.name.includes("smsFlows")),
  );
const activityKinds = (t: T, sessionId: Id<"sessions">) =>
  t.run(async (ctx) => (await ctx.db.query("activity").collect()).filter((a) => a.entityId === sessionId).map((a) => a.kind));

describe("studio-billed bookings (link without prices) are never auto-cancelled", () => {
  it("U-01: an approved pricing-hidden request inside T-2h stays confirmed, no forfeit", async () => {
    const t = convexTest(schema);
    const sessionId = await approvedStudioBilled(t, 1);
    const before = await t.run((ctx) => ctx.db.get(sessionId));
    expect(before?.status).toBe("confirmed");
    expect(before?.pricingHidden).toBe(true);
    await t.mutation(internal.automation.tick, {});
    const s = await t.run((ctx) => ctx.db.get(sessionId));
    expect(s?.status).toBe("confirmed");
    expect((await notes(t, sessionId)).some((n) => n.kind === "booking.forfeited")).toBe(false);
    expect(await activityKinds(t, sessionId)).not.toContain("booking.forfeited");
  });

  it("U-02: no balance email or SMS with a pay link at T-3h", async () => {
    const t = convexTest(schema);
    const sessionId = await approvedStudioBilled(t, 3);
    const smsBefore = (await scheduledSms(t)).length;
    await t.mutation(internal.automation.tick, {});
    const n = await notes(t, sessionId);
    expect(n.some((x) => x.kind === "booking.balance_reminder")).toBe(false);
    expect((await scheduledSms(t)).length).toBe(smsBefore);
    // Nothing new went to the client at all (only the earlier request/approval messages).
    const clientKinds = (await clientNotes(t, sessionId)).map((x) => x.kind);
    expect(clientKinds.every((k) => k.startsWith("booking.request"))).toBe(true);
    expect((await clientNotes(t, sessionId)).some((x) => /checkout/.test(x.body))).toBe(false);
  });

  it("U-03 / U-09: the team heads-up is sent once, however often automation runs", async () => {
    const t = convexTest(schema);
    const sessionId = await approvedStudioBilled(t, 3);
    await t.mutation(internal.automation.tick, {});
    await t.mutation(internal.automation.tick, {});
    await moveTo(t, sessionId, 1); // later, inside the old forfeit window
    await t.mutation(internal.automation.tick, {});
    const heads = (await notes(t, sessionId)).filter((n) => n.kind === "booking.studio_billed_unpaid");
    // notifyTeam writes one row per owner/manager recipient; one round only.
    const recipients = heads.map((h) => h.recipient).sort();
    expect(new Set(recipients).size).toBe(recipients.length);
    expect(recipients.length).toBeGreaterThan(0);
    expect(recipients).not.toContain("nova@sb.test");
    expect(heads[0].body).toContain("will not cancel");
    const s = await t.run((ctx) => ctx.db.get(sessionId));
    expect(s?.status).toBe("confirmed");
  });

  it("a studio-billed booking approved inside T-2h still gets the heads-up, and is not cancelled", async () => {
    const t = convexTest(schema);
    const sessionId = await approvedStudioBilled(t, 1);
    await t.mutation(internal.automation.tick, {});
    expect((await notes(t, sessionId)).some((n) => n.kind === "booking.studio_billed_unpaid")).toBe(true);
  });

  it("no heads-up once the studio records payment in full", async () => {
    const t = convexTest(schema);
    const sessionId = await approvedStudioBilled(t, 3);
    await t.run(async (ctx) => {
      const s = await ctx.db.get(sessionId);
      await ctx.db.patch(sessionId, { amountPaidCents: s!.rateCents });
    });
    await t.mutation(internal.automation.tick, {});
    expect((await notes(t, sessionId)).some((n) => n.kind === "booking.studio_billed_unpaid")).toBe(false);
  });

  it("U-07: a pricing-hidden request still pending is untouched (no hold, no nudge, no heads-up)", async () => {
    const t = convexTest(schema);
    const room = await studio(t);
    const { sessionId } = await book(t, room);
    await moveTo(t, sessionId, 1);
    const before = (await notes(t, sessionId)).length;
    await t.mutation(internal.automation.tick, {});
    const s = await t.run((ctx) => ctx.db.get(sessionId));
    expect(s?.requestStatus).toBe("pending");
    expect(s?.status).not.toBe("cancelled");
    expect(s?.holdExpiresAt).toBeUndefined();
    expect((await notes(t, sessionId)).length).toBe(before);
  });

  it("U-08: a declined pricing-hidden request stays declined and cancelled", async () => {
    const t = convexTest(schema);
    const room = await studio(t);
    const { sessionId } = await book(t, room);
    await t.withIdentity({ subject: "u_mgr", orgId: ORG }).mutation(api.bookingRequests.decline, { sessionId, reason: "Closed" });
    await moveTo(t, sessionId, 1);
    const before = (await notes(t, sessionId)).length;
    await t.mutation(internal.automation.tick, {});
    const s = await t.run((ctx) => ctx.db.get(sessionId));
    expect(s?.requestStatus).toBe("declined");
    expect(s?.status).toBe("cancelled");
    expect((await notes(t, sessionId)).length).toBe(before);
  });
});

describe("must not break: bookings with prices", () => {
  async function pricedConfirmed(t: T, hoursOut: number, source: "public_booking" | "internal" = "public_booking") {
    return await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Priced", slug: "priced", tier: "growth", status: "active", ownerEmail: "owner@sb.test" } as never);
      await ctx.db.insert("members", { orgId: ORG, name: "Olive Owner", role: "owner", email: "owner@sb.test", clerkUserId: "u_owner", skills: [] } as never);
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Nova", type: "artist", email: "nova@sb.test",
        genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      return await ctx.db.insert("sessions", {
        orgId: ORG, title: "Priced Mix", artistId, serviceType: "recording", source,
        startTime: Date.now() + hoursOut * HOUR, endTime: Date.now() + (hoursOut + 2) * HOUR,
        status: "confirmed", rateCents: 20_000, depositCents: 6_000, depositPaid: true, amountPaidCents: 6_000, intakeCompleted: false,
      } as never);
    });
  }

  it("U-04: a public booking with prices and an unpaid balance is still forfeited at T-2h", async () => {
    const t = convexTest(schema);
    const id = await pricedConfirmed(t, 1);
    await t.mutation(internal.automation.tick, {});
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("cancelled");
    expect((await notes(t, id)).some((n) => n.kind === "booking.forfeited")).toBe(true);
  });

  it("U-05: a public booking with prices still gets the balance reminder at T-3h", async () => {
    const t = convexTest(schema);
    const id = await pricedConfirmed(t, 3);
    await t.mutation(internal.automation.tick, {});
    const reminder = (await notes(t, id)).find((n) => n.kind === "booking.balance_reminder");
    expect(reminder?.body).toContain("/book/priced/checkout/");
    expect((await notes(t, id)).some((n) => n.kind === "booking.studio_billed_unpaid")).toBe(false);
  });

  it("U-06: a staff-made confirmed booking with an unpaid balance is not cancelled", async () => {
    const t = convexTest(schema);
    const id = await pricedConfirmed(t, 1, "internal");
    await t.mutation(internal.automation.tick, {});
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("confirmed");
    expect((await notes(t, id)).some((n) => n.kind === "booking.forfeited")).toBe(false);
  });
});
