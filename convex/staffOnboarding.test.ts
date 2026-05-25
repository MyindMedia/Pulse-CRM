import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { normalizePhone } from "./lib/phone";

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

  it("members.list surfaces inviteStatus: none → pending → expired → active", async () => {
    // No email → none; member with a clerk id → active.
    const { pendingId, expiredId } = await t.run(async (ctx) => {
      await ctx.db.insert("members", { orgId: "pulse-demo", name: "No Email", role: "intern", skills: [] });
      await ctx.db.insert("members", { orgId: "pulse-demo", name: "Joined", role: "engineer", email: "joined@demo.com", clerkUserId: "u_joined", skills: [] });
      const pendingId = await ctx.db.insert("members", { orgId: "pulse-demo", name: "Pending Pat", role: "engineer", email: "pat@demo.com", skills: [] });
      const expiredId = await ctx.db.insert("members", { orgId: "pulse-demo", name: "Lapsed Lee", role: "engineer", email: "lee@demo.com", skills: [] });
      const now = Date.now();
      await ctx.db.insert("invites", { orgId: "pulse-demo", email: "pat@demo.com", ownerName: "Pat", studioName: "Skyline Sound", role: "engineer", token: "tok-pat", status: "pending", expiresAt: now + 86400000, invitedBy: "owner", emailStatus: "sent" });
      await ctx.db.insert("invites", { orgId: "pulse-demo", email: "lee@demo.com", ownerName: "Lee", studioName: "Skyline Sound", role: "engineer", token: "tok-lee", status: "pending", expiresAt: now - 1000, invitedBy: "owner", emailStatus: "sent" });
      return { pendingId, expiredId };
    });
    const list = await t.query(api.members.list, {});
    const byId = (id: string) => list.find((m) => m._id === id);
    expect(byId(pendingId)?.inviteStatus).toBe("pending");
    expect(byId(expiredId)?.inviteStatus).toBe("expired");
    expect(list.find((m) => m.name === "No Email")?.inviteStatus).toBe("none");
    expect(list.find((m) => m.name === "Joined")?.inviteStatus).toBe("active");
  });

  it("normalizePhone coerces common inputs to E.164 (and rejects junk)", () => {
    expect(normalizePhone("(404) 555-0134")).toBe("+14045550134");
    expect(normalizePhone("404.555.0134")).toBe("+14045550134");
    expect(normalizePhone("14045550134")).toBe("+14045550134");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("_prepareTeammate stores a normalized phone on the member + invite carries it", async () => {
    const prep = await t.mutation(internal.members._prepareTeammate, {
      name: "Jordan", email: "jordan@demo.com", phone: "(404) 555-0134", role: "engineer",
    });
    expect(prep.phone).toBe("+14045550134");
    const list = await t.query(api.members.list, {});
    expect(list.find((m) => m.email === "jordan@demo.com")?.phone).toBe("+14045550134");

    const token = await t.mutation(internal.invites.record, {
      orgId: "pulse-demo", email: "jordan@demo.com", phone: "404-555-0134", ownerName: "Jordan",
      studioName: "Skyline Sound", invitedBy: "owner", emailStatus: "simulated", role: "engineer",
    });
    const inv = await t.query(api.invites.lookupByToken, { token });
    if (inv.state === "valid") expect(inv.phone).toBe("+14045550134");
  });

  it("resendInvite records a fresh token; refuses members with no email or already joined", async () => {
    const { patId, noEmailId, joinedId } = await t.run(async (ctx) => {
      const patId = await ctx.db.insert("members", { orgId: "pulse-demo", name: "Pat", role: "engineer", email: "pat@demo.com", skills: [] });
      const noEmailId = await ctx.db.insert("members", { orgId: "pulse-demo", name: "No Email", role: "intern", skills: [] });
      const joinedId = await ctx.db.insert("members", { orgId: "pulse-demo", name: "Joined", role: "engineer", email: "joined@demo.com", clerkUserId: "u_joined", skills: [] });
      return { patId, noEmailId, joinedId };
    });
    const res = await t.action(api.members.resendInvite, { memberId: patId });
    expect(res).toHaveProperty("inviteSent");
    const invites = await t.run((ctx) => ctx.db.query("invites").collect());
    expect(invites.some((i) => i.email === "pat@demo.com")).toBe(true);

    await expect(t.action(api.members.resendInvite, { memberId: noEmailId })).rejects.toThrow(/no email/i);
    await expect(t.action(api.members.resendInvite, { memberId: joinedId })).rejects.toThrow(/already joined/i);
  });
});
