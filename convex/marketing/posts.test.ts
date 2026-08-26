import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { buildTrackedLink } from "./posts";

const HOUR = 3_600_000;

describe("marketing posts", () => {
  let t: ReturnType<typeof convexTest>;
  let ig: Id<"socialAccounts">;
  let foreignIg: Id<"socialAccounts">;
  let artist: Id<"artists">;
  const now = Date.now();

  beforeEach(async () => {
    vi.useFakeTimers();
    t = convexTest(schema);
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org1", name: "S", slug: "studio", plan: "studio", status: "active" });
      await ctx.db.insert("orgs", { orgId: "org2", name: "T", slug: "other", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org1", name: "Owner", role: "owner", clerkUserId: "u1", skills: [] });
      await ctx.db.insert("members", { orgId: "org1", name: "Eng", role: "engineer", clerkUserId: "u3", skills: [] });
      const ig = await ctx.db.insert("socialAccounts", { orgId: "org1", platform: "instagram", ghlAccountId: "acc_1", ghlLocationId: "loc", name: "IG", status: "connected", connectedBy: "u1", connectedAt: now });
      const foreignIg = await ctx.db.insert("socialAccounts", { orgId: "org2", platform: "instagram", ghlAccountId: "acc_2", ghlLocationId: "loc", name: "Other IG", status: "connected", connectedBy: "u2", connectedAt: now });
      const artist = await ctx.db.insert("artists", {
        orgId: "org1", name: "Sky", type: "artist", genres: [], tags: [], okToFeature: false,
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      return { ig, foreignIg, artist };
    });
    ig = ids.ig; foreignIg = ids.foreignIg; artist = ids.artist;
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  const owner = () => t.withIdentity({ subject: "u1", name: "Owner", orgId: "org1" });
  const eng = () => t.withIdentity({ subject: "u3", name: "Eng", orgId: "org1" });
  const base = { template: "custom" as const, caption: "Open Thursday", captionOverrides: undefined, media: [{ type: "image" as const, brandCard: "open_slot" as const }], scheduledFor: now + 2 * HOUR, timezone: "America/Los_Angeles", ghlType: "post" as const, includeBookingLink: true };

  it("engineer creates a draft; approving requires marketing.approve", async () => {
    const id = await eng().mutation(api.marketing.posts.create, { ...base, accountIds: [ig] });
    expect((await owner().query(api.marketing.posts.get, { id }))?.status).toBe("draft");
    await expect(eng().mutation(api.marketing.posts.approve, { id })).rejects.toThrow();
  });

  it("a post can never reference another org's account", async () => {
    await expect(owner().mutation(api.marketing.posts.create, { ...base, accountIds: [ig, foreignIg] })).rejects.toThrow(/not one of this studio/);
  });

  it("per-platform rules block an invalid draft", async () => {
    await expect(owner().mutation(api.marketing.posts.create, { ...base, media: [], accountIds: [ig] })).rejects.toThrow(/Instagram needs a photo or video/);
  });

  it("client_win needs the artist's OK to feature at approve time", async () => {
    const id = await owner().mutation(api.marketing.posts.create, { ...base, template: "client_win", artistId: artist, accountIds: [ig] });
    await expect(owner().mutation(api.marketing.posts.approve, { id })).rejects.toThrow(/OK to feature/);
    await t.run(async (ctx) => { await ctx.db.patch(artist, { okToFeature: true }); });
    await owner().mutation(api.marketing.posts.approve, { id });
    expect((await owner().query(api.marketing.posts.get, { id }))?.status).not.toBe("draft");
  });

  it("approve meters the monthly cap and schedules through GHL in simulated mode", async () => {
    vi.stubEnv("GHL_API_KEY", "");
    const id = await owner().mutation(api.marketing.posts.create, { ...base, accountIds: [ig] });
    await owner().mutation(api.marketing.posts.approve, { id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const post = await owner().query(api.marketing.posts.get, { id });
    expect(post?.status).toBe("scheduled");
    expect(post?.ghlPostId?.startsWith("simulated:")).toBe(true);
    expect(post?.link).toContain("?src=");
    const usage = await t.run((ctx) => ctx.db.query("usageCounters").collect());
    expect(usage.find((u) => u.metric === "social_posts")?.value).toBe(1);
  });

  it("schedule sends only this org's GHL account ids and stores the GHL post id", async () => {
    vi.stubEnv("GHL_API_KEY", "pit"); vi.stubEnv("GHL_LOCATION_ID", "loc"); vi.stubEnv("GHL_SOCIAL_USER_ID", "user");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: { post: { _id: "ghl_9" } } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const id = await owner().mutation(api.marketing.posts.create, { ...base, accountIds: [ig] });
    await owner().mutation(api.marketing.posts.approve, { id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.accountIds).toEqual(["acc_1"]);
    expect(body.status).toBe("scheduled");
    expect((await owner().query(api.marketing.posts.get, { id }))?.ghlPostId).toBe("ghl_9");
  });

  it("buildTrackedLink carries src and code", () => {
    expect(buildTrackedLink({ host: "https://pulse.myindsound.com", slug: "studio", roomId: "r1", postId: "p1", code: "THU20" }))
      .toBe("https://pulse.myindsound.com/book/studio/r1?src=p1&code=THU20");
    expect(buildTrackedLink({ host: "https://pulse.myindsound.com", slug: "studio", postId: "p1" }))
      .toBe("https://pulse.myindsound.com/book/studio?src=p1");
  });
});
