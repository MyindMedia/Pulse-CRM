import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/* Deleting your own account: the login goes, the studio's records stay,
   the studio's only owner cannot leave. */
describe("account: delete me", () => {
  let t: ReturnType<typeof convexTest>;
  const ORG = "org_s";

  beforeEach(async () => {
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Studio", slug: "studio", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: ORG, name: "Owen Owner", role: "owner", skills: [], clerkUserId: "u_owner", email: "owen@x.com" });
      await ctx.db.insert("members", { orgId: ORG, name: "Sienna Cole", role: "engineer", skills: [], clerkUserId: "u_eng", email: "sienna@x.com", phone: "+18185550164", bio: "Mixes" });
      await ctx.db.insert("apnsDevices", { orgId: ORG, clerkUserId: "u_eng", token: "t1", bundleId: "b", environment: "sandbox", lastSeenAt: 1 });
    });
  });

  it("an engineer leaves: seat anonymised, devices gone, the Clerk deletion scheduled", async () => {
    const eng = t.withIdentity({ subject: "u_eng", name: "Sienna" });
    const out = await eng.mutation(api.account.deleteMe, {});
    expect(out.seatsReleased).toBe(1);
    await t.run(async (ctx) => {
      const seat = (await ctx.db.query("members").collect()).find((m) => m.name === "Former teammate")!;
      expect(seat).toBeDefined();
      expect(seat.email).toBeUndefined();
      expect(seat.phone).toBeUndefined();
      expect(seat.clerkUserId).toBeUndefined();
      expect(seat.bio).toBeUndefined();
      expect(seat.role).toBe("engineer"); // the studio's record of who did what stays
      expect(await ctx.db.query("apnsDevices").collect()).toHaveLength(0);
      const scheduled = await ctx.db.system.query("_scheduled_functions").collect();
      expect(scheduled.map((s) => s.name)).toContain("account:deleteClerkUser");
      expect(scheduled[0].args[0]).toEqual({ clerkUserId: "u_eng" });
    });
  });

  it("the studio's only owner cannot leave", async () => {
    const owner = t.withIdentity({ subject: "u_owner", name: "Owen" });
    await expect(owner.mutation(api.account.deleteMe, {})).rejects.toThrow(/only owner/);
  });

  it("an owner with another owner can leave", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { orgId: ORG, name: "Olive Owner", role: "owner", skills: [], clerkUserId: "u_owner2" });
    });
    const owner = t.withIdentity({ subject: "u_owner", name: "Owen" });
    const out = await owner.mutation(api.account.deleteMe, {});
    expect(out.seatsReleased).toBe(1);
  });
});
