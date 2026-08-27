import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";

const DAY = 86_400_000;

describe("marketing results", () => {
  it("counts clicks, bookings and revenue per post inside the 7-day window, postId over code", async () => {
    const t = convexTest(schema);
    const now = Date.now();
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org1", name: "S", slug: "studio", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org1", name: "Owner", role: "owner", clerkUserId: "u1", skills: [] });
      const promoA = await ctx.db.insert("promos", { orgId: "org1", code: "A20", pct: 20, startsAt: now - 10 * DAY, endsAt: now + 10 * DAY, redemptions: 0, source: "owner", active: true, createdBy: "u1", createdAt: now });
      const base = { orgId: "org1", template: "rate_promo" as const, status: "published" as const, caption: "A", media: [], accountIds: [], scheduledFor: now - 5 * DAY, timezone: "UTC", ghlType: "post" as const, submittedBy: "u1", createdAt: now, updatedAt: now };
      const postA = await ctx.db.insert("socialPosts", { ...base, promoId: promoA, publishedAt: now - 5 * DAY });
      const postB = await ctx.db.insert("socialPosts", { ...base, caption: "B", publishedAt: now - 5 * DAY });
      const visit = (extra: Record<string, unknown>) => ctx.db.insert("bookingVisits", { orgId: "org1", visitorKey: Math.random().toString(), step: "page", day: "2026-08-20", createdAt: now - 4 * DAY, ...extra } as never);
      await visit({ postId: postA }); await visit({ postId: postA }); await visit({ postId: postB });
      const booked = (extra: Record<string, unknown>) => ctx.db.insert("bookingVisits", { orgId: "org1", visitorKey: Math.random().toString(), step: "booked", day: "2026-08-21", createdAt: now - 3 * DAY, amountCents: 20000, ...extra } as never);
      await booked({ postId: postA });                 // link click
      await booked({ code: "A20" });                   // code only, still post A
      await booked({ postId: postB, code: "A20" });    // postId wins: post B
      await ctx.db.insert("bookingVisits", { orgId: "org1", visitorKey: "late", step: "booked", day: "2026-09-10", createdAt: now + 10 * DAY, amountCents: 99900, postId: postA } as never); // outside window
      return { postA, postB };
    });
    const owner = t.withIdentity({ subject: "u1", name: "Owner", orgId: "org1" });
    const rows = await owner.query(api.marketing.results.perPost, { from: now - 30 * DAY, to: now + 30 * DAY });
    const a = rows.find((r) => r.postId === ids.postA)!;
    const b = rows.find((r) => r.postId === ids.postB)!;
    // Post A gets two attributed bookings inside the window: one carrying
    // postId with no code (a tracked-link click, not a redemption) and one
    // carrying code "A20" with no postId (the actual redemption). Only the
    // second counts toward redemptions, so redemptions is 1, not 2 - clicks,
    // bookings, revenue and redemptions are four distinct measures.
    expect(a).toMatchObject({ clicks: 2, bookings: 2, revenueCents: 40000, redemptions: 1 });
    expect(b).toMatchObject({ clicks: 1, bookings: 1, revenueCents: 20000 });
  });
});
