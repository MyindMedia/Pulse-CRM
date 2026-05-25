import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

/* Invited team-member (staff) onboarding: a teammate joins an EXISTING studio.
   The demo viewer (no Clerk identity) resolves to a studio owner on
   "pulse-demo" with clerkUserId "demo-user" — used for both the inviter
   (has members.invite) and, when seeded as a member, the self-service paths. */
describe("staff onboarding", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "Skyline Sound", slug: "demo", plan: "studio", status: "active",
      });
    });
  });

  it("_prepareTeammate creates a member row + surfaces the studio context", async () => {
    const res = await t.mutation(internal.members._prepareTeammate, {
      name: "Jordan Rivera", email: "jordan@demo.com", role: "engineer",
    });
    expect(res.studioName).toBe("Skyline Sound");
    expect(res.orgId).toBe("pulse-demo");

    const list = await t.query(api.members.list, {});
    const jordan = list.find((m) => m.email === "jordan@demo.com");
    expect(jordan).toBeTruthy();
    expect(jordan?.role).toBe("engineer");
  });

  it("_prepareTeammate re-uses the existing row instead of duplicating on re-send", async () => {
    await t.mutation(internal.members._prepareTeammate, { name: "Jordan", email: "jordan@demo.com", role: "engineer" });
    await t.mutation(internal.members._prepareTeammate, { name: "Jordan Rivera", email: "JORDAN@demo.com", role: "producer" });
    const list = await t.query(api.members.list, {});
    const matches = list.filter((m) => m.email?.toLowerCase() === "jordan@demo.com");
    expect(matches.length).toBe(1);
    expect(matches[0].role).toBe("producer"); // updated, not duplicated
    expect(matches[0].name).toBe("Jordan Rivera");
  });

  it("invites.record persists a staff role; lookupByToken returns it", async () => {
    const token = await t.mutation(internal.invites.record, {
      orgId: "pulse-demo", email: "jordan@demo.com", ownerName: "Jordan",
      studioName: "Skyline Sound", invitedBy: "owner", emailStatus: "simulated",
      role: "assistant_engineer",
    });
    const inv = await t.query(api.invites.lookupByToken, { token });
    expect(inv.state).toBe("valid");
    if (inv.state === "valid") expect(inv.role).toBe("assistant_engineer");
  });

  it("invites.record defaults role to owner when omitted", async () => {
    const token = await t.mutation(internal.invites.record, {
      orgId: "pulse-demo", email: "owner@demo.com", ownerName: "Owner",
      studioName: "Skyline Sound", invitedBy: "system", emailStatus: "simulated",
    });
    const inv = await t.query(api.invites.lookupByToken, { token });
    if (inv.state === "valid") expect(inv.role).toBe("owner");
  });

  it("a teammate sets their OWN photo (no invite cap) + myProfile resolves it", async () => {
    const storageId = await t.run(async (ctx) => {
      await ctx.db.insert("members", {
        orgId: "pulse-demo", name: "Demo Engineer", role: "engineer",
        email: "demo@demo.com", clerkUserId: "demo-user", skills: [],
      });
      return await ctx.storage.store(new Blob(["png"], { type: "image/png" }));
    });
    await t.mutation(api.members.setMyPhoto, { storageId });
    const me = await t.query(api.members.myProfile, {});
    expect(me?.photoUrl).toBeTruthy();
    expect(me?.role).toBe("engineer");

    await t.mutation(api.members.clearMyPhoto, {});
    const after = await t.query(api.members.myProfile, {});
    expect(after?.photoUrl).toBeNull();
  });

  it("setMyPhoto fails when the caller has no linked member row", async () => {
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["png"], { type: "image/png" })));
    await expect(t.mutation(api.members.setMyPhoto, { storageId })).rejects.toThrow(/team members/i);
  });
});
