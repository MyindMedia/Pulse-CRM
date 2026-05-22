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
});
