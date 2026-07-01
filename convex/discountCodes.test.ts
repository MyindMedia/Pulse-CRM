import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const DAY = 86_400_000;

/* Public booking flow: no identity needed - the org is derived from the
   room, and the codes live on orgs.discountCodes. */
describe("discount codes: public validation + booking redemption", () => {
  let t: ReturnType<typeof convexTest>;
  let room: Id<"rooms">;
  let mic: Id<"equipment">;
  let start: number;

  beforeEach(async () => {
    t = convexTest(schema);
    start = Date.now() + 7 * DAY; // a future slot
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org1", name: "Studio", slug: "studio", plan: "studio", status: "active",
        discountCodes: [
          { code: "SAVE20", pct: 20, label: "Slow Tuesdays", active: true },
          { code: "PAUSED10", pct: 10, active: false },
        ],
      });
      const r = await ctx.db.insert("rooms", {
        orgId: "org1", name: "Room A", status: "available", bookable: true,
        hourlyRateCents: 10000, minimumHours: 1, depositPct: 30,
      });
      const m = await ctx.db.insert("equipment", {
        orgId: "org1", name: "Neumann U47", category: "mic", status: "available",
        quantity: 1, purchaseCents: 800000, currentValueCents: 600000,
        rentable: true, rentalPriceCents: 7500,
      });
      return { r, m };
    });
    room = ids.r;
    mic = ids.m;
  });

  /* ── validateCode (the public, room-scoped check) ── */

  it("validates an active code and returns exactly that one code", async () => {
    const res = await t.query(api.booking.validateCode, { roomId: room, code: "SAVE20" });
    // Full-shape equality: proves the response carries ONE code's details
    // and never the org's whole discountCodes list.
    expect(res).toEqual({ valid: true, code: "SAVE20", pct: 20, label: "Slow Tuesdays" });
  });

  it("normalizes case + whitespace on the submitted code", async () => {
    const res = await t.query(api.booking.validateCode, { roomId: room, code: "  save20 " });
    expect(res).toEqual({ valid: true, code: "SAVE20", pct: 20, label: "Slow Tuesdays" });
  });

  it("rejects an unknown code without leaking anything else", async () => {
    const res = await t.query(api.booking.validateCode, { roomId: room, code: "NOPE99" });
    expect(res).toEqual({ valid: false });
  });

  it("rejects a paused (inactive) code", async () => {
    const res = await t.query(api.booking.validateCode, { roomId: room, code: "PAUSED10" });
    expect(res).toEqual({ valid: false });
  });

  /* ── createBooking redemption ── */

  it("applies a valid code: discounted rate, proportional deposit, comp fields", async () => {
    const res = await t.mutation(api.booking.createBooking, {
      roomId: room,
      clientName: "Nova",
      clientEmail: "nova@x.com",
      startTime: start,
      durationHours: 2,
      discountCode: "save20", // lowercase on purpose - server normalizes
    });
    // 2h * $100 = $200 list; 20% off = $160; deposit 30% of the BILLED rate.
    expect(res.listValueCents).toBe(20000);
    expect(res.rateCents).toBe(16000);
    expect(res.depositCents).toBe(Math.round(16000 * 0.3));
    expect(res.discountPct).toBe(20);
    expect(res.discountCode).toBe("SAVE20");

    const session = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(session?.compType).toBe("discounted");
    expect(session?.listValueCents).toBe(20000); // the undiscounted rate
    expect(session?.compReason).toBe("Code SAVE20");
    expect(session?.rateCents).toBe(16000);
  });

  it("discounts the room + gear add-on total together", async () => {
    const res = await t.mutation(api.booking.createBooking, {
      roomId: room,
      clientName: "Nova",
      clientEmail: "nova@x.com",
      startTime: start,
      durationHours: 2,
      addOnEquipmentIds: [mic],
      discountCode: "SAVE20",
    });
    // ($200 room + $75 mic) = $275 list; 20% off = $220.
    expect(res.listValueCents).toBe(27500);
    expect(res.rateCents).toBe(22000);
    expect(res.depositCents).toBe(Math.round(22000 * 0.3));
  });

  it("keeps the deposit proportional to what's actually billed", async () => {
    const res = await t.mutation(api.booking.createBooking, {
      roomId: room, clientName: "Nova", clientEmail: "nova@x.com",
      startTime: start, durationHours: 3, discountCode: "SAVE20",
    });
    // deposit / rate must equal the room's depositPct, on the discounted rate.
    expect(res.depositCents / res.rateCents).toBeCloseTo(0.3, 5);
    expect(res.depositCents).toBeLessThan(Math.round(res.listValueCents * 0.3));
  });

  it("rejects an unknown code instead of silently billing full price", async () => {
    await expect(
      t.mutation(api.booking.createBooking, {
        roomId: room, clientName: "Max", clientEmail: "max@x.com",
        startTime: start, durationHours: 2, discountCode: "NOPE99",
      }),
    ).rejects.toThrow(/isn't valid/i);
    // Nothing was booked.
    const sessions = await t.run((ctx) => ctx.db.query("sessions").collect());
    expect(sessions).toHaveLength(0);
  });

  it("rejects a paused code the same way", async () => {
    await expect(
      t.mutation(api.booking.createBooking, {
        roomId: room, clientName: "Max", clientEmail: "max@x.com",
        startTime: start, durationHours: 2, discountCode: "PAUSED10",
      }),
    ).rejects.toThrow(/isn't valid/i);
  });

  it("books normally (no comp fields) when no code is sent", async () => {
    const res = await t.mutation(api.booking.createBooking, {
      roomId: room, clientName: "Max", clientEmail: "max@x.com",
      startTime: start, durationHours: 2,
    });
    expect(res.rateCents).toBe(20000);
    expect(res.listValueCents).toBe(20000);
    expect(res.discountPct).toBe(0);
    expect(res.discountCode).toBeNull();
    const session = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(session?.compType).toBeUndefined();
    expect(session?.listValueCents).toBeUndefined();
    expect(session?.compReason).toBeUndefined();
  });
});
