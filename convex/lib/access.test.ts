import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";

describe("access engine - resolveViewer", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("demo mode returns studio_member owner pointed at pulse-demo", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "solo",
        status: "active",
      });
    });
    const result = await t.query(api.testHarness.resolve, {});
    expect(result.kind).toBe("studio_member");
    expect(result.role).toBe("owner");
  });

  it("studio member with Clerk identity resolves with their role", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_abc", name: "Acme", slug: "acme", plan: "studio",
        status: "active",
      });
      await ctx.db.insert("members", {
        orgId: "org_abc", name: "Eng", role: "engineer",
        clerkUserId: "user_eng", skills: [],
      });
    });
    const asEng = t.withIdentity({ subject: "user_eng", name: "Eng", orgId: "org_abc" });
    const result = await asEng.query(api.testHarness.resolve, {});
    expect(result.kind).toBe("studio_member");
    expect(result.role).toBe("engineer");
    expect(result.caps).toContain("songs.read");
    expect(result.caps).not.toContain("songs.delete");
  });

  it("agency owner with agency org type resolves as agency_member", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag", name: "AcmeMG", slug: "acme",
        plan: "agency", status: "active",
        ownerClerkUserId: "user_owner", ownerEmail: "o@x.com",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "user_owner", email: "o@x.com",
        name: "Owner", role: "owner", status: "active", invitedAt: 0,
      });
    });
    const asOwner = t.withIdentity({
      subject: "user_owner", name: "Owner",
      orgId: "org_ag", orgType: "agency",
    } as { subject: string; name: string; orgId: string; orgType: string });
    const result = await asOwner.query(api.testHarness.resolve, {});
    expect(result.kind).toBe("agency_member");
    expect(result.role).toBe("owner");
    expect(result.caps).toContain("billing.edit");
  });

  it("agency owner resolves as agency_member even WITHOUT orgType in the token", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag2", clerkUserId: "user_noorg", email: "n@x.com",
        name: "NoOrgType", role: "owner", status: "active", invitedAt: 0,
      });
    });
    // No orgId / orgType claims (no custom JWT template) — just the subject.
    const asOwner = t.withIdentity({ subject: "user_noorg", name: "NoOrgType" });
    const result = await asOwner.query(api.testHarness.resolve, {});
    expect(result.kind).toBe("agency_member");
    expect(result.caps).toContain("agency.viewAll");
  });
});

describe("access engine - requireCapability", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("engineer can edit songs (allow)", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org_a", name: "E", role: "engineer", clerkUserId: "u1", skills: [] });
    });
    const asEng = t.withIdentity({ subject: "u1", name: "E", orgId: "org_a" });
    const r = await asEng.mutation(api.testHarness.require_, { cap: "songs.edit", orgId: "org_a" });
    expect(r).toEqual({ ok: true, kind: "studio_member" });
  });

  it("engineer cannot delete songs (deny CAPABILITY_DENIED)", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org_a", name: "E", role: "engineer", clerkUserId: "u1", skills: [] });
    });
    const asEng = t.withIdentity({ subject: "u1", name: "E", orgId: "org_a" });
    const r = await asEng.mutation(api.testHarness.require_, { cap: "songs.delete", orgId: "org_a" });
    expect(r).toEqual({ ok: false, code: "CAPABILITY_DENIED" });
  });

  it("intern cannot edit anything (deny)", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org_a", name: "I", role: "intern", clerkUserId: "u_i", skills: [] });
    });
    const asIntern = t.withIdentity({ subject: "u_i", name: "I", orgId: "org_a" });
    const r = await asIntern.mutation(api.testHarness.require_, { cap: "songs.edit", orgId: "org_a" });
    expect(r.ok).toBe(false);
  });

  it("accountant can refund (allow)", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org_a", name: "Acc", role: "accountant", clerkUserId: "u_a", skills: [] });
    });
    const asAcc = t.withIdentity({ subject: "u_a", name: "Acc", orgId: "org_a" });
    const r = await asAcc.mutation(api.testHarness.require_, { cap: "finance.refund", orgId: "org_a" });
    expect(r.ok).toBe(true);
  });

  it("studio member denied cross-org access (SCOPE_DENIED)", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("orgs", { orgId: "org_b", name: "B", slug: "b", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org_a", name: "O", role: "owner", clerkUserId: "u_o", skills: [] });
    });
    const asOwner = t.withIdentity({ subject: "u_o", name: "O", orgId: "org_a" });
    const r = await asOwner.mutation(api.testHarness.require_, { cap: "songs.edit", orgId: "org_b" });
    expect(r).toEqual({ ok: false, code: "SCOPE_DENIED" });
  });

  it("agency staff denied for sub-account outside scope", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag", name: "AG", slug: "ag", plan: "agency", status: "active",
        ownerClerkUserId: "u_own", ownerEmail: "o@x",
      });
      const memberId = await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "u_staff", email: "s@x", name: "S",
        role: "staff", status: "active", invitedAt: 0,
      });
      await ctx.db.insert("orgs", {
        orgId: "org_sub1", name: "Sub1", slug: "s1", plan: "studio", status: "active",
        agencyId: "org_ag",
      });
      await ctx.db.insert("orgs", {
        orgId: "org_sub2", name: "Sub2", slug: "s2", plan: "studio", status: "active",
        agencyId: "org_ag",
      });
      // Staff scoped only to sub1
      await ctx.db.insert("agencyMemberScopes", {
        agencyId: "org_ag", agencyMemberId: memberId, subAccountOrgId: "org_sub1",
      });
    });
    const asStaff = t.withIdentity({
      subject: "u_staff", name: "S",
      orgId: "org_ag", orgType: "agency",
    } as { subject: string; name: string; orgId: string; orgType: string });
    const allowed = await asStaff.mutation(api.testHarness.require_, {
      cap: "act_as_studio", orgId: "org_sub1",
    });
    expect(allowed.ok).toBe(true);
    const denied = await asStaff.mutation(api.testHarness.require_, {
      cap: "act_as_studio", orgId: "org_sub2",
    });
    expect(denied).toEqual({ ok: false, code: "SCOPE_DENIED" });
  });
});
