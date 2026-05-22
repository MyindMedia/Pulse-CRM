import { describe, it, expect, beforeEach } from "vitest";
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
