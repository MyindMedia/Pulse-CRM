import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/** Preserves the schema types on `t` - a bare ReturnType<typeof initT>
 *  erases them and withIndex("by_org") stops type-checking. */
const initT = () => convexTest(schema);

/* seed:run is not "load some samples" - it deletes every row in 18 tables for
   the target org and rebuilds them as Myind Sound. There is no undo.

   It used to be guarded by members.remove alone, which every studio owner
   holds. These tests hold the line: a studio owner cannot detonate their own
   workspace, and one agency cannot detonate another's. */

/** A studio owner inside their own workspace - no agency membership. */
async function studioOwner(t: ReturnType<typeof initT>, orgId: string, user: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId, name: "Real Studio", slug: orgId, plan: "studio", status: "active",
      agencyId: "org_ag",
    });
    await ctx.db.insert("members", {
      orgId, clerkUserId: user, email: "owner@studio.com", name: "Owner",
      role: "owner", skills: [],
    });
  });
  return t.withIdentity({ subject: user, name: "Owner" });
}

/** An agency owner whose agency owns `subOrgId`. */
async function agencyOwner(
  t: ReturnType<typeof initT>, agencyId: string, user: string, subOrgId: string,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("agencies", {
      agencyId, name: agencyId, slug: agencyId, plan: "agency", status: "active",
      ownerClerkUserId: user, ownerEmail: "o@x",
    });
    await ctx.db.insert("agencyMembers", {
      agencyId, clerkUserId: user, email: "o@x", name: "Owner",
      role: "owner", status: "active", invitedAt: 0,
    });
  });
  return t.withIdentity({ subject: user, name: "Agency Owner" });
}

describe("seed:run cannot be fired from inside a studio", () => {
  let t: ReturnType<typeof initT>;
  beforeEach(() => { t = initT(); });

  it("a studio owner cannot wipe and reseed their own workspace", async () => {
    const owner = await studioOwner(t, "org_real", "u_owner");
    /* members.remove passes here - they are the owner. Only the agency check
       stops them, which is the whole point of the test. */
    await expect(owner.mutation(api.seed.run, { orgId: "org_real" })).rejects.toThrow();
  });

  it("leaves the studio's data intact when it refuses", async () => {
    const owner = await studioOwner(t, "org_real", "u_owner");
    await t.run(async (ctx) => {
      await ctx.db.insert("artists", {
        orgId: "org_real", name: "Their Real Artist", type: "artist",
        genres: [], tags: [], status: "active", lifetimeValueCents: 0,
        sessionCount: 0, reliability: "solid",
      });
    });
    await expect(owner.mutation(api.seed.run, { orgId: "org_real" })).rejects.toThrow();
    const left = await t.run(async (ctx) =>
      await ctx.db
        .query("artists")
        .withIndex("by_org", (q) => q.eq("orgId", "org_real"))
        .collect(),
    );
    expect(left).toHaveLength(1);
    expect(left[0].name).toBe("Their Real Artist");
  });

  it("a different agency cannot seed this studio", async () => {
    await studioOwner(t, "org_real", "u_owner");
    const other = await agencyOwner(t, "org_ag2", "u_other", "org_other");
    await expect(other.mutation(api.seed.run, { orgId: "org_real" })).rejects.toThrow();
  });

  it("an anonymous caller cannot seed anything", async () => {
    await studioOwner(t, "org_real", "u_owner");
    await expect(t.mutation(api.seed.run, { orgId: "org_real" })).rejects.toThrow();
  });
});
