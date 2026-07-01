import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const HOUR = 3_600_000;

/* Post-session review loop: public submit (org derived from the session, one
   per session), studio-side moderation, and the public social-proof feed. The
   anonymous test caller resolves to the owner of "pulse-demo" (demo mode), so
   gated calls (listForOrg / setStatus) act on that org. */

async function mkArtist(t: ReturnType<typeof convexTest>, orgId: string, name: string) {
  return await t.run((ctx) =>
    ctx.db.insert("artists", {
      orgId, name, type: "artist", genres: [], tags: [], status: "active",
      lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    }),
  );
}

async function mkSession(
  t: ReturnType<typeof convexTest>,
  orgId: string,
  artistId: Id<"artists">,
  status: "completed" | "confirmed",
) {
  return await t.run((ctx) =>
    ctx.db.insert("sessions", {
      orgId, title: "Session", artistId, serviceType: "recording",
      startTime: Date.now() - 3 * HOUR, endTime: Date.now() - HOUR, status,
      rateCents: 20000, depositCents: 6000, depositPaid: true, intakeCompleted: true,
    }),
  );
}

describe("reviews: post-session review loop", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(async () => {
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo Studio", slug: "demo", plan: "studio", status: "active" });
      await ctx.db.insert("orgs", { orgId: "org2", name: "Other Studio", slug: "other", plan: "studio", status: "active" });
    });
  });

  it("submit writes a published review for a completed session", async () => {
    const artist = await mkArtist(t, "pulse-demo", "Nova");
    const session = await mkSession(t, "pulse-demo", artist, "completed");

    const res = await t.mutation(api.reviews.submit, { sessionId: session, rating: 5, text: "Amazing room." });
    expect(res.ok).toBe(true);

    const row = await t.run((ctx) => ctx.db.get(res.reviewId));
    expect(row?.orgId).toBe("pulse-demo");
    expect(row?.status).toBe("published");
    expect(row?.source).toBe("post_session");
    expect(row?.rating).toBe(5);
    expect(row?.authorName).toBe("Nova"); // falls back to the session's artist
  });

  it("rejects a review for a session that is not completed", async () => {
    const artist = await mkArtist(t, "pulse-demo", "Nova");
    const session = await mkSession(t, "pulse-demo", artist, "confirmed");
    await expect(
      t.mutation(api.reviews.submit, { sessionId: session, rating: 4 }),
    ).rejects.toThrow(/complete/i);
  });

  it("blocks a second submit for the same session", async () => {
    const artist = await mkArtist(t, "pulse-demo", "Nova");
    const session = await mkSession(t, "pulse-demo", artist, "completed");
    await t.mutation(api.reviews.submit, { sessionId: session, rating: 5 });
    await expect(
      t.mutation(api.reviews.submit, { sessionId: session, rating: 1 }),
    ).rejects.toThrow(/already/i);
  });

  it("clamps an out-of-range rating", async () => {
    const artist = await mkArtist(t, "pulse-demo", "Nova");
    const session = await mkSession(t, "pulse-demo", artist, "completed");
    await expect(
      t.mutation(api.reviews.submit, { sessionId: session, rating: 9 }),
    ).rejects.toThrow(/1 to 5/i);
  });

  it("derives the org from the session, never from a cross-org caller", async () => {
    // Session lives in org2; a public submit must land in org2, and must never
    // appear in another studio's public feed.
    const artist = await mkArtist(t, "org2", "Max");
    const session = await mkSession(t, "org2", artist, "completed");
    const res = await t.mutation(api.reviews.submit, { sessionId: session, rating: 4 });

    const row = await t.run((ctx) => ctx.db.get(res.reviewId));
    expect(row?.orgId).toBe("org2");

    const demoFeed = await t.query(api.reviews.publicForOrg, { orgId: "pulse-demo" });
    expect(demoFeed).toHaveLength(0);
    const org2Feed = await t.query(api.reviews.publicForOrg, { orgId: "org2" });
    expect(org2Feed).toHaveLength(1);
  });

  it("setStatus hides a review from the public feed", async () => {
    const artist = await mkArtist(t, "pulse-demo", "Nova");
    const session = await mkSession(t, "pulse-demo", artist, "completed");
    const res = await t.mutation(api.reviews.submit, { sessionId: session, rating: 5 });

    let feed = await t.query(api.reviews.publicForOrg, { slug: "demo" });
    expect(feed).toHaveLength(1);

    await t.mutation(api.reviews.setStatus, { reviewId: res.reviewId, status: "hidden" });

    feed = await t.query(api.reviews.publicForOrg, { slug: "demo" });
    expect(feed).toHaveLength(0);

    // Management list still sees it (published + hidden).
    const managed = await t.query(api.reviews.listForOrg, {});
    expect(managed).toHaveLength(1);
    expect(managed[0].status).toBe("hidden");
  });

  it("publicForOrg returns only published rows, capped at 12", async () => {
    await t.run(async (ctx) => {
      for (let i = 0; i < 15; i++) {
        await ctx.db.insert("reviews", {
          orgId: "pulse-demo", rating: 5, status: "published", source: "post_session", at: Date.now() + i,
        });
      }
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("reviews", {
          orgId: "pulse-demo", rating: 1, status: "hidden", source: "post_session", at: Date.now() + i,
        });
      }
    });
    const feed = await t.query(api.reviews.publicForOrg, { orgId: "pulse-demo" });
    expect(feed).toHaveLength(12); // capped
    expect(feed.every((r) => r.rating === 5)).toBe(true); // hidden excluded
  });

  it("stats computes the average over published reviews only", async () => {
    await t.run(async (ctx) => {
      for (const r of [5, 4, 3]) {
        await ctx.db.insert("reviews", {
          orgId: "pulse-demo", rating: r, status: "published", source: "post_session", at: Date.now(),
        });
      }
      // A hidden 1-star must not drag the average down.
      await ctx.db.insert("reviews", {
        orgId: "pulse-demo", rating: 1, status: "hidden", source: "post_session", at: Date.now(),
      });
    });
    const stats = await t.query(api.reviews.stats, { orgId: "pulse-demo" });
    expect(stats.count).toBe(3);
    expect(stats.avg).toBe(4); // (5+4+3)/3
  });
});
