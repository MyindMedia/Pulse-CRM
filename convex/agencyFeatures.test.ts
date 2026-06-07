import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/** An agency owner whose agency owns `subOrgId`. */
async function agencyOwner(t: ReturnType<typeof convexTest>, agencyId: string, user: string, subOrgId: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("agencies", { agencyId, name: agencyId, slug: agencyId, plan: "agency", status: "active", ownerClerkUserId: user, ownerEmail: "o@x" });
    await ctx.db.insert("agencyMembers", { agencyId, clerkUserId: user, email: "o@x", name: "Owner", role: "owner", status: "active", invitedAt: 0 });
    await ctx.db.insert("orgs", { orgId: subOrgId, name: "Sub", slug: subOrgId, plan: "studio", status: "active", agencyId });
  });
  return t.withIdentity({ subject: user, name: "Owner" });
}

describe("agency feature toggles", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("agency owner sets disabled features; subaccount + brand reflect it", async () => {
    const owner = await agencyOwner(t, "org_ag", "u_own", "org_sub");
    await owner.mutation(api.agency.setFeatures, { orgId: "org_sub", disabledFeatures: ["agent", "licensing", "agent"] });
    const sub = await owner.query(api.agency.subaccount, { orgId: "org_sub" });
    // de-duped
    expect([...(sub!.disabledFeatures ?? [])].sort()).toEqual(["agent", "licensing"]);
  });

  it("a different agency cannot toggle features on this org", async () => {
    await agencyOwner(t, "org_ag", "u_own", "org_sub");
    // Owner of a DIFFERENT agency.
    const other = await agencyOwner(t, "org_ag2", "u_other", "org_sub2");
    await expect(
      other.mutation(api.agency.setFeatures, { orgId: "org_sub", disabledFeatures: ["agent"] }),
    ).rejects.toThrow();
  });
});
