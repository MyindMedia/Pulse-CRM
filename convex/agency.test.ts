import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

describe("agency — plan-cap enforcement", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  async function seedAgency(plan: "pro" | "agency") {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag", name: "AG", slug: "ag",
        plan, status: "active",
        ownerClerkUserId: "u_owner", ownerEmail: "o@x",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "u_owner", email: "o@x",
        name: "Owner", role: "owner", status: "active", invitedAt: 0,
      });
    });
    return t.withIdentity({
      subject: "u_owner", name: "Owner",
      orgId: "org_ag", orgType: "agency",
    } as { subject: string; name: string; orgId: string; orgType: string });
  }

  it("pro tier blocks the 3rd sub-account", async () => {
    const owner = await seedAgency("pro");
    await owner.action(api.agency.createSubaccount, {
      name: "Studio 1", slug: "s1", plan: "studio",
      ownerName: "X", ownerEmail: "x@x",
    });
    await owner.action(api.agency.createSubaccount, {
      name: "Studio 2", slug: "s2", plan: "studio",
      ownerName: "Y", ownerEmail: "y@x",
    });
    await expect(
      owner.action(api.agency.createSubaccount, {
        name: "Studio 3", slug: "s3", plan: "studio",
        ownerName: "Z", ownerEmail: "z@x",
      }),
    ).rejects.toThrow(/Plan cap reached/);
  });

  it("agency tier allows many sub-accounts", async () => {
    const owner = await seedAgency("agency");
    for (let i = 0; i < 5; i++) {
      await owner.action(api.agency.createSubaccount, {
        name: `S${i}`, slug: `s${i}`, plan: "studio",
        ownerName: "X", ownerEmail: `x${i}@x`,
      });
    }
    const subs = await owner.query(api.agency.subaccounts, {});
    expect(subs.length).toBe(5);
  });

  it("setStatus is gated by agency.subaccount.pause", async () => {
    const owner = await seedAgency("agency");
    await owner.action(api.agency.createSubaccount, {
      name: "S", slug: "s", plan: "studio", ownerName: "X", ownerEmail: "x@x",
    });
    const sub = (await owner.query(api.agency.subaccounts, {}))[0];
    // Owner can pause
    await owner.mutation(api.agency.setStatus, { orgId: sub.orgId, status: "paused" });
    // Random studio-only identity cannot
    await t.run(async (ctx) => {
      await ctx.db.insert("members", {
        orgId: sub.orgId, name: "Random", role: "intern", clerkUserId: "u_rand", skills: [],
      });
    });
    const stranger = t.withIdentity({ subject: "u_rand", name: "R", orgId: sub.orgId });
    await expect(
      stranger.mutation(api.agency.setStatus, { orgId: sub.orgId, status: "active" }),
    ).rejects.toThrow();
  });
});
