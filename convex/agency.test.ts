import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

describe("agency - plan-cap enforcement", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  async function seedAgency(plan: "pro" | "agency") {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag", name: "AG", slug: "ag",
        plan, status: "active",
        ownerClerkUserId: "u_owner", ownerEmail: "o@x",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "u_owner", email: "o@x",
        name: "Owner", role: "owner", status: "active", invitedAt: 0,
      });
    });
    return t.withIdentity({
      subject: "u_owner", name: "Owner",
      orgId: "org_ag", orgType: "agency",
    } as { subject: string; name: string; orgId: string; orgType: string });
  }

  it("pro tier blocks the 2nd sub-account (cap = 1)", async () => {
    const owner = await seedAgency("pro");
    await owner.action(api.agency.createSubaccount, {
      name: "Studio 1", slug: "s1", plan: "studio",
      ownerName: "X", ownerEmail: "x@x",
    });
    await expect(
      owner.action(api.agency.createSubaccount, {
        name: "Studio 2", slug: "s2", plan: "studio",
        ownerName: "Y", ownerEmail: "y@x",
      }),
    ).rejects.toThrow(/Plan cap reached/);
  });

  it("agency tier allows many sub-accounts", async () => {
    const owner = await seedAgency("agency");
    for (let i = 0; i < 5; i++) {
      await owner.action(api.agency.createSubaccount, {
        name: `S${i}`, slug: `s${i}`, plan: "studio",
        ownerName: "X", ownerEmail: `x${i}@x`,
      });
    }
    const subs = await owner.query(api.agency.subaccounts, {});
    expect(subs.length).toBe(5);
  });

  it("setStatus is gated by agency.subaccount.pause", async () => {
    const owner = await seedAgency("agency");
    await owner.action(api.agency.createSubaccount, {
      name: "S", slug: "sx", plan: "studio", ownerName: "X", ownerEmail: "x@x",
    });
    const sub = (await owner.query(api.agency.subaccounts, {}))[0];
    // Owner can pause
    await owner.mutation(api.agency.setStatus, { orgId: sub.orgId, status: "paused" });
    // Random studio-only identity cannot
    await t.run(async (ctx) => {
      await ctx.db.insert("members", {
        orgId: sub.orgId, name: "Random", role: "intern", clerkUserId: "u_rand", skills: [],
      });
    });
    const stranger = t.withIdentity({ subject: "u_rand", name: "R", orgId: sub.orgId });
    await expect(
      stranger.mutation(api.agency.setStatus, { orgId: sub.orgId, status: "active" }),
    ).rejects.toThrow();
  });
});

describe("agency - enterAs (view as client) ownership guard", () => {
  it("an agency owner can enter their own studio but not a foreign one", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_mine", clerkUserId: "user_ag", email: "a@x.com",
        name: "Owner", role: "owner", status: "active", invitedAt: 0,
      });
      await ctx.db.insert("orgs", { orgId: "sub_mine", name: "Mine", slug: "mine", plan: "studio", status: "active", agencyId: "org_mine" });
      await ctx.db.insert("orgs", { orgId: "sub_other", name: "Other", slug: "other", plan: "studio", status: "active", agencyId: "org_other" });
    });
    const asOwner = t.withIdentity({ subject: "user_ag", name: "Owner" });
    await asOwner.mutation(api.agency.enterAs, { orgId: "sub_mine" }); // ok
    await expect(asOwner.mutation(api.agency.enterAs, { orgId: "sub_other" })).rejects.toThrow(/your agency/i);
  });
});

describe("agency - console scoping (multi-tenant isolation)", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("subaccounts lists only the viewer's agency, hiding the demo seed + other agencies", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId: "org_ag", name: "Mine", slug: "mine", plan: "agency", status: "active", ownerClerkUserId: "u_owner", ownerEmail: "o@x" });
      await ctx.db.insert("agencyMembers", { agencyId: "org_ag", clerkUserId: "u_owner", email: "o@x", name: "Owner", role: "owner", status: "active", invitedAt: 0 });
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Slang City (Demo)", slug: "demo", plan: "studio", status: "active" }); // seed, no agency
      await ctx.db.insert("orgs", { orgId: "sub_mine", name: "Mine Studio", slug: "ms", plan: "studio", status: "active", agencyId: "org_ag" });
      await ctx.db.insert("orgs", { orgId: "sub_other", name: "Other Studio", slug: "os", plan: "studio", status: "active", agencyId: "org_other" });
    });
    const owner = t.withIdentity({ subject: "u_owner", name: "Owner", orgId: "org_ag", orgType: "agency" } as { subject: string; name: string; orgId: string; orgType: string });
    const list = await owner.query(api.agency.subaccounts, {});
    expect(list.map((o) => o.orgId).sort()).toEqual(["sub_mine"]);

    // The single-subaccount query refuses the demo + another agency's org.
    expect(await owner.query(api.agency.subaccount, { orgId: "pulse-demo" })).toBeNull();
    expect(await owner.query(api.agency.subaccount, { orgId: "sub_other" })).toBeNull();
    expect((await owner.query(api.agency.subaccount, { orgId: "sub_mine" }))?.orgId).toBe("sub_mine");
  });
});
