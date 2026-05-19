import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

describe("grants — lifecycle", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  async function seedStudio(orgId = "org_studio") {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId, name: "S", slug: "s", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId, name: "O", role: "owner", clerkUserId: "u_o", skills: [] });
    });
    return t.withIdentity({ subject: "u_o", name: "O", orgId });
  }

  it("issue → list returns the new grant", async () => {
    const owner = await seedStudio();
    const grant = await owner.mutation(api.grants.issue, {
      scope: "song",
      entityId: "song_fake",
      email: "bass@x.com",
      name: "Session Bass",
    });
    expect(grant).not.toBeNull();
    expect(grant!.scope).toBe("song");
    const list = await owner.query(api.grants.list, {});
    expect(list.length).toBe(1);
    expect(list[0]._id).toBe(grant!._id);
  });

  it("token lookup returns grant when fresh, null after revoke", async () => {
    const owner = await seedStudio();
    const grant = await owner.mutation(api.grants.issue, {
      scope: "deliverable",
      entityId: "del_fake",
      email: "a@x", name: "Artist",
    });
    const ok = await t.query(api.grants.lookupByToken, { token: grant!.token });
    expect(ok).not.toBeNull();
    await owner.mutation(api.grants.revoke, { grantId: grant!._id });
    const dead = await t.query(api.grants.lookupByToken, { token: grant!.token });
    expect(dead).toBeNull();
  });

  it("token lookup returns null after expiry", async () => {
    const owner = await seedStudio();
    const grant = await owner.mutation(api.grants.issue, {
      scope: "splitsheet",
      entityId: "ss_fake",
      email: "x@x", name: "X",
      ttlMs: 1, // immediate expiry
    });
    await new Promise((r) => setTimeout(r, 5));
    const dead = await t.query(api.grants.lookupByToken, { token: grant!.token });
    expect(dead).toBeNull();
  });

  it("intern cannot issue grants", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_x", name: "X", slug: "x", plan: "studio", status: "active",
      });
      await ctx.db.insert("members", {
        orgId: "org_x", name: "I", role: "intern", clerkUserId: "u_i", skills: [],
      });
    });
    const asIntern = t.withIdentity({ subject: "u_i", name: "I", orgId: "org_x" });
    await expect(
      asIntern.mutation(api.grants.issue, {
        scope: "session", entityId: "s_fake", email: "x@x", name: "X",
      }),
    ).rejects.toThrow();
  });
});
