import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { ORIGINAL_ROVERTO } from "./outreach/signatures";

type Id = { subject: string; name: string; orgId: string; orgType: string };
const idOf = (s: string, o: string): Id => ({ subject: s, name: s, orgId: o, orgType: "agency" });

describe("outreach drafts and approval", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });
  afterEach(() => { vi.useRealTimers(); });
  const as = (s: string, o: string) => t.withIdentity(idOf(s, o) as never);

  async function seed(agencyId: string, owner: string, staff?: string) {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId, name: agencyId, slug: agencyId, plan: "max", status: "active", ownerClerkUserId: owner, ownerEmail: `${owner}@x` });
      await ctx.db.insert("agencyMembers", { agencyId, clerkUserId: owner, email: `${owner}@x`, name: owner, role: "owner", status: "active", invitedAt: 0 });
      if (staff) await ctx.db.insert("agencyMembers", { agencyId, clerkUserId: staff, email: `${staff}@x`, name: staff, role: "staff", status: "active", invitedAt: 0 });
    });
  }
  async function queuedProspect(agencyId: string, emails: Array<{ address: string; generic: boolean }>) {
    return await t.run(async (ctx) => await ctx.db.insert("outreachProspects", {
      agencyId, dedupeKey: `site:${agencyId}-mix.com`, name: "MIX Recording Studio", websiteUrl: "https://mix.com",
      source: "paste", status: "queued", createdAt: 1, updatedAt: 1,
      contacts: {
        emails: emails.map((e, i) => ({ ...e, rank: 50 - i, sourceUrl: "https://mix.com/contact" })),
        phones: [], socials: [], booking: [], pages: ["https://mix.com"], scrapedAt: 1,
      },
    }));
  }
  const gates = async (agencyId: string) => {
    await t.mutation(internal.outreach.setPostalAddress, { agencyId, address: "1 Main St, Los Angeles, CA 90001", operator: "op" });
    await t.mutation(internal.outreach.confirmOwnerTest, { agencyId, operator: "op", note: "Landed in Gmail, signature and link checked" });
  };

  it("prepares the MaxB draft with the original Roverto signature and the right sender", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "booking@mix.com", generic: true }]);
    const ua = as("ua", "org_a");
    const id = await ua.mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "booking@mix.com", persona: "maxb", templateKey: "maxb_system", routingConfirmed: true });
    const p = await ua.query(api.outreachDrafts.preview, { id });
    expect(p?.from).toBe("MaxB | Pulse <info@studiopulse.tech>");
    expect(p?.to).toBe("booking@mix.com");
    expect(p?.html).toContain("data:image/jpeg;base64,"); // the signature picture, inlined for the preview
    expect(p?.html).not.toContain(ORIGINAL_ROVERTO);
    expect(p?.inline).toEqual(["signature-roverto.jpg"]);
    expect(p?.subject).toBe("Your studio has a sound. Now give it a system.");
    expect(p?.links).toContain("https://studiopulse.tech");
  });

  it("a generic inbox is held until routing is confirmed", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "info@mix.com", generic: true }]);
    const ua = as("ua", "org_a");
    await gates("org_a");
    const id = await ua.mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "info@mix.com", persona: "maxb", templateKey: "maxb_system" });
    const row = (await ua.query(api.outreachDrafts.list, {}))!.rows[0];
    expect(row.status).toBe("hold");
    expect(row.holdReason).toMatch(/Generic inbox/);
    await expect(ua.mutation(api.outreachDrafts.approve, { id })).rejects.toThrow(/hold/);
  });

  it("Lawrence has a sender and signature but no approved template yet", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "studio@mix.com", generic: true }]);
    await expect(as("ua", "org_a").mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "studio@mix.com", persona: "lawrence", templateKey: "maxb_system" })).rejects.toThrow(/No approved template/);
  });

  it("approval needs a postal address and a confirmed owner test", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "jane@mix.com", generic: false }]);
    const ua = as("ua", "org_a");
    const id = await ua.mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jane@mix.com", persona: "maxb", templateKey: "maxb_system" });
    await expect(ua.mutation(api.outreachDrafts.approve, { id })).rejects.toThrow(/mailing address/);
    await t.mutation(internal.outreach.setPostalAddress, { agencyId: "org_a", address: "1 Main St, Los Angeles, CA 90001", operator: "op" });
    await expect(ua.mutation(api.outreachDrafts.approve, { id })).rejects.toThrow(/owner test/);
  });

  it("changing the address after preparing invalidates the draft (approval binds to content)", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "jane@mix.com", generic: false }]);
    const ua = as("ua", "org_a");
    await gates("org_a");
    const id = await ua.mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jane@mix.com", persona: "maxb", templateKey: "maxb_system" });
    await t.mutation(internal.outreach.setPostalAddress, { agencyId: "org_a", address: "9 Other Ave, Los Angeles, CA 90002", operator: "op" });
    await expect(ua.mutation(api.outreachDrafts.approve, { id })).rejects.toThrow(/changed/);
  });

  it("approves a clean draft, then it expires after 24 hours and opt-out blocks it", async () => {
    vi.useFakeTimers();
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "jane@mix.com", generic: false }]);
    const ua = as("ua", "org_a");
    await gates("org_a");
    const id = await ua.mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jane@mix.com", persona: "maxb", templateKey: "maxb_system" });
    await ua.mutation(api.outreachDrafts.approve, { id });
    expect((await ua.query(api.outreachDrafts.list, {}))!.rows[0].status).toBe("approved");
    vi.setSystemTime(Date.now() + 25 * 3600_000);
    expect((await ua.query(api.outreachDrafts.list, {}))!.rows[0].status).toBe("expired");
  });

  it("an opted-out address cannot be drafted or approved", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "jane@mix.com", generic: false }, { address: "bob@mix.com", generic: false }]);
    const ua = as("ua", "org_a");
    await ua.mutation(api.outreachProspects.suppressEmail, { email: "jane@mix.com", reason: "opt-out" });
    await expect(ua.mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jane@mix.com", persona: "maxb", templateKey: "maxb_system" })).rejects.toThrow(/opted out/);
  });

  it("preparing again supersedes the old draft; only the newest is listed", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "jane@mix.com", generic: false }]);
    const ua = as("ua", "org_a");
    const args = { prospectId: pid, email: "jane@mix.com", persona: "maxb" as const, templateKey: "maxb_system" };
    await ua.mutation(api.outreachDrafts.prepare, args);
    await ua.mutation(api.outreachDrafts.prepare, { ...args, signatureMode: "static" });
    const rows = (await ua.query(api.outreachDrafts.list, {}))!.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].signatureMode).toBe("static");
  });

  it("tenant and role isolation: staff and other agencies are refused, previews are scoped", async () => {
    await seed("org_a", "ua", "ustaff");
    await seed("org_b", "ub");
    const pid = await queuedProspect("org_a", [{ address: "jane@mix.com", generic: false }]);
    const ua = as("ua", "org_a");
    const args = { prospectId: pid, email: "jane@mix.com", persona: "maxb" as const, templateKey: "maxb_system" };
    await expect(as("ustaff", "org_a").mutation(api.outreachDrafts.prepare, args)).rejects.toThrow(/owner or admin/);
    await expect(as("ub", "org_b").mutation(api.outreachDrafts.prepare, args)).rejects.toThrow(/not found/);
    expect(await t.query(api.outreachDrafts.list, {})).toBeNull();
    const id = await ua.mutation(api.outreachDrafts.prepare, args);
    expect(await as("ub", "org_b").query(api.outreachDrafts.preview, { id })).toBeNull();
    expect((await as("ub", "org_b").query(api.outreachDrafts.list, {}))!.rows).toEqual([]);
    await expect(as("ub", "org_b").mutation(api.outreachDrafts.approve, { id })).rejects.toThrow(/not found/);
  });

  it("a studio address not found on its own site cannot be drafted", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "jane@mix.com", generic: false }]);
    await expect(as("ua", "org_a").mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "made-up@mix.com", persona: "maxb", templateKey: "maxb_system" })).rejects.toThrow(/not found on the studio/);
  });
});
