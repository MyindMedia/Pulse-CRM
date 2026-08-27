import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { buildTrackedLink, appHost } from "./posts";
import { periodFor } from "../usage";

const HOUR = 3_600_000;

describe("marketing posts", () => {
  let t: ReturnType<typeof convexTest>;
  let ig: Id<"socialAccounts">;
  let foreignIg: Id<"socialAccounts">;
  let foreignRoom: Id<"rooms">;
  let artist: Id<"artists">;
  const now = Date.now();

  beforeEach(async () => {
    vi.useFakeTimers();
    t = convexTest(schema);
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org1", name: "S", slug: "studio", plan: "studio", tier: "studio", status: "active" });
      await ctx.db.insert("orgs", { orgId: "org2", name: "T", slug: "other", plan: "studio", tier: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org1", name: "Owner", role: "owner", clerkUserId: "u1", skills: [] });
      await ctx.db.insert("members", { orgId: "org1", name: "Eng", role: "engineer", clerkUserId: "u3", skills: [] });
      await ctx.db.insert("members", { orgId: "org1", name: "Intern", role: "intern", clerkUserId: "u4", skills: [] });
      const ig = await ctx.db.insert("socialAccounts", { orgId: "org1", platform: "instagram", ghlAccountId: "acc_1", ghlLocationId: "loc", name: "IG", status: "connected", connectedBy: "u1", connectedAt: now });
      const foreignIg = await ctx.db.insert("socialAccounts", { orgId: "org2", platform: "instagram", ghlAccountId: "acc_2", ghlLocationId: "loc", name: "Other IG", status: "connected", connectedBy: "u2", connectedAt: now });
      const foreignRoom = await ctx.db.insert("rooms", { orgId: "org2", name: "Rival Room", status: "available" });
      const artist = await ctx.db.insert("artists", {
        orgId: "org1", name: "Sky", type: "artist", genres: [], tags: [], okToFeature: false,
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      return { ig, foreignIg, foreignRoom, artist };
    });
    ig = ids.ig; foreignIg = ids.foreignIg; foreignRoom = ids.foreignRoom; artist = ids.artist;
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  const owner = () => t.withIdentity({ subject: "u1", name: "Owner", orgId: "org1" });
  const eng = () => t.withIdentity({ subject: "u3", name: "Eng", orgId: "org1" });
  const intern = () => t.withIdentity({ subject: "u4", name: "Intern", orgId: "org1" });
  const base = { template: "custom" as const, caption: "Open Thursday", captionOverrides: undefined, media: [{ type: "image" as const, brandCard: "open_slot" as const }], scheduledFor: now + 2 * HOUR, timezone: "America/Los_Angeles", ghlType: "post" as const, includeBookingLink: true };

  it("engineer creates a draft; approving requires marketing.approve", async () => {
    const id = await eng().mutation(api.marketing.posts.create, { ...base, accountIds: [ig] });
    expect((await owner().query(api.marketing.posts.get, { id }))?.status).toBe("draft");
    await expect(eng().mutation(api.marketing.posts.approve, { id })).rejects.toThrow();
  });

  it("a post can never reference another org's account", async () => {
    await expect(owner().mutation(api.marketing.posts.create, { ...base, accountIds: [ig, foreignIg] })).rejects.toThrow(/not one of this studio/);
  });

  it("create and update both reject a room that belongs to another org", async () => {
    await expect(owner().mutation(api.marketing.posts.create, { ...base, accountIds: [ig], roomId: foreignRoom })).rejects.toThrow(/does not belong to this studio/);
    const id = await owner().mutation(api.marketing.posts.create, { ...base, accountIds: [ig] });
    await expect(owner().mutation(api.marketing.posts.update, { id, ...base, accountIds: [ig], roomId: foreignRoom })).rejects.toThrow(/does not belong to this studio/);
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

  it("a failed approval does not double-meter on retry", async () => {
    vi.stubEnv("GHL_API_KEY", "pit"); vi.stubEnv("GHL_LOCATION_ID", "loc"); vi.stubEnv("GHL_SOCIAL_USER_ID", "user");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const id = await owner().mutation(api.marketing.posts.create, { ...base, accountIds: [ig] });
    await owner().mutation(api.marketing.posts.approve, { id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await owner().query(api.marketing.posts.get, { id }))?.status).toBe("failed");
    await owner().mutation(api.marketing.posts.approve, { id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await owner().query(api.marketing.posts.get, { id }))?.status).toBe("failed");
    const usage = await t.run((ctx) => ctx.db.query("usageCounters").collect());
    expect(usage.find((u) => u.metric === "social_posts")?.value).toBe(1);
  });

  it("an edit and re-approve after a first approve does not double-meter", async () => {
    vi.stubEnv("GHL_API_KEY", "");
    const id = await owner().mutation(api.marketing.posts.create, { ...base, accountIds: [ig] });
    await owner().mutation(api.marketing.posts.approve, { id });
    expect((await owner().query(api.marketing.posts.get, { id }))?.status).toBe("approved");
    await owner().mutation(api.marketing.posts.update, { ...base, id, accountIds: [ig] });
    expect((await owner().query(api.marketing.posts.get, { id }))?.status).toBe("draft");
    await owner().mutation(api.marketing.posts.approve, { id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await owner().query(api.marketing.posts.get, { id }))?.status).toBe("scheduled");
    const usage = await t.run((ctx) => ctx.db.query("usageCounters").collect());
    expect(usage.find((u) => u.metric === "social_posts")?.value).toBe(1);
  });

  it("a studio already at its 20 posts/month cap is refused on the 21st distinct post", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("usageCounters", { orgId: "org1", period: periodFor("social_posts"), metric: "social_posts", value: 20, updatedAt: now });
    });
    const id = await owner().mutation(api.marketing.posts.create, { ...base, accountIds: [ig] });
    await expect(owner().mutation(api.marketing.posts.approve, { id })).rejects.toThrow(/LIMIT_REACHED|limit/i);
  });

  it("generateUploadUrl requires marketing.edit", async () => {
    await expect(intern().mutation(api.marketing.posts.generateUploadUrl, {})).rejects.toThrow();
    await expect(eng().mutation(api.marketing.posts.generateUploadUrl, {})).resolves.toEqual(expect.any(String));
  });

  it("suggestCaption requires marketing.edit and degrades to null without an OpenAI key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    // A viewer with only marketing.read cannot reach a paid AI action just by
    // knowing its name - this is the auth gap the brief's original sketch
    // (a bare currentActor call, which never throws) left open.
    await expect(intern().action(api.marketing.posts.suggestCaption, { template: "tip", facts: "Room A" })).rejects.toThrow();
    await expect(eng().action(api.marketing.posts.suggestCaption, { template: "tip", facts: "Room A" })).resolves.toBeNull();
  });

  it("buildTrackedLink carries src and code", () => {
    expect(buildTrackedLink({ host: "https://pulse.myindsound.com", slug: "studio", roomId: "r1", postId: "p1", code: "THU20" }))
      .toBe("https://pulse.myindsound.com/book/studio/r1?src=p1&code=THU20");
    expect(buildTrackedLink({ host: "https://pulse.myindsound.com", slug: "studio", postId: "p1" }))
      .toBe("https://pulse.myindsound.com/book/studio?src=p1");
  });

  it("appHost follows APP_URL, and PULSE_PUBLIC_HOST is only an override", () => {
    // The whole point: no second source of truth for the public host. A
    // deployment that sets APP_URL and nothing else gets the same origin here
    // as the other modules that build public links, instead of a literal that
    // silently disagrees with them.
    vi.stubEnv("PULSE_PUBLIC_HOST", "");
    vi.stubEnv("APP_URL", "https://studio.example.com");
    expect(appHost()).toBe("https://studio.example.com");

    // The override still wins when a deploy genuinely needs a different
    // public booking host.
    vi.stubEnv("PULSE_PUBLIC_HOST", "https://book.example.com");
    expect(appHost()).toBe("https://book.example.com");

    // A trailing slash on either would otherwise produce "//book/..".
    vi.stubEnv("PULSE_PUBLIC_HOST", "https://book.example.com/");
    expect(appHost()).toBe("https://book.example.com");
    expect(buildTrackedLink({ host: appHost(), slug: "studio", postId: "p1" }))
      .toBe("https://book.example.com/book/studio?src=p1");

    // Nothing configured is a dev machine. Localhost is deliberate: it is
    // loudly wrong rather than a plausible domain that fails silently. A
    // blank APP_URL counts as unset - appUrl()'s own `??` does not catch it,
    // and "" would publish a relative link to the open internet.
    vi.stubEnv("PULSE_PUBLIC_HOST", "");
    vi.stubEnv("APP_URL", "");
    expect(appHost()).toBe("http://localhost:3000");
  });
});
