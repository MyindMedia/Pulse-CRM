import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/* This destroys a real business's records. These tests exist to prove the
   three gates actually gate, that the cascade is complete, and that the
   deletion cannot erase the evidence of itself. */

const AG = "ag1";
const OWNER = "u_ag";

async function setup(t: ReturnType<typeof convexTest>, orgName = "Vault Studios") {
  const orgId = "org_doomed";
  await t.run(async (ctx) => {
    await ctx.db.insert("agencies", {
      agencyId: AG, name: "Myind", slug: "myind", plan: "label",
      status: "active", ownerClerkUserId: OWNER, ownerEmail: "ag@example.com",
    });
    await ctx.db.insert("agencyMembers", {
      agencyId: AG, clerkUserId: OWNER, name: "L", email: "ag@example.com",
      role: "owner", status: "active", invitedAt: Date.now(),
    });
    await ctx.db.insert("orgs", {
      orgId, name: orgName, slug: "vault", plan: "studio", tier: "pro",
      status: "active", agencyId: AG,
    });
    const artist = await ctx.db.insert("artists", {
      orgId, name: "Ari", type: "artist", genres: [], tags: [],
      status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    const room = await ctx.db.insert("rooms", {
      orgId, name: "A", hourlyRateCents: 10_000, status: "available",
    });
    await ctx.db.insert("sessions", {
      orgId, title: "S", artistId: artist, roomId: room, serviceType: "recording",
      startTime: Date.now() + 86_400_000, endTime: Date.now() + 90_000_000,
      status: "confirmed", rateCents: 40_000, depositCents: 0,
      depositPaid: false, amountPaidCents: 0, intakeCompleted: false,
    });
    await ctx.db.insert("members", { orgId, name: "Eng", role: "engineer", skills: [] });
    // A second studio that must survive untouched.
    await ctx.db.insert("orgs", {
      orgId: "org_safe", name: "Safe", slug: "safe", plan: "studio", agencyId: AG,
    });
    await ctx.db.insert("artists", {
      orgId: "org_safe", name: "Untouched", type: "artist", genres: [], tags: [],
      status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
  });
  return { orgId, as: t.withIdentity({ subject: OWNER }) };
}

describe("step 1: what dies", () => {
  it("counts the real data and warns about what makes it worse", async () => {
    const t = convexTest(schema);
    const { orgId, as } = await setup(t);
    const impact = (await as.query(api.subaccountDeletion.impact, { orgId }))!;
    expect(impact.name).toBe("Vault Studios");
    expect(impact.counts.sessions).toBe(1);
    expect(impact.counts.clients).toBe(1);
    expect(impact.counts.rooms).toBe(1);
    // A session still on the calendar is the thing that should stop someone.
    expect(impact.warnings.join(" ")).toContain("still on the calendar");
    expect(impact.confirmPhrase).toBe("DELETE");
  });
});

describe("the three gates", () => {
  it("refuses to delete without a request", async () => {
    const t = convexTest(schema);
    const { orgId, as } = await setup(t);
    await expect(
      as.mutation(api.subaccountDeletion.confirmDeletion, {
        orgId, token: "made-up", typedName: "Vault Studios", typedPhrase: "DELETE",
      }),
    ).rejects.toMatchObject({ data: { code: "NO_REQUEST" } });
  });

  it("refuses a name that is not an exact match", async () => {
    const t = convexTest(schema);
    const { orgId, as } = await setup(t);
    const { token } = await as.mutation(api.subaccountDeletion.requestDeletion, { orgId });
    // Close is not the same as correct: retyping the name IS the check.
    await expect(
      as.mutation(api.subaccountDeletion.confirmDeletion, {
        orgId, token, typedName: "vault studios", typedPhrase: "DELETE",
      }),
    ).rejects.toMatchObject({ data: { code: "NAME_MISMATCH" } });
  });

  it("refuses without the phrase", async () => {
    const t = convexTest(schema);
    const { orgId, as } = await setup(t);
    const { token } = await as.mutation(api.subaccountDeletion.requestDeletion, { orgId });
    await expect(
      as.mutation(api.subaccountDeletion.confirmDeletion, {
        orgId, token, typedName: "Vault Studios", typedPhrase: "yes",
      }),
    ).rejects.toMatchObject({ data: { code: "PHRASE_MISMATCH" } });
  });

  it("refuses a token from a different studio", async () => {
    const t = convexTest(schema);
    const { as } = await setup(t);
    const { token } = await as.mutation(api.subaccountDeletion.requestDeletion, {
      orgId: "org_doomed",
    });
    await expect(
      as.mutation(api.subaccountDeletion.confirmDeletion, {
        orgId: "org_safe", token, typedName: "Safe", typedPhrase: "DELETE",
      }),
    ).rejects.toMatchObject({ data: { code: "NO_REQUEST" } });
  });

  it("refuses an expired confirmation", async () => {
    const t = convexTest(schema);
    const { orgId, as } = await setup(t);
    const { token } = await as.mutation(api.subaccountDeletion.requestDeletion, { orgId });
    // Wind the window back rather than waiting ten minutes.
    await t.run(async (ctx) => {
      const org = (await ctx.db.query("orgs").collect()).find((o) => o.orgId === orgId)!;
      await ctx.db.patch(org._id, {
        pendingDeletion: { ...org.pendingDeletion!, expiresAt: Date.now() - 1 },
      });
    });
    await expect(
      as.mutation(api.subaccountDeletion.confirmDeletion, {
        orgId, token, typedName: "Vault Studios", typedPhrase: "DELETE",
      }),
    ).rejects.toMatchObject({ data: { code: "EXPIRED" } });
  });

  it("cancelling clears the pending request", async () => {
    const t = convexTest(schema);
    const { orgId, as } = await setup(t);
    const { token } = await as.mutation(api.subaccountDeletion.requestDeletion, { orgId });
    await as.mutation(api.subaccountDeletion.cancelDeletion, { orgId });
    await expect(
      as.mutation(api.subaccountDeletion.confirmDeletion, {
        orgId, token, typedName: "Vault Studios", typedPhrase: "DELETE",
      }),
    ).rejects.toMatchObject({ data: { code: "NO_REQUEST" } });
  });
});

describe("the deletion itself", () => {
  async function deleteIt(t: ReturnType<typeof convexTest>) {
    const { orgId, as } = await setup(t);
    const { token } = await as.mutation(api.subaccountDeletion.requestDeletion, { orgId });
    const res = await as.mutation(api.subaccountDeletion.confirmDeletion, {
      orgId, token, typedName: "Vault Studios", typedPhrase: "DELETE",
    });
    return { orgId, as, res };
  }

  it("removes the workspace and everything in it", async () => {
    const t = convexTest(schema);
    const { orgId, res } = await deleteIt(t);
    expect(res.name).toBe("Vault Studios");
    expect(res.deletedRows).toBeGreaterThan(1);

    const left = await t.run(async (ctx) => ({
      orgs: (await ctx.db.query("orgs").collect()).filter((o) => o.orgId === orgId).length,
      sessions: (await ctx.db.query("sessions").collect()).filter((r) => r.orgId === orgId).length,
      artists: (await ctx.db.query("artists").collect()).filter((r) => r.orgId === orgId).length,
      members: (await ctx.db.query("members").collect()).filter((r) => r.orgId === orgId).length,
      rooms: (await ctx.db.query("rooms").collect()).filter((r) => r.orgId === orgId).length,
    }));
    expect(left).toEqual({ orgs: 0, sessions: 0, artists: 0, members: 0, rooms: 0 });
  });

  it("leaves every other studio completely untouched", async () => {
    const t = convexTest(schema);
    await deleteIt(t);
    const safe = await t.run(async (ctx) => ({
      org: (await ctx.db.query("orgs").collect()).filter((o) => o.orgId === "org_safe").length,
      artists: (await ctx.db.query("artists").collect()).filter((r) => r.orgId === "org_safe").length,
    }));
    expect(safe).toEqual({ org: 1, artists: 1 });
  });

  it("cannot erase the evidence of itself", async () => {
    const t = convexTest(schema);
    const { orgId } = await deleteIt(t);
    const audit = (await t.run((ctx) => ctx.db.query("auditEvents").collect()))
      .filter((a) => a.action === "agency.subaccount.delete");
    // The access engine audits each gated call, and the deletion writes its
    // own record naming what was destroyed. Both survive the cascade.
    expect(audit.length).toBeGreaterThanOrEqual(1);
    const record = audit.find((a) => a.reason?.includes("Vault Studios"));
    expect(record, "the deletion must leave a record naming what it destroyed").toBeTruthy();
    expect(record!.orgId).toBe(orgId);
    expect(record!.viewerId).toBe(OWNER);
    expect(record!.reason).toContain("three-step confirmation");
  });

  it("keeps a beta signature record and detaches it from the dead workspace", async () => {
    const t = convexTest(schema);
    const { orgId, as } = await setup(t);
    await t.run((ctx) =>
      ctx.db.insert("betaInvites", {
        agencyId: AG, email: "ari@example.com", code: "AAAAA-BBBBB",
        status: "claimed", ndaVersion: "v1", viewCount: 3,
        signedName: "Ari Levine", signedAt: Date.now(),
        claimedOrgId: orgId, claimedSlug: "vault", createdAt: Date.now(),
      }),
    );
    const { token } = await as.mutation(api.subaccountDeletion.requestDeletion, { orgId });
    await as.mutation(api.subaccountDeletion.confirmDeletion, {
      orgId, token, typedName: "Vault Studios", typedPhrase: "DELETE",
    });

    const [invite] = await t.run((ctx) => ctx.db.query("betaInvites").collect());
    // The signature outlives the workspace on purpose.
    expect(invite.signedName).toBe("Ari Levine");
    expect(invite.claimedOrgId).toBeUndefined();
    expect(invite.status).toBe("signed");
    expect(invite.note).toContain("Workspace deleted");
  });
});
