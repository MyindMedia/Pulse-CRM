import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

describe("invites - record + lookup", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  async function seedOrg(orgId = "studio_skyline") {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId, name: "Skyline", slug: "skyline", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId, name: "Jordan", email: "owner@skyline.com", role: "owner", skills: [] });
    });
    return orgId;
  }

  it("record → lookupByToken returns sanitized invite while pending", async () => {
    const orgId = await seedOrg();
    const token = await t.mutation(internal.invites.record, {
      orgId, clerkOrgId: "org_clerk1", email: "owner@skyline.com",
      ownerName: "Jordan", studioName: "Skyline", invitedBy: "system",
      emailStatus: "sent", ttlMs: 7 * 24 * 60 * 60 * 1000,
    });
    expect(typeof token).toBe("string");
    const got = await t.query(api.invites.lookupByToken, { token });
    expect(got).toMatchObject({ state: "valid", email: "owner@skyline.com", studioName: "Skyline", ownerName: "Jordan" });
  });

  it("lookupByToken returns {state:'invalid'} for unknown token", async () => {
    const got = await t.query(api.invites.lookupByToken, { token: "nope" });
    expect(got).toEqual({ state: "invalid" });
  });

  it("lookupByToken returns {state:'expired'} after expiry", async () => {
    const orgId = await seedOrg();
    const token = await t.mutation(internal.invites.record, {
      orgId, email: "owner@skyline.com", ownerName: "Jordan",
      studioName: "Skyline", invitedBy: "system", emailStatus: "sent", ttlMs: -1000, // already past
    });
    const got = await t.query(api.invites.lookupByToken, { token });
    expect(got).toEqual({ state: "expired" });
  });
});

describe("invites - accept + revoke", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); vi.restoreAllMocks(); });

  async function seed() {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "studio_x", name: "X", slug: "x", plan: "studio", status: "active", clerkOrgId: "org_c" });
      await ctx.db.insert("members", { orgId: "studio_x", name: "Jordan", email: "o@x.com", role: "owner", skills: [] });
    });
    return await t.mutation(internal.invites.record, {
      orgId: "studio_x", clerkOrgId: "org_c", email: "o@x.com",
      ownerName: "Jordan", studioName: "X", invitedBy: "system", emailStatus: "sent",
    });
  }

  it("markAccepted attaches clerkUserId to owner member + flips status", async () => {
    const token = await seed();
    const inv = await t.query(api.invites.lookupByToken, { token });
    expect(inv.state).toBe("valid");
    await t.run(async (ctx) => {
      const row = await ctx.db.query("invites").withIndex("by_token", (q) => q.eq("token", token)).first();
      await ctx.runMutation(internal.invites.markAccepted, { inviteId: row!._id, clerkUserId: "user_new" });
    });
    const after = await t.query(api.invites.lookupByToken, { token });
    expect(after.state).toBe("accepted");
    const member = await t.run(async (ctx) =>
      await ctx.db.query("members").withIndex("by_org_clerk", (q) => q.eq("orgId", "studio_x").eq("clerkUserId", "user_new")).first());
    expect(member).not.toBeNull();
  });

  it("markAccepted twice is a no-op the second time (guard)", async () => {
    const token = await seed();
    const row = await t.run(async (ctx) =>
      await ctx.db.query("invites").withIndex("by_token", (q) => q.eq("token", token)).first());
    await t.run(async (ctx) => ctx.runMutation(internal.invites.markAccepted, { inviteId: row!._id, clerkUserId: "u1" }));
    await expect(
      t.run(async (ctx) => ctx.runMutation(internal.invites.markAccepted, { inviteId: row!._id, clerkUserId: "u2" })),
    ).rejects.toThrow(/already accepted/i);
  });
});
