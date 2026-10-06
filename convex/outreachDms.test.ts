import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

type Id = { subject: string; name: string; orgId: string; orgType: string };
const idOf = (subject: string, orgId: string): Id => ({ subject, name: subject, orgId, orgType: "agency" });

describe("outreach instagram DMs", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });
  afterEach(() => { vi.useRealTimers(); });

  async function seed(agencyId: string, owner: string, staff?: string) {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId, name: agencyId, slug: agencyId, plan: "agency", status: "active", ownerClerkUserId: owner, ownerEmail: `${owner}@x` });
      await ctx.db.insert("agencyMembers", { agencyId, clerkUserId: owner, email: `${owner}@x`, name: owner, role: "owner", status: "active", invitedAt: 0 });
      if (staff) await ctx.db.insert("agencyMembers", { agencyId, clerkUserId: staff, email: `${staff}@x`, name: staff, role: "staff", status: "active", invitedAt: 0 });
    });
  }
  const as = (s: string, o: string) => t.withIdentity(idOf(s, o) as never);
  async function prospect(agencyId: string, handle = "mixrec") {
    return await t.run(async (ctx) => await ctx.db.insert("outreachProspects", {
      agencyId, dedupeKey: `ig:${handle}`, handle, name: "MIX Recording Studio", bio: "We mix and master", category: "Music Production Studio",
      source: "instagram_search", status: "needs_website", createdAt: 1, updatedAt: 1,
    }));
  }

  it("is manager-only and invisible to outsiders", async () => {
    await seed("org_a", "ua", "ustaff");
    const pid = await prospect("org_a");
    await expect(t.mutation(api.outreachDms.prepare, { prospectId: pid })).rejects.toThrow();
    await expect(as("ustaff", "org_a").mutation(api.outreachDms.prepare, { prospectId: pid })).rejects.toThrow(/owner or admin/);
    expect(await t.query(api.outreachDms.overview, {})).toBeNull();
  });

  it("another agency cannot draft for, read, or act on this agency's prospect or DM", async () => {
    await seed("org_a", "ua");
    await seed("org_b", "ub");
    const pid = await prospect("org_a");
    await expect(as("ub", "org_b").mutation(api.outreachDms.prepare, { prospectId: pid })).rejects.toThrow(/not found/i);
    const { id } = await as("ua", "org_a").mutation(api.outreachDms.prepare, { prospectId: pid });
    await expect(as("ub", "org_b").mutation(api.outreachDms.approve, { id })).rejects.toThrow(/not found/i);
    expect((await as("ub", "org_b").query(api.outreachDms.overview, {}))!.dms).toHaveLength(0);
  });

  it("drafts a link-free DM from the studio's own bio, lists the prospect as a candidate until drafted", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    const pid = await prospect("org_a");
    expect((await ua.query(api.outreachDms.overview, {}))!.candidates.map((c) => c.id)).toEqual([pid]);
    await ua.mutation(api.outreachDms.prepare, { prospectId: pid });
    const o = (await ua.query(api.outreachDms.overview, {}))!;
    expect(o.candidates).toHaveLength(0);
    expect(o.dms[0]).toMatchObject({ handle: "mixrec", status: "draft", link: "https://ig.me/m/mixrec" });
    expect(o.dms[0].text).toContain("mixing and mastering");
    expect(o.dms[0].text).not.toMatch(/https?:/);
  });

  it("walks draft -> approve -> mark sent, and a sent DM blocks another for 30 days", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    const pid = await prospect("org_a");
    const { id } = await ua.mutation(api.outreachDms.prepare, { prospectId: pid });
    await expect(ua.mutation(api.outreachDms.markSent, { id })).rejects.toThrow(/Approve the DM/);
    await ua.mutation(api.outreachDms.approve, { id });
    await ua.mutation(api.outreachDms.markSent, { id });
    expect((await ua.query(api.outreachDms.overview, {}))!.dms[0].status).toBe("sent");
    await expect(ua.mutation(api.outreachDms.markSent, { id })).rejects.toThrow(/Approve the DM/);
    await expect(ua.mutation(api.outreachDms.prepare, { prospectId: pid })).rejects.toThrow(/less than 30 days/);
  });

  it("an edit voids approval, and an approval expires after 24 hours", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    const pid = await prospect("org_a");
    const { id } = await ua.mutation(api.outreachDms.prepare, { prospectId: pid });
    await ua.mutation(api.outreachDms.approve, { id });
    await ua.mutation(api.outreachDms.edit, { id, text: "Hey, loved your last release. Open to a quick look? Say stop and I will not message again." });
    expect((await ua.query(api.outreachDms.overview, {}))!.dms[0].status).toBe("draft");
    await expect(ua.mutation(api.outreachDms.markSent, { id })).rejects.toThrow(/Approve the DM/);
    await ua.mutation(api.outreachDms.approve, { id });
    await t.run(async (ctx) => { await ctx.db.patch(id, { approvedAt: Date.now() - 25 * 60 * 60 * 1000 }); });
    expect((await ua.query(api.outreachDms.overview, {}))!.dms[0].expired).toBe(true);
    await expect(ua.mutation(api.outreachDms.markSent, { id })).rejects.toThrow(/expired/);
  });

  it("an edit that adds a link or runs long is refused", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    const { id } = await ua.mutation(api.outreachDms.prepare, { prospectId: await prospect("org_a") });
    await expect(ua.mutation(api.outreachDms.edit, { id, text: "check https://pulse.app" })).rejects.toThrow(/links/);
    await expect(ua.mutation(api.outreachDms.edit, { id, text: "x".repeat(700) })).rejects.toThrow(/over/);
  });

  it("an opt-out cancels open DMs and blocks any new one for that handle", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    const pid = await prospect("org_a");
    const { id } = await ua.mutation(api.outreachDms.prepare, { prospectId: pid });
    await ua.mutation(api.outreachDms.optOut, { id });
    expect((await ua.query(api.outreachDms.overview, {}))!.dms[0].status).toBe("cancelled");
    await expect(ua.mutation(api.outreachDms.prepare, { prospectId: pid })).rejects.toThrow(/not to be contacted/);
  });

  it("re-preparing replaces the open draft instead of stacking duplicates", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    const pid = await prospect("org_a");
    await ua.mutation(api.outreachDms.prepare, { prospectId: pid });
    await ua.mutation(api.outreachDms.prepare, { prospectId: pid });
    const open = (await ua.query(api.outreachDms.overview, {}))!.dms.filter((d) => d.status === "draft");
    expect(open).toHaveLength(1);
  });

  it("a prospect with no handle cannot get a DM", async () => {
    await seed("org_a", "ua");
    const pid = await t.run(async (ctx) => await ctx.db.insert("outreachProspects", { agencyId: "org_a", dedupeKey: "web:x.com", websiteUrl: "https://x.com", source: "paste", status: "ready_to_scrape", createdAt: 1, updatedAt: 1 }));
    await expect(as("ua", "org_a").mutation(api.outreachDms.prepare, { prospectId: pid })).rejects.toThrow(/no Instagram handle/);
  });
});
