import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
    // No orgId / orgType claims (no custom JWT template) - just the subject.
    const asOwner = t.withIdentity({ subject: "user_noorg", name: "NoOrgType" });
    const result = await asOwner.query(api.testHarness.resolve, {});
    expect(result.kind).toBe("agency_member");
    expect(result.caps).toContain("agency.viewAll");
    // Agency owners act as a studio → must carry studio caps too.
    expect(result.caps).toContain("schedule.manage");
    expect(result.caps).toContain("sessions.edit");
  });
});

// ── AGENCY_ADMIN_EMAILS allowlist convergence ───────────────────
// The agency console (agency.access) lets an operator in by email allowlist,
// but resolveViewer historically only granted agency caps from the
// agencyMembers table. A user allowlisted but lacking a row passed the console
// gate yet was cap-denied on every studio read of a sub-account, silently
// emptying cap-gated panels (waitlist, etc.). These tests pin the convergence:
// an allowlisted operator resolves as the sole agency's owner.
describe("access engine - AGENCY_ADMIN_EMAILS allowlist", () => {
  let t: ReturnType<typeof convexTest>;
  const prevEnv = process.env.AGENCY_ADMIN_EMAILS;
  beforeEach(() => { t = convexTest(schema); });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.AGENCY_ADMIN_EMAILS;
    else process.env.AGENCY_ADMIN_EMAILS = prevEnv;
  });

  async function seedSoleAgencyWithSub() {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_sole", name: "Sole", slug: "sole",
        plan: "agency", status: "active",
        ownerClerkUserId: "someone_else", ownerEmail: "founder@studio.com",
      });
      await ctx.db.insert("orgs", {
        orgId: "org_sub", name: "Sub", slug: "sub", plan: "studio",
        status: "active", agencyId: "org_sole",
      });
      // The operator is "entered into" the sub-account (global active org).
      await ctx.db.insert("appState", { key: "demo", activeOrgId: "org_sub" });
    });
  }

  it("allowlisted operator with NO agencyMembers row resolves as sole-agency owner", async () => {
    process.env.AGENCY_ADMIN_EMAILS = "ADMIN@x.com"; // case-insensitive
    await seedSoleAgencyWithSub();
    const asAdmin = t.withIdentity({ subject: "user_admin", name: "Admin", email: "admin@x.com" });
    const result = await asAdmin.query(api.testHarness.resolve, {});
    expect(result.kind).toBe("agency_member");
    expect(result.role).toBe("owner");
    expect(result.orgId).toBe("org_sub"); // acts-as the entered sub-account
    expect(result.caps).toContain("sessions.read");
  });

  it("allowlisted operator can read sub-account sessions (the empty-panel bug)", async () => {
    process.env.AGENCY_ADMIN_EMAILS = "admin@x.com";
    await seedSoleAgencyWithSub();
    const asAdmin = t.withIdentity({ subject: "user_admin", name: "Admin", email: "admin@x.com" });
    const r = await asAdmin.mutation(api.testHarness.require_, { cap: "sessions.read", orgId: "org_sub" });
    expect(r).toEqual({ ok: true, kind: "agency_member" });
  });

  it("does NOT elevate a user whose email is not on the allowlist", async () => {
    process.env.AGENCY_ADMIN_EMAILS = "admin@x.com";
    await seedSoleAgencyWithSub();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", {
        orgId: "org_sub", name: "Stranger", role: "engineer",
        clerkUserId: "user_stranger", skills: [],
      });
    });
    const asStranger = t.withIdentity({
      subject: "user_stranger", name: "Stranger", email: "stranger@x.com", orgId: "org_sub",
    });
    const result = await asStranger.query(api.testHarness.resolve, {});
    expect(result.kind).toBe("studio_member");
    expect(result.role).toBe("engineer");
  });

  it("does NOT elevate via allowlist when multiple agencies exist (safety gate)", async () => {
    process.env.AGENCY_ADMIN_EMAILS = "admin@x.com";
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_a1", name: "A1", slug: "a1", plan: "agency", status: "active",
        ownerClerkUserId: "x", ownerEmail: "x@x",
      });
      await ctx.db.insert("agencies", {
        agencyId: "org_a2", name: "A2", slug: "a2", plan: "agency", status: "active",
        ownerClerkUserId: "y", ownerEmail: "y@y",
      });
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "solo", status: "active",
      });
    });
    const asAdmin = t.withIdentity({ subject: "user_admin", name: "Admin", email: "admin@x.com" });
    const result = await asAdmin.query(api.testHarness.resolve, {});
    expect(result.kind).not.toBe("agency_member");
  });

  it("empty AGENCY_ADMIN_EMAILS elevates nobody (console-only 'allow all' stays out of resolveViewer)", async () => {
    process.env.AGENCY_ADMIN_EMAILS = "";
    await seedSoleAgencyWithSub();
    const asAnyone = t.withIdentity({ subject: "user_any", name: "Any", email: "any@x.com" });
    const result = await asAnyone.query(api.testHarness.resolve, {});
    expect(result.kind).not.toBe("agency_member");
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
