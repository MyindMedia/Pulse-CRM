import { describe, it, expect, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";

describe("AI social drafts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("approving a social_post_draft action approves and schedules the post", async () => {
    vi.useFakeTimers();
    vi.stubEnv("GHL_API_KEY", "");
    const t = convexTest(schema);
    const now = Date.now();
    const { actionId, postId } = await t.run(async (ctx) => {
      // Pro tier, not Studio: opsActions.approve gates on the "agent"
      // capability (requireCapability -> entitlementForCapability ->
      // "agent"), which is a PRO_ADDS capability, not in STUDIO_CAPS (see
      // convex/lib/plans.ts). The unified ops approval inbox is a Pro-tier
      // surface; a Studio-tier owner still approves the same draft directly
      // through the marketing composer's own posts.approve ("marketing.approve",
      // available on Studio), which this suite's other tests cover.
      await ctx.db.insert("orgs", { orgId: "org1", name: "S", slug: "studio", plan: "studio", tier: "pro", status: "active" });
      await ctx.db.insert("members", { orgId: "org1", name: "Owner", role: "owner", clerkUserId: "u1", skills: [] });
      const ig = await ctx.db.insert("socialAccounts", { orgId: "org1", platform: "facebook", ghlAccountId: "acc", ghlLocationId: "loc", name: "FB", status: "connected", connectedBy: "u1", connectedAt: now });
      const postId = await ctx.db.insert("socialPosts", { orgId: "org1", template: "rate_promo", status: "draft", caption: "20% off Tuesdays", media: [], accountIds: [ig], scheduledFor: now + 3_600_000, timezone: "UTC", ghlType: "post", submittedBy: "pulse-ai", createdAt: now, updatedAt: now });
      const actionId = await ctx.db.insert("opsActions", { orgId: "org1", type: "social_post_draft", priority: "low", title: "Post: 20% off Tuesdays", rationale: "Room A is empty on Tuesday afternoons.", payload: { kind: "social_post", postId }, status: "proposed", autonomy: false, source: "rule", dedupeKey: `social_post_draft:${postId}`, createdAt: now });
      return { actionId, postId };
    });
    const owner = t.withIdentity({ subject: "u1", name: "Owner", orgId: "org1" });
    await owner.mutation(api.opsActions.approve, { id: actionId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const post = await t.run((ctx) => ctx.db.get(postId));
    expect(post?.status).toBe("scheduled");
    const action = await t.run((ctx) => ctx.db.get(actionId));
    expect(action?.status).toBe("executed");
  });

  it("the rate-cut sweep creates a promo and a draft post for each recommendation", async () => {
    vi.stubEnv("OPENAI_API_KEY", ""); // deterministic fallback body, no live call
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org1", name: "S", slug: "studio", plan: "studio", tier: "studio", status: "active" });
      await ctx.db.insert("rooms", { orgId: "org1", name: "Room A", status: "available", bookable: true, hourlyRateCents: 10000, minimumHours: 2, depositPct: 30 });
    });
    await t.action(internal.aiActions.generateRateCutPromosForOrg, { orgId: "org1" });
    const promos = await t.run((ctx) => ctx.db.query("promos").collect());
    const posts = await t.run((ctx) => ctx.db.query("socialPosts").collect());
    expect(promos.length).toBeGreaterThan(0);
    expect(posts.length).toBe(promos.length);
    expect(posts.every((p) => p.status === "draft" && p.template === "rate_promo" && p.promoId)).toBe(true);
    const actions = await t.run((ctx) => ctx.db.query("opsActions").collect());
    expect(actions.filter((a) => a.type === "social_post_draft").length).toBe(posts.length);
  });

  it("a second sweep does not duplicate an approved-but-unexecuted draft", async () => {
    vi.stubEnv("OPENAI_API_KEY", ""); // deterministic fallback body, no live call
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org1", name: "S", slug: "studio", plan: "studio", tier: "studio", status: "active" });
      await ctx.db.insert("rooms", { orgId: "org1", name: "Room A", status: "available", bookable: true, hourlyRateCents: 10000, minimumHours: 2, depositPct: 30 });
    });
    await t.action(internal.aiActions.generateRateCutPromosForOrg, { orgId: "org1" });
    const firstActions = await t.run((ctx) => ctx.db.query("opsActions").collect());
    const firstPromoCount = (await t.run((ctx) => ctx.db.query("promos").collect())).length;
    const firstPostCount = (await t.run((ctx) => ctx.db.query("socialPosts").collect())).length;
    // Owner approves one of the drafts but the post has not executed yet
    // (open, not yet terminal): a second weekly sweep must skip it.
    await t.run(async (ctx) => {
      await ctx.db.patch(firstActions[0]._id, { status: "approved" });
    });
    await t.action(internal.aiActions.generateRateCutPromosForOrg, { orgId: "org1" });
    const secondActions = await t.run((ctx) => ctx.db.query("opsActions").collect());
    const secondPromoCount = (await t.run((ctx) => ctx.db.query("promos").collect())).length;
    const secondPostCount = (await t.run((ctx) => ctx.db.query("socialPosts").collect())).length;
    expect(secondActions.length).toBe(firstActions.length);
    expect(secondPromoCount).toBe(firstPromoCount);
    expect(secondPostCount).toBe(firstPostCount);
  });
});
