import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

describe("agency - plan-cap enforcement", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  async function seedAgency(plan: "growth" | "max") {
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

  it("growth tier blocks the 2nd sub-account (cap = 1)", async () => {
    const owner = await seedAgency("growth");
    await owner.action(api.agency.createSubaccount, {
      name: "Studio 1", slug: "s1", plan: "core",
      ownerName: "X", ownerEmail: "x@x",
    });
    await expect(
      owner.action(api.agency.createSubaccount, {
        name: "Studio 2", slug: "s2", plan: "core",
        ownerName: "Y", ownerEmail: "y@x",
      }),
    ).rejects.toThrow(/Plan cap reached/);
  });

  it("max tier allows many sub-accounts", async () => {
    const owner = await seedAgency("max");
    for (let i = 0; i < 5; i++) {
      await owner.action(api.agency.createSubaccount, {
        name: `S${i}`, slug: `s${i}`, plan: "core",
        ownerName: "X", ownerEmail: `x${i}@x`,
      });
    }
    const subs = await owner.query(api.agency.subaccounts, {});
    expect(subs.length).toBe(5);
  });

  it("setStatus is gated by agency.subaccount.pause", async () => {
    const owner = await seedAgency("max");
    await owner.action(api.agency.createSubaccount, {
      name: "S", slug: "sx", plan: "core", ownerName: "X", ownerEmail: "x@x",
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
      await ctx.db.insert("orgs", { orgId: "sub_mine", name: "Mine", slug: "mine", tier: "growth", status: "active", agencyId: "org_mine" });
      await ctx.db.insert("orgs", { orgId: "sub_other", name: "Other", slug: "other", tier: "growth", status: "active", agencyId: "org_other" });
    });
    const asOwner = t.withIdentity({ subject: "user_ag", name: "Owner" });
    await asOwner.mutation(api.agency.enterAs, { orgId: "sub_mine" }); // ok
    await expect(asOwner.mutation(api.agency.enterAs, { orgId: "sub_other" })).rejects.toThrow(/not under this agency/i);
  });

  it("keeps each authenticated agency user's selected studio private", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      for (const user of ["user_one", "user_two"]) {
        await ctx.db.insert("agencyMembers", {
          agencyId: "org_mine", clerkUserId: user, email: `${user}@x.com`,
          name: user, role: "owner", status: "active", invitedAt: 0,
        });
      }
      await ctx.db.insert("orgs", { orgId: "sub_one", name: "One", slug: "one", tier: "growth", status: "active", agencyId: "org_mine" });
      await ctx.db.insert("orgs", { orgId: "sub_two", name: "Two", slug: "two", tier: "growth", status: "active", agencyId: "org_mine" });
      await ctx.db.insert("appState", { key: "demo", activeOrgId: "sub_two" });
    });
    const one = t.withIdentity({ subject: "user_one", name: "One" });
    const two = t.withIdentity({ subject: "user_two", name: "Two" });
    await one.mutation(api.agency.enterAs, { orgId: "sub_one" });
    await two.mutation(api.agency.enterAs, { orgId: "sub_two" });

    expect((await one.query(api.testHarness.resolve, {})).orgId).toBe("sub_one");
    expect((await two.query(api.testHarness.resolve, {})).orgId).toBe("sub_two");

    await one.mutation(api.agency.enterAs, {});
    expect((await one.query(api.testHarness.resolve, {})).orgId).toBeUndefined();
    expect((await two.query(api.testHarness.resolve, {})).orgId).toBe("sub_two");
    const demoState = await t.run(async (ctx) =>
      await ctx.db.query("appState").withIndex("by_key", (q) => q.eq("key", "demo")).first());
    expect(demoState?.activeOrgId).toBe("sub_two");
  });

  it("drops a stale selection after an agency staff scope change", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      const memberId = await ctx.db.insert("agencyMembers", {
        agencyId: "org_mine", clerkUserId: "user_staff", email: "staff@x.com",
        name: "Staff", role: "staff", status: "active", invitedAt: 0,
      });
      await ctx.db.insert("orgs", { orgId: "sub_allowed", name: "Allowed", slug: "allowed", tier: "growth", status: "active", agencyId: "org_mine" });
      await ctx.db.insert("orgs", { orgId: "sub_removed", name: "Removed", slug: "removed", tier: "growth", status: "active", agencyId: "org_mine" });
      await ctx.db.insert("agencyMemberScopes", { agencyId: "org_mine", agencyMemberId: memberId, subAccountOrgId: "sub_allowed" });
      await ctx.db.insert("agencyWorkspaceSelections", {
        agencyId: "org_mine", clerkUserId: "user_staff", orgId: "sub_removed", updatedAt: 1,
      });
    });
    const staff = t.withIdentity({ subject: "user_staff", name: "Staff" });
    expect((await staff.query(api.testHarness.resolve, {})).orgId).toBeUndefined();
    expect(await staff.mutation(api.testHarness.require_, {
      cap: "act_as_studio", orgId: "sub_removed",
    })).toEqual({ ok: false, code: "SCOPE_DENIED" });
  });
});

describe("agency - console scoping (multi-tenant isolation)", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("subaccounts lists only the viewer's agency, hiding the demo seed + other agencies", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId: "org_ag", name: "Mine", slug: "mine", plan: "max", status: "active", ownerClerkUserId: "u_owner", ownerEmail: "o@x" });
      await ctx.db.insert("agencyMembers", { agencyId: "org_ag", clerkUserId: "u_owner", email: "o@x", name: "Owner", role: "owner", status: "active", invitedAt: 0 });
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Slang City (Demo)", slug: "demo", tier: "growth", status: "active" }); // seed, no agency
      await ctx.db.insert("orgs", { orgId: "sub_mine", name: "Mine Studio", slug: "ms", tier: "growth", status: "active", agencyId: "org_ag" });
      await ctx.db.insert("orgs", { orgId: "sub_other", name: "Other Studio", slug: "os", tier: "growth", status: "active", agencyId: "org_other" });
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

describe("agency - who may create a studio (createSubaccount / inviteStudio)", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  async function seedAgency(plan: "core" | "growth" | "max", role: "owner" | "admin" | "staff" | "billing" = "owner") {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag", name: "AG", slug: "ag",
        plan, status: "active",
        ownerClerkUserId: "u_owner", ownerEmail: "o@x",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "u_member", email: "m@x",
        name: "Member", role, status: "active", invitedAt: 0,
      });
    });
    return t.withIdentity({ subject: "u_member", name: "Member" });
  }

  const sub = (slug: string, plan: "core" | "growth" | "max") => ({
    name: `Studio ${slug}`, slug, plan, ownerName: "X", ownerEmail: `${slug}@x.com`,
  });

  async function orgCount() {
    return await t.run(async (ctx) => (await ctx.db.query("orgs").collect()).length);
  }

  it("refuses an unauthenticated caller (no studio is created)", async () => {
    await expect(t.action(api.agency.createSubaccount, sub("anon", "max"))).rejects.toThrow();
    await expect(t.action(api.agency.inviteStudio, { email: "a@x.com", plan: "max" })).rejects.toThrow();
    const prev = process.env.CLERK_JWT_ISSUER_DOMAIN;
    process.env.CLERK_JWT_ISSUER_DOMAIN = "https://clerk.example";
    try {
      await expect(t.action(api.agency.createSubaccount, sub("anon2", "max"))).rejects.toThrow();
      await expect(t.action(api.agency.inviteStudio, { email: "b@x.com", plan: "max" })).rejects.toThrow();
    } finally {
      if (prev === undefined) delete process.env.CLERK_JWT_ISSUER_DOMAIN;
      else process.env.CLERK_JWT_ISSUER_DOMAIN = prev;
    }
    expect(await orgCount()).toBe(0);
  });

  it("refuses a plain studio member, even the studio's owner", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "studio_a", name: "A", slug: "a", tier: "max", status: "active" });
      await ctx.db.insert("members", {
        orgId: "studio_a", name: "Owner", role: "owner", clerkUserId: "u_studio", skills: [],
      });
    });
    const member = t.withIdentity({ subject: "u_studio", name: "S", orgId: "studio_a" });
    await expect(member.action(api.agency.createSubaccount, sub("mine", "max"))).rejects.toThrow();
    await expect(member.action(api.agency.inviteStudio, { email: "c@x.com", plan: "max" })).rejects.toThrow();
    expect(await orgCount()).toBe(1);
  });

  it("refuses an agency member whose role lacks agency.subaccount.create", async () => {
    const staff = await seedAgency("max", "staff");
    await expect(staff.action(api.agency.createSubaccount, sub("st", "core"))).rejects.toThrow();
    await expect(staff.action(api.agency.inviteStudio, { email: "d@x.com" })).rejects.toThrow();
    expect(await orgCount()).toBe(0);
  });

  it("lets an agency member create studios up to the agency's own plan", async () => {
    const admin = await seedAgency("growth", "admin");
    await admin.action(api.agency.createSubaccount, sub("g1", "growth"));
    const org = await t.run(async (ctx) =>
      (await ctx.db.query("orgs").collect()).find((o) => o.slug === "g1"));
    expect(org?.tier).toBe("growth");
    expect(org?.agencyId).toBe("org_ag");
  });

  it("refuses a plan above the agency's own plan (a Core agency cannot mint Max)", async () => {
    const owner = await seedAgency("core");
    await expect(owner.action(api.agency.createSubaccount, sub("m1", "max"))).rejects.toThrow(/plan/i);
    await expect(owner.action(api.agency.createSubaccount, sub("g2", "growth"))).rejects.toThrow(/plan/i);
    await expect(owner.action(api.agency.inviteStudio, { email: "e@x.com", plan: "max" })).rejects.toThrow(/plan/i);
    expect(await orgCount()).toBe(0);
  });

  it("inviteStudio honours the agency's studio cap too", async () => {
    const owner = await seedAgency("growth");
    await owner.action(api.agency.inviteStudio, { email: "f@x.com", plan: "core" });
    await expect(owner.action(api.agency.inviteStudio, { email: "g@x.com", plan: "core" }))
      .rejects.toThrow(/Plan cap reached/);
  });
});
