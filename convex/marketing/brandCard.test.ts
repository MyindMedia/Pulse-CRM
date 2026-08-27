import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";

describe("marketing brand card", () => {
  it("brand card data exposes only display fields", async () => {
    const t = convexTest(schema);
    const now = Date.now();
    const postId = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org1", name: "Slang City", slug: "slang", plan: "studio", status: "active", accentColor: "#FDB913" });
      const room = await ctx.db.insert("rooms", { orgId: "org1", name: "Room A", status: "available", bookable: true, hourlyRateCents: 8000, minimumHours: 2, depositPct: 30 });
      const promo = await ctx.db.insert("promos", { orgId: "org1", code: "TUE20", pct: 20, label: "Tuesday afternoons", startsAt: now, endsAt: now + 86_400_000, redemptions: 0, source: "owner", active: true, createdBy: "u1", createdAt: now });
      return await ctx.db.insert("socialPosts", { orgId: "org1", template: "rate_promo", status: "draft", caption: "x", media: [], accountIds: [], scheduledFor: now, timezone: "UTC", ghlType: "post", submittedBy: "u1", createdAt: now, updatedAt: now, promoId: promo, roomId: room });
    });
    const d = await t.query(api.marketing.brandCard.data, { postId });
    expect(d).toEqual({ studioName: "Slang City", accent: "#FDB913", logoUrl: null, roomName: "Room A", rateLabel: "$80/hr", promoCode: "TUE20", promoPct: 20, windowLabel: "Tuesday afternoons" });
  });

  it("never leaks another org's room or promo, even if a post carries a foreign id", async () => {
    const t = convexTest(schema);
    const now = Date.now();
    const postId = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org1", name: "Slang City", slug: "slang", plan: "studio", status: "active", accentColor: "#FDB913" });
      await ctx.db.insert("orgs", { orgId: "org2", name: "Rival Studio", slug: "rival", plan: "studio", status: "active" });
      // A room and a promo that belong to org2, not the org1 post that will
      // reference them - simulates a post whose write-side validation was
      // bypassed or predates the roomId check.
      const foreignRoom = await ctx.db.insert("rooms", { orgId: "org2", name: "Rival Room", status: "available", bookable: true, hourlyRateCents: 12000 });
      const foreignPromo = await ctx.db.insert("promos", { orgId: "org2", code: "RIVAL50", pct: 50, label: "Rival's secret sale", startsAt: now, endsAt: now + 86_400_000, redemptions: 0, source: "owner", active: true, createdBy: "u2", createdAt: now });
      return await ctx.db.insert("socialPosts", { orgId: "org1", template: "rate_promo", status: "draft", caption: "x", media: [], accountIds: [], scheduledFor: now, timezone: "UTC", ghlType: "post", submittedBy: "u1", createdAt: now, updatedAt: now, promoId: foreignPromo, roomId: foreignRoom });
    });
    const d = await t.query(api.marketing.brandCard.data, { postId });
    expect(d).toEqual({ studioName: "Slang City", accent: "#FDB913", logoUrl: null, roomName: null, rateLabel: null, promoCode: null, promoPct: null, windowLabel: null });
  });
});
