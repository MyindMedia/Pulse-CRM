import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

describe("agencyStaff - CRUD + scoping", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  async function seedAgency() {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag", name: "AG", slug: "ag", plan: "agency", status: "active",
        ownerClerkUserId: "u_owner", ownerEmail: "o@x",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "u_owner", email: "o@x", name: "Owner",
        role: "owner", status: "active", invitedAt: 0,
      });
      await ctx.db.insert("orgs", {
        orgId: "org_sub1", name: "Sub1", slug: "s1", plan: "studio", status: "active", agencyId: "org_ag",
      });
      await ctx.db.insert("orgs", {
        orgId: "org_sub2", name: "Sub2", slug: "s2", plan: "studio", status: "active", agencyId: "org_ag",
      });
    });
    return t.withIdentity({
      subject: "u_owner", name: "Owner", orgId: "org_ag", orgType: "agency",
    } as { subject: string; name: string; orgId: string; orgType: string });
  }

  it("owner invites a staff member; list returns it", async () => {
    const owner = await seedAgency();
    await owner.mutation(api.agencyStaff.invite, {
      email: "s@x", name: "Staffer", role: "staff",
    });
    const list = await owner.query(api.agencyStaff.list, {});
    expect(list.length).toBe(2); // owner + new staff
  });

  it("setScopes replaces the scope list", async () => {
    const owner = await seedAgency();
    const created = await owner.mutation(api.agencyStaff.invite, {
      email: "s@x", name: "Staffer", role: "staff",
    });
    await owner.mutation(api.agencyStaff.setScopes, {
      memberId: created!._id,
      subAccountOrgIds: ["org_sub1"],
    });
    const scopes1 = await owner.query(api.agencyStaff.scopes, { memberId: created!._id });
    expect(scopes1.length).toBe(1);
    expect(scopes1[0].subAccountOrgId).toBe("org_sub1");

    await owner.mutation(api.agencyStaff.setScopes, {
      memberId: created!._id,
      subAccountOrgIds: ["org_sub1", "org_sub2"],
    });
    const scopes2 = await owner.query(api.agencyStaff.scopes, { memberId: created!._id });
    expect(scopes2.length).toBe(2);
  });

  it("cannot demote or remove the owner", async () => {
    const owner = await seedAgency();
    const owners = await owner.query(api.agencyStaff.list, {});
    const ownerRow = owners.find((m) => m.role === "owner")!;
    await expect(
      owner.mutation(api.agencyStaff.setRole, { memberId: ownerRow._id, role: "admin" }),
    ).rejects.toThrow();
    await expect(
      owner.mutation(api.agencyStaff.remove, { memberId: ownerRow._id }),
    ).rejects.toThrow();
  });

  it("billing-role member cannot invite staff", async () => {
    const owner = await seedAgency();
    const billingMember = await owner.mutation(api.agencyStaff.invite, {
      email: "b@x", name: "Bookkeeper", role: "billing",
    });
    // Promote the stub to a real active clerkUserId so we can act as them.
    await t.run(async (ctx) => {
      await ctx.db.patch(billingMember!._id, { clerkUserId: "u_billing", status: "active" });
    });
    const asBilling = t.withIdentity({
      subject: "u_billing", name: "B", orgId: "org_ag", orgType: "agency",
    } as { subject: string; name: string; orgId: string; orgType: string });
    await expect(
      asBilling.mutation(api.agencyStaff.invite, { email: "x@x", name: "X", role: "staff" }),
    ).rejects.toThrow();
  });
});
