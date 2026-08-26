import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const DAY = 86_400_000;

describe("promos", () => {
  let t: ReturnType<typeof convexTest>;
  let room: Id<"rooms">;
  let other: Id<"rooms">;
  const now = Date.now();

  beforeEach(async () => {
    t = convexTest(schema);
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org1", name: "Studio", slug: "studio", plan: "studio", status: "active",
        discountCodes: [{ code: "LEGACY10", pct: 10, active: true }],
      });
      await ctx.db.insert("members", { orgId: "org1", name: "Owner", role: "owner", clerkUserId: "u1", skills: [] });
      const r = await ctx.db.insert("rooms", { orgId: "org1", name: "A", status: "available", bookable: true, hourlyRateCents: 10000, minimumHours: 1, depositPct: 30 });
      const o = await ctx.db.insert("rooms", { orgId: "org1", name: "B", status: "available", bookable: true, hourlyRateCents: 10000, minimumHours: 1, depositPct: 30 });
      return { r, o };
    });
    room = ids.r; other = ids.o;
  });

  const owner = () => t.withIdentity({ subject: "u1", name: "Owner", orgId: "org1" });

  it("owner creates a promo and checkout resolves it before a legacy code", async () => {
    await owner().mutation(api.promos.create, { code: "thu20", pct: 20, startsAt: now - DAY, endsAt: now + DAY, roomId: room });
    const res = await t.query(api.booking.validateCode, { roomId: room, code: "THU20" });
    expect(res).toMatchObject({ valid: true, code: "THU20", pct: 20 });
    expect((res as { expiresAt?: number }).expiresAt).toBe(now + DAY);
  });

  it("a promo scoped to one room does not validate on another", async () => {
    await owner().mutation(api.promos.create, { code: "THU20", pct: 20, startsAt: now - DAY, endsAt: now + DAY, roomId: room });
    expect(await t.query(api.booking.validateCode, { roomId: other, code: "THU20" })).toEqual({ valid: false });
  });

  it("an expired or not-yet-started promo does not validate", async () => {
    await owner().mutation(api.promos.create, { code: "PAST", pct: 20, startsAt: now - 3 * DAY, endsAt: now - DAY });
    await owner().mutation(api.promos.create, { code: "SOON", pct: 20, startsAt: now + DAY, endsAt: now + 3 * DAY });
    expect(await t.query(api.booking.validateCode, { roomId: room, code: "PAST" })).toEqual({ valid: false });
    expect(await t.query(api.booking.validateCode, { roomId: room, code: "SOON" })).toEqual({ valid: false });
  });

  it("legacy codes still work when no promo matches", async () => {
    expect(await t.query(api.booking.validateCode, { roomId: room, code: "LEGACY10" })).toMatchObject({ valid: true, pct: 10 });
  });

  it("a promo at its redemption cap stops validating", async () => {
    const id = await owner().mutation(api.promos.create, { code: "CAP1", pct: 15, startsAt: now - DAY, endsAt: now + DAY, maxRedemptions: 1 });
    await t.run(async (ctx) => { await ctx.db.patch(id, { redemptions: 1 }); });
    expect(await t.query(api.booking.validateCode, { roomId: room, code: "CAP1" })).toEqual({ valid: false });
  });

  it("an engineer cannot create promos", async () => {
    await t.run(async (ctx) => { await ctx.db.insert("members", { orgId: "org1", name: "Eng", role: "engineer", clerkUserId: "u2", skills: [] }); });
    const eng = t.withIdentity({ subject: "u2", name: "Eng", orgId: "org1" });
    await expect(eng.mutation(api.promos.create, { code: "X", pct: 5, startsAt: now, endsAt: now + DAY })).rejects.toThrow();
  });

  it("a real booking with a promo code increments its redemption count by 1", async () => {
    const id = await owner().mutation(api.promos.create, {
      code: "REDEEM1", pct: 25, startsAt: now - DAY, endsAt: now + DAY, roomId: room,
    });
    await t.mutation(api.booking.createBooking, {
      roomId: room,
      clientName: "Nova",
      clientEmail: "nova@x.com",
      startTime: now + 7 * DAY,
      durationHours: 2,
      discountCode: "redeem1",
      visitorKey: "visitor-1",
    });
    const promo = await t.run((ctx) => ctx.db.get(id));
    expect(promo?.redemptions).toBe(1);
  });

  it("a promo that matches the code but fails its window blocks fallback to a legacy code of the same name", async () => {
    // SHARED15 exists both as an active legacy org code (pct 15) and as an
    // EXPIRED promo (pct 30). The promo match wins the lookup and its window
    // check fails, so the resolver must return null - never fall through to
    // the legacy code underneath it.
    await t.run(async (ctx) => {
      const org = (await ctx.db.query("orgs").collect()).find((o) => o.orgId === "org1");
      if (org) {
        await ctx.db.patch(org._id, {
          discountCodes: [...(org.discountCodes ?? []), { code: "SHARED15", pct: 15, active: true }],
        });
      }
    });
    await owner().mutation(api.promos.create, {
      code: "SHARED15", pct: 30, startsAt: now - 3 * DAY, endsAt: now - DAY,
    });
    expect(await t.query(api.booking.validateCode, { roomId: room, code: "SHARED15" })).toEqual({ valid: false });
  });

  it("createInternal rejects an out-of-range percent, same as create", async () => {
    await expect(
      t.mutation(internal.promos.createInternal, {
        orgId: "org1", code: "RATECUT", pct: 95, startsAt: now, endsAt: now + DAY, source: "rate_cut",
      }),
    ).rejects.toThrow(/between 1 and 90/);
  });

  it("update rejects a code already active on another promo", async () => {
    await owner().mutation(api.promos.create, { code: "ONE", pct: 10, startsAt: now - DAY, endsAt: now + DAY });
    const two = await owner().mutation(api.promos.create, { code: "TWO", pct: 10, startsAt: now - DAY, endsAt: now + DAY });
    await expect(
      owner().mutation(api.promos.update, { id: two, code: "ONE", pct: 10, startsAt: now - DAY, endsAt: now + DAY }),
    ).rejects.toThrow(/already active/);
  });
});
