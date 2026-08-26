import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { dayKey } from "./bookingFunnel";
import type { Id } from "./_generated/dataModel";

/* The booking page could always say what a booking was worth. It could never
   say what it CONVERTED, because nothing recorded a visit. These tests pin the
   counting rules, and the privacy stance: distinct people, no PII. */

const OWNER = "u_own";
const SLUG = "vault";

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: "org1", name: "Vault", slug: SLUG, plan: "studio", tier: "pro", status: "active",
    });
    await ctx.db.insert("members", {
      orgId: "org1", name: "Owner", role: "owner", skills: [], clerkUserId: OWNER,
    });
    return await ctx.db.insert("rooms", {
      orgId: "org1", name: "A", hourlyRateCents: 10_000, depositPct: 50, status: "available", bookable: true,
    });
  });
}

describe("visit tracking", () => {
  it("records a step and dedupes a refresh", async () => {
    const t = convexTest(schema);
    await seed(t);
    const args = { slug: SLUG, visitorKey: "visitor-aaaaaaaa", step: "page" as const };
    expect(await t.mutation(api.bookingFunnel.track, args)).toMatchObject({ ok: true });
    const again = await t.mutation(api.bookingFunnel.track, args);
    expect(again).toMatchObject({ ok: true, deduped: true });

    const rows = await t.run((ctx) => ctx.db.query("bookingVisits").collect());
    expect(rows).toHaveLength(1);
  });

  it("ignores an unknown slug rather than creating an org-less row", async () => {
    const t = convexTest(schema);
    await seed(t);
    const res = await t.mutation(api.bookingFunnel.track, {
      slug: "not-a-studio", visitorKey: "visitor-bbbbbbbb", step: "page",
    });
    expect(res.ok).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("bookingVisits").collect())).toHaveLength(0);
  });

  it("rejects a junk visitor key instead of indexing it", async () => {
    const t = convexTest(schema);
    await seed(t);
    // Too short after cleaning, and full of characters that have no business
    // reaching an index.
    expect(
      await t.mutation(api.bookingFunnel.track, { slug: SLUG, visitorKey: "a/b", step: "page" }),
    ).toMatchObject({ ok: false });
    expect(await t.run((ctx) => ctx.db.query("bookingVisits").collect())).toHaveLength(0);
  });

  it("strips unsafe characters from a key it does accept", async () => {
    const t = convexTest(schema);
    await seed(t);
    await t.mutation(api.bookingFunnel.track, {
      slug: SLUG, visitorKey: "abc<script>defghij", step: "page",
    });
    const [row] = await t.run((ctx) => ctx.db.query("bookingVisits").collect());
    expect(row.visitorKey).toBe("abcscriptdefghij");
  });

  it("counts a different room as a separate step", async () => {
    const t = convexTest(schema);
    const roomA = await seed(t);
    const roomB = await t.run((ctx) =>
      ctx.db.insert("rooms", {
        orgId: "org1", name: "B", hourlyRateCents: 8_000, depositPct: 50, status: "available", bookable: true,
      }),
    );
    const base = { slug: SLUG, visitorKey: "visitor-cccccccc", step: "room" as const };
    await t.mutation(api.bookingFunnel.track, { ...base, roomId: roomA });
    await t.mutation(api.bookingFunnel.track, { ...base, roomId: roomB });
    expect(await t.run((ctx) => ctx.db.query("bookingVisits").collect())).toHaveLength(2);
  });

  it("records the post id from ?src= on a page visit and ignores foreign or garbage ids", async () => {
    const t = convexTest(schema);
    const { postId, foreign } = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org1", name: "S", slug: "studio", plan: "studio", status: "active" });
      await ctx.db.insert("orgs", { orgId: "org2", name: "T", slug: "other", plan: "studio", status: "active" });
      const base = { template: "custom" as const, status: "published" as const, caption: "x", media: [], accountIds: [], scheduledFor: 0, timezone: "UTC", ghlType: "post" as const, submittedBy: "u", createdAt: 0, updatedAt: 0 };
      const postId = await ctx.db.insert("socialPosts", { orgId: "org1", ...base });
      const foreign = await ctx.db.insert("socialPosts", { orgId: "org2", ...base });
      return { postId, foreign };
    });
    await t.mutation(api.bookingFunnel.track, { slug: "studio", visitorKey: "visitor-v1", step: "page", src: postId });
    await t.mutation(api.bookingFunnel.track, { slug: "studio", visitorKey: "visitor-v2", step: "page", src: foreign });
    await t.mutation(api.bookingFunnel.track, { slug: "studio", visitorKey: "visitor-v3", step: "page", src: "not-an-id" });
    const rows = await t.run((ctx) => ctx.db.query("bookingVisits").collect());
    expect(rows.find((r) => r.visitorKey === "visitor-v1")?.postId).toBe(postId);
    expect(rows.find((r) => r.visitorKey === "visitor-v2")?.postId).toBeUndefined();
    expect(rows.find((r) => r.visitorKey === "visitor-v3")?.postId).toBeUndefined();
  });
});

describe("the funnel", () => {
  it("counts distinct people per stage, not rows", async () => {
    const t = convexTest(schema);
    const roomA = await seed(t);
    const roomB = await t.run((ctx) =>
      ctx.db.insert("rooms", {
        orgId: "org1", name: "B", hourlyRateCents: 8_000, depositPct: 50, status: "available", bookable: true,
      }),
    );
    // One person opening two rooms is one person considering, not two.
    await t.mutation(api.bookingFunnel.track, { slug: SLUG, visitorKey: "visitor-dddddddd", step: "page" });
    await t.mutation(api.bookingFunnel.track, { slug: SLUG, visitorKey: "visitor-dddddddd", step: "room", roomId: roomA });
    await t.mutation(api.bookingFunnel.track, { slug: SLUG, visitorKey: "visitor-dddddddd", step: "room", roomId: roomB });
    await t.mutation(api.bookingFunnel.track, { slug: SLUG, visitorKey: "visitor-eeeeeeee", step: "page" });

    const asOwner = t.withIdentity({ subject: OWNER, orgId: "org1" });
    const f = await asOwner.query(api.bookingFunnel.funnel, {});
    expect(f.counts.page).toBe(2);
    expect(f.counts.room).toBe(1);
    expect(f.stepRates.pageToRoom).toBe(50);
  });

  it("attributes revenue from a real booking and writes the booked step server-side", async () => {
    const t = convexTest(schema);
    const roomId = await seed(t);
    await t.mutation(api.bookingFunnel.track, { slug: SLUG, visitorKey: "visitor-ffffffff", step: "page" });

    await t.mutation(api.booking.createBooking, {
      roomId,
      clientName: "Ari",
      clientEmail: "ari@example.com",
      startTime: Date.now() + 7 * 86_400_000,
      durationHours: 4,
      visitorKey: "visitor-ffffffff",
    });

    const asOwner = t.withIdentity({ subject: OWNER, orgId: "org1" });
    const f = await asOwner.query(api.bookingFunnel.funnel, {});
    expect(f.counts.booked).toBe(1);
    expect(f.revenueCents).toBe(40_000);
    expect(f.conversionRate).toBe(100);
    expect(f.headline).toContain("$400");
    expect(f.headline).toContain("1 booking");
  });

  it("books without a visitor key without inventing a visit", async () => {
    const t = convexTest(schema);
    const roomId = await seed(t);
    await t.mutation(api.booking.createBooking, {
      roomId,
      clientName: "No Key",
      clientEmail: "nokey@example.com",
      startTime: Date.now() + 7 * 86_400_000,
      durationHours: 2,
    });
    expect(await t.run((ctx) => ctx.db.query("bookingVisits").collect())).toHaveLength(0);
  });

  it("splits traffic by source", async () => {
    const t = convexTest(schema);
    await seed(t);
    await t.mutation(api.bookingFunnel.track, { slug: SLUG, visitorKey: "visitor-gggggggg", step: "page", utmSource: "instagram" });
    await t.mutation(api.bookingFunnel.track, { slug: SLUG, visitorKey: "visitor-hhhhhhhh", step: "page" });

    const asOwner = t.withIdentity({ subject: OWNER, orgId: "org1" });
    const f = await asOwner.query(api.bookingFunnel.funnel, {});
    const sources = f.sources.map((s) => s.source).sort();
    expect(sources).toEqual(["direct", "instagram"]);
  });

  it("says so plainly when there is nothing yet", async () => {
    const t = convexTest(schema);
    await seed(t);
    const asOwner = t.withIdentity({ subject: OWNER, orgId: "org1" });
    const f = await asOwner.query(api.bookingFunnel.funnel, {});
    expect(f.headline).toBe("No booking page visits recorded yet.");
    expect(f.conversionRate).toBe(0);
  });

  it("is gated - a workspace without Reports cannot read it", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_lite", name: "Lite", slug: "lite", plan: "solo", tier: "studio",
      });
      await ctx.db.insert("members", {
        orgId: "org_lite", name: "O", role: "owner", skills: [], clerkUserId: "u_lite",
      });
    });
    const asOwner = t.withIdentity({ subject: "u_lite", orgId: "org_lite" });
    await expect(asOwner.query(api.bookingFunnel.funnel, {})).rejects.toMatchObject({
      data: { code: "UPGRADE_REQUIRED", capability: "reports" },
    });
  });

  it("buckets days in UTC", () => {
    expect(dayKey(Date.UTC(2026, 7, 20, 23, 59))).toBe("2026-08-20");
  });
});
