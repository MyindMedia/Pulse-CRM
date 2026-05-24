import { describe, it, expect, beforeEach, vi } from "vitest";
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

  // Find an invite row by token without a custom index (t.run's ctx is typed
  // with system indexes only); collect + filter in JS instead.
  async function inviteIdByToken(token: string) {
    return await t.run(async (ctx) => {
      const rows = await ctx.db.query("invites").collect();
      return rows.find((r) => r.token === token)?._id;
    });
  }

  it("markAccepted attaches clerkUserId to owner member + flips status", async () => {
    const token = await seed();
    const inv = await t.query(api.invites.lookupByToken, { token });
    expect(inv.state).toBe("valid");
    const inviteId = await inviteIdByToken(token);
    await t.mutation(internal.invites.markAccepted, { inviteId: inviteId!, clerkUserId: "user_new" });
    const after = await t.query(api.invites.lookupByToken, { token });
    expect(after.state).toBe("accepted");
    const member = await t.run(async (ctx) => {
      const members = await ctx.db.query("members").collect();
      return members.find((m) => m.clerkUserId === "user_new");
    });
    expect(member).toBeTruthy();
  });

  it("markAccepted twice throws on the second call (idempotency guard)", async () => {
    const token = await seed();
    const inviteId = await inviteIdByToken(token);
    await t.mutation(internal.invites.markAccepted, { inviteId: inviteId!, clerkUserId: "u1" });
    await expect(
      t.mutation(internal.invites.markAccepted, { inviteId: inviteId!, clerkUserId: "u2" }),
    ).rejects.toThrow(/already accepted/i);
  });
});

describe("createSubaccount records an invite", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("records a pending invite row for the owner email", async () => {
    // Demo path: no CLERK_SECRET_KEY, single-tenant (no agency).
    await t.action(api.agency.createSubaccount, {
      name: "Skyline", slug: "skyline", plan: "studio",
      ownerName: "Jordan", ownerEmail: "Owner@Skyline.com",
    });
    const invites = await t.run(async (ctx) =>
      await ctx.db.query("invites").collect());
    const mine = invites.filter((i) => i.email === "owner@skyline.com");
    expect(mine.length).toBe(1);
    expect(mine[0].status).toBe("pending");
    expect(mine[0].studioName).toBe("Skyline");
    // No RESEND_API_KEY in test -> simulated.
    expect(mine[0].emailStatus).toBe("simulated");
  });
});

describe("invites - resend", () => {
  it("resend re-issues a fresh pending invite for the org owner", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "studio_z", name: "Z", slug: "z", plan: "studio", status: "active", ownerName: "Owner", ownerEmail: "o@z.com", clerkOrgId: "org_z" });
      await ctx.db.insert("members", { orgId: "studio_z", name: "Owner", email: "o@z.com", role: "owner", skills: [] });
    });
    await t.action(api.invites.resend, { orgId: "studio_z" });
    const invites = await t.run(async (ctx) => await ctx.db.query("invites").collect());
    const forZ = invites.filter((i) => i.orgId === "studio_z");
    expect(forZ.some((i) => i.status === "pending")).toBe(true);
  });

  it("resend is capability-gated when Clerk is configured", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "studio_g", name: "G", slug: "g", plan: "studio", status: "active", ownerName: "O", ownerEmail: "o@g.com" });
    });
    process.env.CLERK_SECRET_KEY = "sk_test";
    try {
      // No agency identity -> resolves to a studio viewer lacking the agency
      // sub-account capability -> the guard must reject.
      await expect(t.action(api.invites.resend, { orgId: "studio_g" })).rejects.toThrow();
      const invites = await t.run(async (ctx) => await ctx.db.query("invites").collect());
      expect(invites.filter((i) => i.orgId === "studio_g").length).toBe(0);
    } finally {
      delete process.env.CLERK_SECRET_KEY;
    }
  });
});

describe("invites - list never crashes the detail page", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("returns [] (does NOT throw) when the viewer lacks the capability", async () => {
    // Regression: the agency sub-account detail page calls invites.list. A
    // demo/studio viewer lacks agency.subaccount.pause, and a thrown AccessError
    // (no error boundary) blanked the whole route with "page couldn't load".
    // The query must now degrade to [] instead of throwing.
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_orphan", name: "Orphan Studio", slug: "orphan",
        plan: "studio", status: "active", createdByAgency: true,
      });
      await ctx.db.insert("invites", {
        orgId: "org_orphan", email: "o@orphan.com", ownerName: "O",
        studioName: "Orphan Studio", role: "owner", token: "tok_x",
        status: "pending", expiresAt: Date.now() + 1000, invitedBy: "system",
        emailStatus: "sent",
      });
    });
    const rows = await t.query(api.invites.list, { orgId: "org_orphan" });
    expect(rows).toEqual([]);
  });

  it("returns the invite rows for an authorized agency owner", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag", name: "Acme", slug: "acme",
        plan: "agency", status: "active",
        ownerClerkUserId: "user_owner", ownerEmail: "o@acme.com",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "user_owner", email: "o@acme.com",
        name: "Owner", role: "owner", status: "active", invitedAt: 0,
      });
      await ctx.db.insert("orgs", {
        orgId: "org_sub", name: "Sub", slug: "sub", plan: "studio",
        status: "active", createdByAgency: true, agencyId: "org_ag",
      });
      await ctx.db.insert("invites", {
        orgId: "org_sub", email: "o@sub.com", ownerName: "O",
        studioName: "Sub", role: "owner", token: "tok_y",
        status: "pending", expiresAt: Date.now() + 1000, invitedBy: "system",
        emailStatus: "sent",
      });
    });
    const asOwner = t.withIdentity({
      subject: "user_owner", name: "Owner", orgId: "org_ag", orgType: "agency",
    } as { subject: string; name: string; orgId: string; orgType: string });
    const rows = await asOwner.query(api.invites.list, { orgId: "org_sub" });
    expect(rows.length).toBe(1);
    expect(rows[0].email).toBe("o@sub.com");
  });
});
