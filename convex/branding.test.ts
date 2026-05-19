import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

describe("branding", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("agency tier can set custom domain; pro tier cannot", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag", name: "AG", slug: "ag", plan: "agency", status: "active",
        ownerClerkUserId: "u_o", ownerEmail: "o@x",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "u_o", email: "o@x", name: "O",
        role: "owner", status: "active", invitedAt: 0,
      });
    });
    const asAg = t.withIdentity({
      subject: "u_o", name: "O", orgId: "org_ag", orgType: "agency",
    } as { subject: string; name: string; orgId: string; orgType: string });
    await asAg.mutation(api.branding.updateAgencyBranding, {
      customDomain: "app.acme.com", accentColor: "#fdb913",
    });

    // Downgrade to pro
    await t.run(async (ctx) => {
      const ag = (await ctx.db.query("agencies").first())!;
      await ctx.db.patch(ag._id, { plan: "pro", customDomain: undefined });
    });
    await expect(
      asAg.mutation(api.branding.updateAgencyBranding, { customDomain: "app.acme.com" }),
    ).rejects.toThrow(/Custom domain requires Agency tier/);
  });

  it("studio owner can update studio branding", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_s", name: "S", slug: "s", plan: "studio", status: "active",
      });
      await ctx.db.insert("members", {
        orgId: "org_s", name: "O", role: "owner", clerkUserId: "u_o", skills: [],
      });
    });
    const owner = t.withIdentity({ subject: "u_o", name: "O", orgId: "org_s" });
    await owner.mutation(api.branding.updateStudioBranding, {
      tagline: "Where the record gets made.",
    });
    const org = await t.run(async (ctx) =>
      await ctx.db.query("orgs").first(),
    );
    expect(org!.tagline).toBe("Where the record gets made.");
  });

  it("studio intern cannot edit branding", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_s", name: "S", slug: "s", plan: "studio", status: "active",
      });
      await ctx.db.insert("members", {
        orgId: "org_s", name: "I", role: "intern", clerkUserId: "u_i", skills: [],
      });
    });
    const intern = t.withIdentity({ subject: "u_i", name: "I", orgId: "org_s" });
    await expect(
      intern.mutation(api.branding.updateStudioBranding, { tagline: "X" }),
    ).rejects.toThrow();
  });
});
