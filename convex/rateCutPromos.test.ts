import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { resolveCode } from "./promos";
import { isSweepMadeLegacyCode, randomCodeSuffix, sweepPromoCode } from "./lib/rateCutCodes";

/* truth-discount-codes: sweep-made discount codes go live only when a person
   approves them, and the old permanent ones are refused at checkout. */

type T = Awaited<ReturnType<typeof setup>>["t"];
const A = "org_a";
const B = "org_b";

async function setup() {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("GHL_API_KEY", "");
  vi.stubEnv("APP_URL", "https://app.pulse.test");
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: A, name: "A", slug: "studio-a", tier: "growth", status: "active" });
    await ctx.db.insert("orgs", { orgId: B, name: "B", slug: "studio-b", tier: "growth", status: "active" });
    await ctx.db.insert("members", { orgId: A, name: "Owner", role: "owner", clerkUserId: "u_owner", skills: [] });
    await ctx.db.insert("members", { orgId: A, name: "Eng", role: "engineer", clerkUserId: "u_eng", skills: [] });
    await ctx.db.insert("members", { orgId: B, name: "B Owner", role: "owner", clerkUserId: "u_b", skills: [] });
    const roomA = await ctx.db.insert("rooms", { orgId: A, name: "Room A", status: "available", bookable: true, hourlyRateCents: 10000, minimumHours: 2, depositPct: 30 });
    const roomOther = await ctx.db.insert("rooms", { orgId: A, name: "Booth", status: "available", bookable: false, hourlyRateCents: 5000 });
    const account = await ctx.db.insert("socialAccounts", { orgId: A, platform: "facebook", ghlAccountId: "acc", ghlLocationId: "loc", name: "FB", status: "connected", connectedBy: "u_owner", connectedAt: Date.now() });
    return { roomA, roomOther, account };
  });
  return {
    t, ...ids,
    owner: t.withIdentity({ subject: "u_owner", orgId: A, name: "Owner" }),
    eng: t.withIdentity({ subject: "u_eng", orgId: A, name: "Eng" }),
    bOwner: t.withIdentity({ subject: "u_b", orgId: B, name: "B" }),
  };
}

const org = (t: T, orgId = A) => t.run(async (ctx) => (await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first()) as Doc<"orgs">);
const promos = (t: T) => t.run(async (ctx) => (await ctx.db.query("promos").collect()) as Doc<"promos">[]);
const resolve = (t: T, code: string, roomId?: Id<"rooms">, orgId = A) =>
  t.run(async (ctx) => resolveCode(ctx, (await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first()), code, roomId, Date.now()));

async function sweep(t: T) {
  await t.action(internal.aiActions.generateRateCutPromosForOrg, { orgId: A });
  const ps = await promos(t);
  expect(ps.length).toBeGreaterThan(0);
  const actions = await t.run(async (ctx) => (await ctx.db.query("opsActions").collect()) as Doc<"opsActions">[]);
  const posts = await t.run(async (ctx) => (await ctx.db.query("socialPosts").collect()) as Doc<"socialPosts">[]);
  return { ps, actions, posts };
}

/** The owner picks an account in the composer before approving (as today). */
async function pickAccount(t: T, postId: Id<"socialPosts">, account: Id<"socialAccounts">) {
  await t.run(async (ctx) => { await ctx.db.patch(postId, { accountIds: [account] }); });
}

describe("rate-cut sweep discount codes", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("U-01: the sweep writes no permanent code", async () => {
    const { t } = await setup();
    await sweep(t);
    expect((await org(t)).discountCodes ?? []).toEqual([]);
  });

  it("U-02: a sweep promo is not redeemable before approval", async () => {
    const { t, roomA } = await setup();
    const { ps } = await sweep(t);
    for (const p of ps) {
      expect(p.active).toBe(false);
      expect(p.awaitingApproval).toBe(true);
      expect(await resolve(t, p.code, roomA)).toBeNull();
    }
  });

  it("U-03: approving the draft post activates the promo for its window and room only", async () => {
    const { t, owner, roomA, roomOther, account } = await setup();
    const { actions, posts } = await sweep(t);
    const action = actions.find((a) => a.type === "social_post_draft")!;
    const post = posts.find((p) => p._id === (action.payload as { postId: Id<"socialPosts"> }).postId)!;
    await pickAccount(t, post._id, account);
    await owner.mutation(api.opsActions.approve, { id: action._id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const promo = (await promos(t)).find((p) => p._id === post.promoId)!;
    expect(promo.active).toBe(true);
    expect(promo.approvedBy).toBeTruthy();
    expect(await resolve(t, promo.code, roomA)).toMatchObject({ code: promo.code, pct: promo.pct, promoId: promo._id });
    expect(await resolve(t, promo.code, roomOther)).toBeNull();
    // Outside the window: after it ends, nothing.
    const after = await t.run(async (ctx) => resolveCode(ctx, await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", A)).first(), promo.code, roomA, promo.endsAt + 1));
    expect(after).toBeNull();
  });

  it("U-04: declining the draft leaves the promo inactive, and it cannot be approved later", async () => {
    const { t, owner, roomA } = await setup();
    const { actions, posts } = await sweep(t);
    const action = actions.find((a) => a.type === "social_post_draft")!;
    const post = posts.find((p) => p._id === (action.payload as { postId: Id<"socialPosts"> }).postId)!;
    await owner.mutation(api.opsActions.dismiss, { id: action._id });
    const promo = (await promos(t)).find((p) => p._id === post.promoId)!;
    expect(promo.active).toBe(false);
    expect(promo.awaitingApproval).toBe(false);
    expect(await resolve(t, promo.code, roomA)).toBeNull();
    expect(await owner.mutation(api.promos.activate, { id: promo._id })).toBe("not_waiting");
    expect((await promos(t)).find((p) => p._id === promo._id)!.active).toBe(false);
  });

  it("H210-03: a post whose promo was declined cannot be approved from the composer (it would advertise a dead code)", async () => {
    const { t, owner, account } = await setup();
    const { actions, posts } = await sweep(t);
    const action = actions.find((a) => a.type === "social_post_draft")!;
    const post = posts.find((p) => p._id === (action.payload as { postId: Id<"socialPosts"> }).postId)!;
    await owner.mutation(api.opsActions.dismiss, { id: action._id });
    await pickAccount(t, post._id, account);
    await expect(owner.mutation(api.marketing.posts.approve, { id: post._id })).rejects.toThrow(/switched off or was declined/);
    const after = await t.run((ctx) => ctx.db.get(post._id));
    expect(after?.status).not.toBe("approved");
    expect((await promos(t)).find((p) => p._id === post.promoId)!.active).toBe(false);
  });

  it("H210-03: a post whose owner promo was switched off cannot be approved; an active one can", async () => {
    const { t, owner, account } = await setup();
    const now = Date.now();
    const promoId = await owner.mutation(api.promos.create, { code: "FALL15", pct: 15, startsAt: now - 1000, endsAt: now + 86_400_000 });
    const postId = await t.mutation(internal.marketing.posts.createInternal, {
      orgId: A, template: "rate_promo", caption: "FALL15", media: [{ type: "image", brandCard: "promo" }],
      accountIds: [account], scheduledFor: now + 3_600_000, timezone: "America/Los_Angeles", promoId, ghlType: "post", includeBookingLink: true,
    } as never);
    await owner.mutation(api.promos.deactivate, { id: promoId });
    await expect(owner.mutation(api.marketing.posts.approve, { id: postId })).rejects.toThrow(/switched off/);
    await t.run(async (ctx) => { await ctx.db.patch(promoId, { active: true }); });
    await owner.mutation(api.marketing.posts.approve, { id: postId });
    expect((await t.run((ctx) => ctx.db.get(postId)))?.status).toBe("approved");
  });

  it("H210-03: the email draft tells the owner the code is not live until approved, and the client email does not", async () => {
    const { t } = await setup();
    await sweep(t);
    const arts = await t.run(async (ctx) => (await ctx.db.query("aiArtifacts").collect()).filter((a) => a.kind === "rate_cut_promo"));
    expect(arts.length).toBeGreaterThan(0);
    for (const a of arts) {
      expect(a.summary).toMatch(/works at checkout only after you approve/);
      expect(a.body).toMatch(/works at checkout only after you approve/);
      expect(a.emailDraft?.body ?? "").not.toMatch(/approve/);
    }
  });

  it("U-05: approving twice does not create two promos or two posts", async () => {
    const { t, owner, account } = await setup();
    const { actions, posts, ps } = await sweep(t);
    const action = actions.find((a) => a.type === "social_post_draft")!;
    const postId = (action.payload as { postId: Id<"socialPosts"> }).postId;
    await pickAccount(t, postId, account);
    await owner.mutation(api.opsActions.approve, { id: action._id });
    await expect(owner.mutation(api.opsActions.approve, { id: action._id })).rejects.toThrow();
    const promo = (await promos(t)).find((p) => p._id === posts.find((x) => x._id === postId)!.promoId)!;
    expect(await owner.mutation(api.promos.activate, { id: promo._id })).toBe("already_active");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await promos(t)).length).toBe(ps.length);
    expect((await t.run((ctx) => ctx.db.query("socialPosts").collect())).length).toBe(posts.length);
  });

  it("U-06: another studio's member cannot approve or activate this studio's promo", async () => {
    const { t, bOwner, account } = await setup();
    const { actions, ps } = await sweep(t);
    const action = actions.find((a) => a.type === "social_post_draft")!;
    await pickAccount(t, (action.payload as { postId: Id<"socialPosts"> }).postId, account);
    await expect(bOwner.mutation(api.opsActions.approve, { id: action._id })).rejects.toThrow();
    await expect(bOwner.mutation(api.promos.activate, { id: ps[0]._id })).rejects.toThrow();
    expect((await promos(t)).every((p) => !p.active)).toBe(true);
  });

  it("U-06b: a member without marketing.approve cannot activate a promo", async () => {
    const { t, eng } = await setup();
    const { ps } = await sweep(t);
    await expect(eng.mutation(api.promos.activate, { id: ps[0]._id })).rejects.toThrow();
    expect((await promos(t)).every((p) => !p.active)).toBe(true);
  });

  it("U-07: a signed-out caller cannot activate a promo", async () => {
    const { t } = await setup();
    const { ps } = await sweep(t);
    vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://clerk.example.test");
    vi.stubEnv("PULSE_DEMO_MODE", "");
    await expect(t.mutation(api.promos.activate, { id: ps[0]._id })).rejects.toThrow();
    expect((await promos(t)).every((p) => !p.active)).toBe(true);
  });

  it("an expired suggestion cannot be approved", async () => {
    const { t, owner } = await setup();
    const { ps } = await sweep(t);
    await t.run(async (ctx) => { await ctx.db.patch(ps[0]._id, { endsAt: Date.now() - 1 }); });
    await expect(owner.mutation(api.promos.activate, { id: ps[0]._id })).rejects.toThrow(/ended/);
  });

  it("a second weekly sweep adds nothing while the suggestion is still waiting", async () => {
    const { t } = await setup();
    const { ps, posts } = await sweep(t);
    await t.action(internal.aiActions.generateRateCutPromosForOrg, { orgId: A });
    expect((await promos(t)).length).toBe(ps.length);
    expect((await t.run((ctx) => ctx.db.query("socialPosts").collect())).length).toBe(posts.length);
  });

  it("U-08: generated codes include a random part", async () => {
    expect(randomCodeSuffix()).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    const a = sweepPromoCode("ROOMAMONMOR20");
    const b = sweepPromoCode("ROOMAMONMOR20");
    expect(a).toMatch(/^ROOMAMONMOR20-[A-Z2-9]{5}$/);
    expect(a).not.toBe(b);
    const { t } = await setup();
    const { ps } = await sweep(t);
    expect(ps.every((p) => /-[A-Z2-9]{5}$/.test(p.code))).toBe(true);
  });

  it("U-09: the promo link uses APP_URL, not the old domain", async () => {
    const { t } = await setup();
    await sweep(t);
    const arts = await t.run(async (ctx) => (await ctx.db.query("aiArtifacts").collect()) as Doc<"aiArtifacts">[]);
    expect(arts.length).toBeGreaterThan(0);
    for (const a of arts) {
      const body = JSON.stringify(a);
      expect(body).toContain("https://app.pulse.test/book/studio-a");
      expect(body).not.toContain("pulse-dash-kit");
    }
  });

  it("U-10: an owner code still applies at checkout; the old sweep's permanent codes do not", async () => {
    const { t, owner, roomA } = await setup();
    await t.run(async (ctx) => {
      const o = (await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", A)).first())!;
      await ctx.db.patch(o._id, { discountCodes: [
        { code: "SUMMER10", pct: 10, label: "Summer", active: true },
        { code: "ROOMAMONMOR20", pct: 20, label: "Room A Monday morning (9am-12pm)", active: true },
      ] });
    });
    expect(await resolve(t, "summer10", roomA)).toMatchObject({ code: "SUMMER10", pct: 10 });
    expect(await resolve(t, "ROOMAMONMOR20", roomA)).toBeNull();
    // And an owner promo created on the Promos screen is live at once.
    const now = Date.now();
    await owner.mutation(api.promos.create, { code: "FALL15", pct: 15, startsAt: now - 1000, endsAt: now + 86_400_000 });
    expect(await resolve(t, "FALL15", roomA)).toMatchObject({ code: "FALL15", pct: 15 });
  });

  it("U-11: a deactivated promo does not fall back to a legacy code of the same name", async () => {
    const { t, owner, roomA } = await setup();
    const now = Date.now();
    const id = await owner.mutation(api.promos.create, { code: "VIP25", pct: 25, startsAt: now - 1000, endsAt: now + 86_400_000 });
    await t.run(async (ctx) => {
      const o = (await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", A)).first())!;
      await ctx.db.patch(o._id, { discountCodes: [{ code: "VIP25", pct: 25, label: "VIP", active: true }] });
    });
    expect(await resolve(t, "VIP25", roomA)).toMatchObject({ promoId: id });
    await owner.mutation(api.promos.deactivate, { id });
    expect(await resolve(t, "VIP25", roomA)).toBeNull();
  });

  it("recognises only the old sweep's code shape plus its label", () => {
    expect(isSweepMadeLegacyCode({ code: "STUDIMONMOR20", label: "Studio A Monday morning (9am-12pm)" })).toBe(true);
    expect(isSweepMadeLegacyCode({ code: "MONEVE15", label: "B Friday evening (5pm-10pm)" })).toBe(true);
    expect(isSweepMadeLegacyCode({ code: "STUDIMONMOR20", label: "Owner promo" })).toBe(false);
    expect(isSweepMadeLegacyCode({ code: "SUMMER20", label: "Room A Monday morning (9am-12pm)" })).toBe(false);
    expect(isSweepMadeLegacyCode({ code: "STUDIMONMOR20" })).toBe(false);
  });

  it("the weekly sweep runs only for studios that turned quiet-hour deals on; only an approver can turn it on", async () => {
    const { t, owner, eng } = await setup();
    expect(await t.query(internal.orgs.listQuietHourDealOrgIds, {})).toEqual([]);
    await expect(eng.mutation(api.orgs.setQuietHourDeals, { enabled: true })).rejects.toThrow();
    await owner.mutation(api.orgs.setQuietHourDeals, { enabled: true });
    expect(await t.query(internal.orgs.listQuietHourDealOrgIds, {})).toEqual([A]);
    const res = await t.action(internal.aiActions.runRateCutForAllOrgs, {});
    expect(res.scheduled).toBe(1);
  });

  it("the report lists the old sweep's codes and unapproved live promos, and changes nothing", async () => {
    const { t } = await setup();
    const now = Date.now();
    await t.run(async (ctx) => {
      const o = (await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", A)).first())!;
      await ctx.db.patch(o._id, { discountCodes: [
        { code: "SUMMER10", pct: 10, label: "Summer", active: true },
        { code: "ROOMAMONMOR20", pct: 20, label: "Room A Monday morning (9am-12pm)", active: true },
      ] });
      await ctx.db.insert("promos", { orgId: A, code: "ROOMAMONMOR20", pct: 20, label: "Room A Monday morning (9am-12pm)", startsAt: now, endsAt: now + 1e9, redemptions: 3, source: "rate_cut", active: true, createdBy: "pulse-ai", createdAt: now });
    });
    const before = JSON.stringify(await t.run(async (ctx) => [await ctx.db.query("orgs").collect(), await ctx.db.query("promos").collect()]));
    const r = await t.query(internal.promos.reportSweepCodes, {});
    expect(r.isDone).toBe(true);
    expect(r.studios).toHaveLength(1);
    expect(r.studios[0].orgId).toBe(A);
    expect(r.studios[0].sweepPermanentCodes.map((c) => c.code)).toEqual(["ROOMAMONMOR20"]);
    expect(r.studios[0].unapprovedLivePromos.map((p) => p.code)).toEqual(["ROOMAMONMOR20"]);
    const after = JSON.stringify(await t.run(async (ctx) => [await ctx.db.query("orgs").collect(), await ctx.db.query("promos").collect()]));
    expect(after).toBe(before);
  });
});
