import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const makeT = () => convexTest(schema);
type T = ReturnType<typeof makeT>;

const ALL_OFF = { hidePricing: false, requireApproval: false, roomBlocks: false, changeApproval: false };

async function studio(t: T, orgId: string, extra: Record<string, unknown> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId, name: orgId, slug: orgId, tier: "core", status: "active", ...extra,
    });
  });
}

async function member(t: T, orgId: string, user: string, role: "owner" | "manager" | "engineer") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { orgId, name: user, role, clerkUserId: user, skills: [] });
  });
  return t.withIdentity({ subject: user, name: user, orgId });
}

async function features(t: T, orgId: string) {
  return t.run(async (ctx) =>
    (await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first())!
      .bookingFeatures ?? null,
  );
}

async function activity(t: T, orgId: string) {
  return t.run(async (ctx) =>
    (await ctx.db.query("activity").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect())
      .filter((a) => a.kind === "settings.booking_feature"),
  );
}

async function agency(t: T, agencyId: string, user: string, role: "owner" | "admin" | "staff" | "billing") {
  return t.run(async (ctx) => {
    const existing = await ctx.db.query("agencies").filter((q) => q.eq(q.field("agencyId"), agencyId)).first();
    if (!existing) {
      await ctx.db.insert("agencies", {
        agencyId, name: agencyId, slug: agencyId, plan: "max", status: "active",
        ownerClerkUserId: user, ownerEmail: `${user}@x`,
      });
    }
    return ctx.db.insert("agencyMembers", {
      agencyId, clerkUserId: user, email: `${user}@x`, name: user, role, status: "active", invitedAt: 0,
    });
  });
}

describe("bookingFeatures (studio)", () => {
  let t: T;
  beforeEach(() => { t = makeT(); });

  it("is all off for a studio that never set anything", async () => {
    await studio(t, "org_s");
    const owner = await member(t, "org_s", "u_owner", "owner");
    expect(await owner.query(api.bookingFeatures.get, {})).toEqual(ALL_OFF);
    // A no-op write changes nothing and logs nothing.
    const res = await owner.mutation(api.bookingFeatures.set, {});
    expect(res.changed).toBe(0);
    expect(await features(t, "org_s")).toBeNull();
    expect(await activity(t, "org_s")).toHaveLength(0);
  });

  it("owner can turn a switch on, and it is logged", async () => {
    await studio(t, "org_s");
    const owner = await member(t, "org_s", "u_owner", "owner");
    await owner.mutation(api.bookingFeatures.set, { hidePricing: true });
    expect(await owner.query(api.bookingFeatures.get, {})).toEqual({ ...ALL_OFF, hidePricing: true });
    const log = await activity(t, "org_s");
    expect(log).toHaveLength(1);
    expect(log[0].summary).toMatch(/Hide prices on the booking link turned on by u_owner/);
  });

  it("manager can set switches too", async () => {
    await studio(t, "org_s");
    const manager = await member(t, "org_s", "u_mgr", "manager");
    await manager.mutation(api.bookingFeatures.set, { requireApproval: true });
    expect((await features(t, "org_s"))?.requireApproval).toBe(true);
  });

  it("engineer is refused and nothing changes", async () => {
    await studio(t, "org_s");
    const engineer = await member(t, "org_s", "u_eng", "engineer");
    await expect(
      engineer.mutation(api.bookingFeatures.set, { roomBlocks: true }),
    ).rejects.toThrow();
    expect(await features(t, "org_s")).toBeNull();
    // Reading is fine for anyone in the studio.
    expect(await engineer.query(api.bookingFeatures.get, {})).toEqual(ALL_OFF);
  });

  it("switches merge without clobbering each other", async () => {
    await studio(t, "org_s");
    const owner = await member(t, "org_s", "u_owner", "owner");
    await owner.mutation(api.bookingFeatures.set, { roomBlocks: true });
    await owner.mutation(api.bookingFeatures.set, { hidePricing: true });
    await owner.mutation(api.bookingFeatures.set, { roomBlocks: false });
    expect(await owner.query(api.bookingFeatures.get, {})).toEqual({
      ...ALL_OFF, hidePricing: true, roomBlocks: false,
    });
    // Setting a switch to the value it already has is not a change.
    await owner.mutation(api.bookingFeatures.set, { hidePricing: true });
    expect(await activity(t, "org_s")).toHaveLength(3);
  });

  it("does not touch other studio fields", async () => {
    await studio(t, "org_s", { tagline: "Keep me", showGearOnBooking: true });
    const owner = await member(t, "org_s", "u_owner", "owner");
    await owner.mutation(api.bookingFeatures.set, { changeApproval: true });
    const org = await t.run(async (ctx) => ctx.db.query("orgs").first());
    expect(org!.tagline).toBe("Keep me");
    expect(org!.showGearOnBooking).toBe(true);
  });
});

describe("bookingFeatures (agency bulk)", () => {
  let t: T;
  beforeEach(() => { t = makeT(); });

  it("agency owner applies to selected studios only, merging existing switches", async () => {
    await studio(t, "sub_a", { agencyId: "ag_1", bookingFeatures: { changeApproval: true } });
    await studio(t, "sub_b", { agencyId: "ag_1" });
    await studio(t, "sub_c", { agencyId: "ag_1" });
    await agency(t, "ag_1", "u_ag_owner", "owner");
    const owner = t.withIdentity({ subject: "u_ag_owner", name: "Ag Owner" });

    const res = await owner.mutation(api.bookingFeatures.agencySetBookingFeatures, {
      orgIds: ["sub_a", "sub_b", "sub_a"],
      features: { hidePricing: true, requireApproval: true },
    });
    expect(res).toEqual({ studios: 2, changed: 4 });
    expect(await features(t, "sub_a")).toEqual({ changeApproval: true, hidePricing: true, requireApproval: true });
    expect(await features(t, "sub_b")).toEqual({ hidePricing: true, requireApproval: true });
    expect(await features(t, "sub_c")).toBeNull();
    expect(await activity(t, "sub_a")).toHaveLength(2);

    const list = await owner.query(api.bookingFeatures.agencyListBookingFeatures, {});
    expect(list.map((r) => r.orgId)).toEqual(["sub_a", "sub_b", "sub_c"]);
    expect(list[0].features).toEqual({ hidePricing: true, requireApproval: true, roomBlocks: false, changeApproval: true });
  });

  it("refuses a studio from another agency and writes nothing", async () => {
    await studio(t, "sub_a", { agencyId: "ag_1" });
    await studio(t, "sub_other", { agencyId: "ag_2" });
    await agency(t, "ag_1", "u_ag_owner", "owner");
    const owner = t.withIdentity({ subject: "u_ag_owner", name: "Ag Owner" });
    await expect(
      owner.mutation(api.bookingFeatures.agencySetBookingFeatures, {
        orgIds: ["sub_a", "sub_other"], features: { roomBlocks: true },
      }),
    ).rejects.toThrow();
    expect(await features(t, "sub_a")).toBeNull();
    expect(await features(t, "sub_other")).toBeNull();
  });

  it("staff only see and touch their scoped studios", async () => {
    await studio(t, "sub_in", { agencyId: "ag_1" });
    await studio(t, "sub_out", { agencyId: "ag_1" });
    await agency(t, "ag_1", "u_ag_owner", "owner");
    const staffId = await agency(t, "ag_1", "u_staff", "staff");
    await t.run(async (ctx) => {
      await ctx.db.insert("agencyMemberScopes", {
        agencyId: "ag_1", agencyMemberId: staffId, subAccountOrgId: "sub_in",
      });
    });
    const staff = t.withIdentity({ subject: "u_staff", name: "Staff" });

    const list = await staff.query(api.bookingFeatures.agencyListBookingFeatures, {});
    expect(list.map((r) => r.orgId)).toEqual(["sub_in"]);

    await expect(
      staff.mutation(api.bookingFeatures.agencySetBookingFeatures, {
        orgIds: ["sub_in", "sub_out"], features: { hidePricing: true },
      }),
    ).rejects.toThrow();
    expect(await features(t, "sub_in")).toBeNull();
    expect(await features(t, "sub_out")).toBeNull();

    await staff.mutation(api.bookingFeatures.agencySetBookingFeatures, {
      orgIds: ["sub_in"], features: { hidePricing: true },
    });
    expect(await features(t, "sub_in")).toEqual({ hidePricing: true });
    expect(await features(t, "sub_out")).toBeNull();
  });

  it("studio members and agency billing users cannot use the bulk tools", async () => {
    await studio(t, "sub_a", { agencyId: "ag_1" });
    const owner = await member(t, "sub_a", "u_studio_owner", "owner");
    expect(await owner.query(api.bookingFeatures.agencyListBookingFeatures, {})).toEqual([]);
    await expect(
      owner.mutation(api.bookingFeatures.agencySetBookingFeatures, {
        orgIds: ["sub_a"], features: { hidePricing: true },
      }),
    ).rejects.toThrow();

    await agency(t, "ag_1", "u_billing", "billing");
    const billing = t.withIdentity({ subject: "u_billing", name: "Billing" });
    expect(await billing.query(api.bookingFeatures.agencyListBookingFeatures, {})).toEqual([]);
    await expect(
      billing.mutation(api.bookingFeatures.agencySetBookingFeatures, {
        orgIds: ["sub_a"], features: { hidePricing: true },
      }),
    ).rejects.toThrow();
    expect(await features(t, "sub_a")).toBeNull();
  });
});
