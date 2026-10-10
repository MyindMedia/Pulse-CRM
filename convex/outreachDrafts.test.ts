import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ORIGINAL_LAWRENCE } from "./outreach/signatures";

type Ident = { subject: string; name: string; orgId: string; orgType: string };
const idOf = (s: string, o: string): Ident => ({ subject: s, name: s, orgId: o, orgType: "agency" });
const HOOK = "Saw that MIX just opened a second live room.";

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
  async function queuedProspect(agencyId: string, emails: Array<{ address: string; generic: boolean }>, key = "mix.com") {
    return await t.run(async (ctx) => await ctx.db.insert("outreachProspects", {
      agencyId, dedupeKey: `site:${agencyId}-${key}`, name: "MIX Recording Studio", websiteUrl: `https://${key}`,
      source: "paste", status: "queued", createdAt: 1, updatedAt: 1,
      contacts: {
        emails: emails.map((e, i) => ({ ...e, rank: 50 - i, sourceUrl: `https://${key}/contact` })),
        phones: [], socials: [], booking: [], pages: [`https://${key}`], scrapedAt: 1,
      },
    }));
  }
  const gates = async (agencyId: string) => {
    await t.mutation(internal.outreach.setPostalAddress, { agencyId, address: "1 Main St, Los Angeles, CA 90001", operator: "op" });
    await t.mutation(internal.outreach.confirmOwnerTest, { agencyId, operator: "op", note: "Landed in Gmail, signature and link checked" });
  };
  const first = (pid: Id<"outreachProspects">, email: string, extra: Record<string, unknown> = {}) =>
    ({ prospectId: pid, email, persona: "lawrence" as const, templateKey: "lawrence_first", observation: HOOK, ...extra });
  async function startSequence(agencyId: string, pid: Id<"outreachProspects">, recipient: string) {
    await t.run(async (ctx) => {
      await ctx.db.insert("outreachSequences", {
        agencyId, prospectId: pid, recipient, step: 0, status: "active", startedAt: 1, lastSentAt: 1, nextDueAt: 1,
        threadMessageId: "<pulse-outreach-first@studiopulse.tech>", threadSubject: "A question about running MIX Recording Studio", createdAt: 1, updatedAt: 1,
      });
    });
  }

  it("prepares Lawrence's first email with his signature, sender, opening line and both reply-to inboxes", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "booking@mix.com", generic: true }]);
    const ua = as("ua", "org_a");
    const id = await ua.mutation(api.outreachDrafts.prepare, first(pid, "booking@mix.com", { routingConfirmed: true }));
    const p = await ua.query(api.outreachDrafts.preview, { id });
    expect(p?.from).toBe("Lawrence Berment <lawrenceb@studiopulse.tech>");
    expect(p?.to).toBe("booking@mix.com");
    expect(p?.html).toContain("data:image/jpeg;base64,");
    expect(p?.html).not.toContain(ORIGINAL_LAWRENCE);
    expect(p?.inline).toEqual(["signature-lawrence.jpg"]);
    expect(p?.subject).toBe("A question about running MIX Recording Studio");
    expect(p?.text.split("\n\n")[1]).toBe(HOOK);
    const row = (await ua.query(api.outreachDrafts.list, {}))!.rows[0];
    expect(row).toMatchObject({ step: 0, label: "Step 0: First email (Lawrence)", threaded: false });
  });

  it("the first email to a studio must come from Lawrence", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "jane@mix.com", generic: false }]);
    const ua = as("ua", "org_a");
    await expect(ua.mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jane@mix.com", persona: "maxb", templateKey: "maxb_reply" })).rejects.toThrow(/comes from Lawrence/);
    await expect(ua.mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jane@mix.com", persona: "maxb", templateKey: "lawrence_first", observation: HOOK })).rejects.toThrow(/No approved template/);
    await expect(ua.mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jane@mix.com", persona: "maxb", templateKey: "maxb_followup_1" })).rejects.toThrow(/drafted automatically/);
    await expect(ua.mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jane@mix.com", persona: "maxb", templateKey: "maxb_system" })).rejects.toThrow(/No approved template/);
  });

  it("prepare is blocked when the opening line is empty", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "jane@mix.com", generic: false }]);
    const ua = as("ua", "org_a");
    await expect(ua.mutation(api.outreachDrafts.prepare, first(pid, "jane@mix.com", { observation: undefined }))).rejects.toThrow(/opening line/);
    await expect(ua.mutation(api.outreachDrafts.prepare, first(pid, "jane@mix.com", { observation: "  " }))).rejects.toThrow(/opening line/);
  });

  it("subject and body overrides are stored and rendered; MaxB replies thread under Lawrence's email", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "jane@mix.com", generic: false }]);
    const ua = as("ua", "org_a");
    const id = await ua.mutation(api.outreachDrafts.prepare, first(pid, "jane@mix.com", { subjectOverride: "Four rooms, one calendar", bodyOverride: "A custom middle." }));
    const p = await ua.query(api.outreachDrafts.preview, { id });
    expect(p?.subject).toBe("Four rooms, one calendar");
    expect(p?.text).toContain("A custom middle.");
    expect(p?.text).toContain("50% off the first 3 months");

    await startSequence("org_a", pid, "jane@mix.com");
    await expect(ua.mutation(api.outreachDrafts.prepare, first(pid, "jane@mix.com"))).rejects.toThrow(/already emailed/);
    await expect(ua.mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "other@mix.com", persona: "maxb", templateKey: "maxb_reply" })).rejects.toThrow(/address Lawrence wrote to/);
    const rid = await ua.mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jane@mix.com", persona: "maxb", templateKey: "maxb_reply", bodyOverride: "Thanks for getting back to us." });
    const rp = await ua.query(api.outreachDrafts.preview, { id: rid });
    expect(rp?.from).toBe("MaxB | Pulse <info@studiopulse.tech>");
    expect(rp?.subject).toBe("Re: A question about running MIX Recording Studio");
    expect(rp?.inReplyTo).toBe("<pulse-outreach-first@studiopulse.tech>");
    expect(rp?.text).toContain("Thanks for getting back to us.");
  });

  it("a generic inbox is held until routing is confirmed, per draft or per prospect", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "info@mix.com", generic: true }]);
    const ua = as("ua", "org_a");
    await gates("org_a");
    const id = await ua.mutation(api.outreachDrafts.prepare, first(pid, "info@mix.com"));
    const row = (await ua.query(api.outreachDrafts.list, {}))!.rows[0];
    expect(row.status).toBe("hold");
    expect(row.holdReason).toMatch(/Generic inbox/);
    await expect(ua.mutation(api.outreachDrafts.approve, { id })).rejects.toThrow(/hold/);
    await t.run(async (ctx) => { await ctx.db.patch(pid, { routingConfirmed: true }); });
    await ua.mutation(api.outreachDrafts.prepare, first(pid, "info@mix.com"));
    expect((await ua.query(api.outreachDrafts.list, {}))!.rows[0].status).toBe("draft");
  });

  it("bulk routing confirm clears the generic hold, records who and when, and never approves", async () => {
    await seed("org_a", "ua", "ustaff");
    const a = await queuedProspect("org_a", [{ address: "info@a.com", generic: true }], "a.com");
    const b = await queuedProspect("org_a", [{ address: "studio@b.com", generic: true }], "b.com");
    const ua = as("ua", "org_a");
    await gates("org_a");
    await ua.mutation(api.outreachDrafts.prepare, first(a, "info@a.com"));
    await ua.mutation(api.outreachDrafts.prepare, first(b, "studio@b.com"));
    expect((await ua.query(api.outreachDrafts.list, {}))!.rows.map((r) => r.status)).toEqual(["hold", "hold"]);
    await expect(as("ustaff", "org_a").mutation(api.outreachProspects.confirmRouting, { ids: [a, b] })).rejects.toThrow(/owner or admin/);
    const r = await ua.mutation(api.outreachProspects.confirmRouting, { ids: [a, b] });
    expect(r).toEqual({ changed: 2, holdsCleared: 2 });
    const rows = (await ua.query(api.outreachDrafts.list, {}))!.rows;
    expect(rows.map((x) => x.status)).toEqual(["draft", "draft"]); // not approved
    expect(rows.every((x) => x.approvedAt === null)).toBe(true);
    const saved = await t.run(async (ctx) => ({ p: await ctx.db.get(a), ev: await ctx.db.query("outreachEvents").collect() }));
    expect(saved.p).toMatchObject({ routingConfirmed: true, routingConfirmedBy: "ua" });
    expect(typeof saved.p?.routingConfirmedAt).toBe("number");
    const confirms = saved.ev.filter((e) => e.action === "outreach.routing_confirmed");
    expect(confirms).toHaveLength(2);
    expect(confirms.every((e) => e.actor === "ua" && e.at > 0)).toBe(true);
  });

  it("approval needs a postal address and a confirmed owner test", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "jane@mix.com", generic: false }]);
    const ua = as("ua", "org_a");
    const id = await ua.mutation(api.outreachDrafts.prepare, first(pid, "jane@mix.com"));
    await expect(ua.mutation(api.outreachDrafts.approve, { id })).rejects.toThrow(/mailing address/);
    await t.mutation(internal.outreach.setPostalAddress, { agencyId: "org_a", address: "1 Main St, Los Angeles, CA 90001", operator: "op" });
    await expect(ua.mutation(api.outreachDrafts.approve, { id })).rejects.toThrow(/owner test/);
  });

  it("changing the address after preparing invalidates the draft (approval binds to content)", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "jane@mix.com", generic: false }]);
    const ua = as("ua", "org_a");
    await gates("org_a");
    const id = await ua.mutation(api.outreachDrafts.prepare, first(pid, "jane@mix.com"));
    await t.mutation(internal.outreach.setPostalAddress, { agencyId: "org_a", address: "9 Other Ave, Los Angeles, CA 90002", operator: "op" });
    await expect(ua.mutation(api.outreachDrafts.approve, { id })).rejects.toThrow(/changed/);
  });

  it("editing the hook, subject or body voids an earlier approval", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "jane@mix.com", generic: false }]);
    const ua = as("ua", "org_a");
    await gates("org_a");
    const id = await ua.mutation(api.outreachDrafts.prepare, first(pid, "jane@mix.com"));
    for (const change of [{ observation: "Saw your new mastering suite." }, { subjectOverride: "A new subject" }, { bodyOverride: "A new middle." }]) {
      await ua.mutation(api.outreachDrafts.approve, { id });
      const before = await t.run(async (ctx) => await ctx.db.get(id));
      expect(before?.status).toBe("approved");
      await ua.mutation(api.outreachDrafts.edit, { id, ...change });
      const after = await t.run(async (ctx) => await ctx.db.get(id));
      expect(after?.status).toBe("draft");
      expect(after?.approvedAt).toBeUndefined();
      expect(after?.approvedHash).toBeUndefined();
      expect(after?.contentHash).not.toBe(before?.contentHash);
    }
    const p = await ua.query(api.outreachDrafts.preview, { id });
    expect(p?.subject).toBe("A new subject");
    expect(p?.text).toContain("Saw your new mastering suite.");
    expect(p?.text).toContain("A new middle.");
  });

  it("approves a clean draft, then it expires after 24 hours", async () => {
    vi.useFakeTimers();
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "jane@mix.com", generic: false }]);
    const ua = as("ua", "org_a");
    await gates("org_a");
    const id = await ua.mutation(api.outreachDrafts.prepare, first(pid, "jane@mix.com"));
    await ua.mutation(api.outreachDrafts.approve, { id });
    expect((await ua.query(api.outreachDrafts.list, {}))!.rows[0].status).toBe("approved");
    vi.setSystemTime(Date.now() + 25 * 3600_000);
    expect((await ua.query(api.outreachDrafts.list, {}))!.rows[0].status).toBe("expired");
  });

  it("an opted-out address cannot be drafted", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "jane@mix.com", generic: false }, { address: "bob@mix.com", generic: false }]);
    const ua = as("ua", "org_a");
    await ua.mutation(api.outreachProspects.suppressEmail, { email: "jane@mix.com", reason: "opt-out" });
    await expect(ua.mutation(api.outreachDrafts.prepare, first(pid, "jane@mix.com"))).rejects.toThrow(/opted out/);
  });

  it("preparing again supersedes the old draft; only the newest is listed", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "jane@mix.com", generic: false }]);
    const ua = as("ua", "org_a");
    await ua.mutation(api.outreachDrafts.prepare, first(pid, "jane@mix.com"));
    await ua.mutation(api.outreachDrafts.prepare, first(pid, "jane@mix.com", { signatureMode: "static" }));
    const rows = (await ua.query(api.outreachDrafts.list, {}))!.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].signatureMode).toBe("static");
  });

  it("tenant and role isolation: staff and other agencies are refused, previews are scoped", async () => {
    await seed("org_a", "ua", "ustaff");
    await seed("org_b", "ub");
    const pid = await queuedProspect("org_a", [{ address: "jane@mix.com", generic: false }]);
    const ua = as("ua", "org_a");
    const args = first(pid, "jane@mix.com");
    await expect(as("ustaff", "org_a").mutation(api.outreachDrafts.prepare, args)).rejects.toThrow(/owner or admin/);
    await expect(as("ub", "org_b").mutation(api.outreachDrafts.prepare, args)).rejects.toThrow(/not found/);
    expect(await t.query(api.outreachDrafts.list, {})).toBeNull();
    const id = await ua.mutation(api.outreachDrafts.prepare, args);
    expect(await as("ub", "org_b").query(api.outreachDrafts.preview, { id })).toBeNull();
    expect((await as("ub", "org_b").query(api.outreachDrafts.list, {}))!.rows).toEqual([]);
    await expect(as("ub", "org_b").mutation(api.outreachDrafts.approve, { id })).rejects.toThrow(/not found/);
    await expect(as("ub", "org_b").mutation(api.outreachDrafts.edit, { id, bodyOverride: "x" })).rejects.toThrow(/not found/);
  });

  it("a studio address not found on its own site cannot be drafted", async () => {
    await seed("org_a", "ua");
    const pid = await queuedProspect("org_a", [{ address: "jane@mix.com", generic: false }]);
    await expect(as("ua", "org_a").mutation(api.outreachDrafts.prepare, first(pid, "made-up@mix.com"))).rejects.toThrow(/not found on the studio/);
  });
});
