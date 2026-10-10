import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

type Id = { subject: string; name: string; orgId: string; orgType: string };
const idOf = (s: string, o: string): Id => ({ subject: s, name: s, orgId: o, orgType: "agency" });
const AG = "org_a";
const HOOK = "Saw that MIX just opened a second live room.";

describe("outreach live sending", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { vi.useFakeTimers(); t = convexTest(schema); vi.stubEnv("RESEND_API_KEY", "re_test_key_value_123456"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
  const as = (s: string, o = AG) => t.withIdentity(idOf(s, o) as never);

  async function seed() {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId: AG, name: AG, slug: AG, plan: "max", status: "active", ownerClerkUserId: "ua", ownerEmail: "ua@x" });
      await ctx.db.insert("agencyMembers", { agencyId: AG, clerkUserId: "ua", email: "ua@x", name: "ua", role: "owner", status: "active", invitedAt: 0 });
      await ctx.db.insert("agencyMembers", { agencyId: AG, clerkUserId: "uadmin", email: "uadmin@x", name: "uadmin", role: "admin", status: "active", invitedAt: 0 });
      await ctx.db.insert("agencyMembers", { agencyId: AG, clerkUserId: "ustaff", email: "ustaff@x", name: "ustaff", role: "staff", status: "active", invitedAt: 0 });
    });
  }
  const gates = async () => {
    await t.mutation(internal.outreach.setProviderMapping, { agencyId: AG, ghlLocationId: "l", ghlCalendarId: "c", bookingUrl: "https://api.leadconnectorhq.com/widget/bookings/pulse-walkthrough", bookingDurationMin: 30, timezone: "UTC", operator: "op" });
    await t.mutation(internal.outreach.upsertSender, { agencyId: AG, label: "MaxB", address: "info@studiopulse.tech", verified: true, operator: "op" });
    await t.mutation(internal.outreach.upsertSender, { agencyId: AG, label: "Lawrence", address: "lawrenceb@studiopulse.tech", verified: true, operator: "op" });
    await t.mutation(internal.outreach.setPostalAddress, { agencyId: AG, address: "835 Wilshire Blvd, Ste 500 #519, Los Angeles, CA 90017", operator: "op" });
    await t.mutation(internal.outreach.confirmOwnerTest, { agencyId: AG, operator: "op", note: "Landed in Gmail, signature and link checked" });
    await t.mutation(internal.outreach.upsertTemplate, { agencyId: AG, key: "maxb_system", name: "MaxB", subject: "s", bookingUrl: "https://b.example/x", contentHash: "h", source: "t", approvedBy: "lawrence" });
  };
  const goLive = async () => {
    await as("ua").mutation(api.outreach.setLive, { enabled: true, confirm: "SEND" });
    await as("ua").mutation(api.outreach.setPaused, { paused: false });
  };
  async function approvedDraft(email = "jane@mix.com") {
    const pid = await t.run(async (ctx) => await ctx.db.insert("outreachProspects", {
      agencyId: AG, dedupeKey: "site:mix.com", name: "MIX Recording Studio", websiteUrl: "https://mix.com", source: "paste", status: "queued", createdAt: 1, updatedAt: 1,
      contacts: { emails: [{ address: email, generic: false, rank: 50, sourceUrl: "https://mix.com/contact" }], phones: [], socials: [], booking: [], pages: [], scrapedAt: 1 },
    }));
    const id = await as("ua").mutation(api.outreachDrafts.prepare, { prospectId: pid, email, persona: "lawrence", templateKey: "lawrence_first", observation: HOOK });
    await as("ua").mutation(api.outreachDrafts.approve, { id });
    return { id, pid };
  }
  const resend = (status = 200, body: unknown = { id: "re-msg-1" }) => {
    const f = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", f); return f;
  };

  it("going live is owner only, needs every gate and the word SEND", async () => {
    await seed();
    await expect(as("uadmin").mutation(api.outreach.setLive, { enabled: true, confirm: "SEND" })).rejects.toThrow(/Only the agency owner/);
    await expect(as("ua").mutation(api.outreach.setLive, { enabled: true, confirm: "SEND" })).rejects.toThrow(/Not ready: .*mailing address/);
    await gates();
    await expect(as("ua").mutation(api.outreach.setLive, { enabled: true })).rejects.toThrow(/Type SEND/);
    vi.stubEnv("RESEND_API_KEY", "");
    await expect(as("ua").mutation(api.outreach.setLive, { enabled: true, confirm: "SEND" })).rejects.toThrow(/Resend key/);
    vi.stubEnv("RESEND_API_KEY", "re_test_key_value_123456");
    await as("ua").mutation(api.outreach.setLive, { enabled: true, confirm: "SEND" });
    expect((await as("ua").query(api.outreach.overview, {}))?.mode).toBe("live");
    await as("ua").mutation(api.outreach.setLive, { enabled: false });
    expect((await as("ua").query(api.outreach.overview, {}))?.mode).toBe("test_only");
  });

  it("nothing sends while live sending is off or Outreach is paused", async () => {
    await seed(); await gates();
    const { id } = await approvedDraft();
    const f = resend();
    await expect(as("ua").mutation(api.outreachSend.send, { id })).rejects.toThrow(/Live sending is off/);
    await as("ua").mutation(api.outreach.setLive, { enabled: true, confirm: "SEND" });
    await as("ua").mutation(api.outreach.setPaused, { paused: true });
    await expect(as("ua").mutation(api.outreachSend.send, { id })).rejects.toThrow(/paused/);
    expect(f).not.toHaveBeenCalled();
  });

  it("staff cannot send; only an approved draft can be sent", async () => {
    await seed(); await gates(); await goLive();
    const pid = await t.run(async (ctx) => await ctx.db.insert("outreachProspects", { agencyId: AG, dedupeKey: "k", name: "X", source: "paste", status: "queued", createdAt: 1, updatedAt: 1,
      contacts: { emails: [{ address: "a@x.com", generic: false, rank: 1, sourceUrl: "https://x.com" }], phones: [], socials: [], booking: [], pages: [], scrapedAt: 1 } }));
    const unapproved = await as("ua").mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "a@x.com", persona: "lawrence", templateKey: "lawrence_first", observation: HOOK });
    await expect(as("ua").mutation(api.outreachSend.send, { id: unapproved })).rejects.toThrow(/approved draft/);
    await expect(as("ustaff").mutation(api.outreachSend.send, { id: unapproved })).rejects.toThrow(/owner or admin/);
  });

  it("sends exactly one email through Resend with the right sender, recipient, Message-ID and idempotency key", async () => {
    await seed(); await gates(); await goLive();
    const { id } = await approvedDraft();
    const f = resend();
    await as("ua").mutation(api.outreachSend.send, { id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: "Lawrence Berment <lawrenceb@studiopulse.tech>", to: ["jane@mix.com"], reply_to: ["lawrenceb@studiopulse.tech", "info@studiopulse.tech"] });
    expect(body.headers).toMatchObject({ "List-Unsubscribe": "<mailto:lawrenceb@studiopulse.tech?subject=unsubscribe>", "Message-ID": `<pulse-outreach-${id}@studiopulse.tech>` });
    expect(body.headers["In-Reply-To"]).toBeUndefined(); // the first email starts the thread
    expect(body.attachments).toHaveLength(1); // the signature picture, inline
    expect(body.html).toContain("835 Wilshire Blvd");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(`pulse-outreach-${id}`);
    const comms = await as("ua").query(api.outreach.communications, {});
    expect(comms).toHaveLength(1);
    expect(comms?.[0]).toMatchObject({ status: "accepted", providerId: "re-msg-1", isTest: false, recipient: "jane@mix.com" });
    expect((await as("ua").query(api.outreachDrafts.list, {}))!.rows[0].status).toBe("sent");
    await expect(as("ua").mutation(api.outreachSend.send, { id })).rejects.toThrow(/approved draft/);
  });

  it("an unclear outcome is recorded as unknown and never retried", async () => {
    await seed(); await gates(); await goLive();
    const { id } = await approvedDraft();
    const f = vi.fn(async () => { throw new Error("socket hang up"); });
    vi.stubGlobal("fetch", f);
    await as("ua").mutation(api.outreachSend.send, { id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(f).toHaveBeenCalledTimes(1);
    const comms = await as("ua").query(api.outreach.communications, {});
    expect(comms?.[0].status).toBe("unknown");
    await expect(as("ua").mutation(api.outreachSend.send, { id })).rejects.toThrow(/approved draft|already sent/);
    expect((await as("ua").query(api.outreach.overview, {}))?.failures).toHaveLength(1);
  });

  it("a provider refusal leaves nothing sent and puts the draft on hold", async () => {
    await seed(); await gates(); await goLive();
    const { id } = await approvedDraft();
    resend(422, { message: "domain not verified" });
    await as("ua").mutation(api.outreachSend.send, { id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const row = (await as("ua").query(api.outreachDrafts.list, {}))!.rows[0];
    expect(row.status).toBe("hold");
    expect(row.holdReason).toMatch(/Provider rejected/);
    expect((await as("ua").query(api.outreach.communications, {}))?.[0].status).toBe("rejected");
  });

  it("an opt-out after approval, an expired approval, or changed settings all stop the send", async () => {
    await seed(); await gates(); await goLive();
    const a = await approvedDraft("a@mix.com");
    const f = resend();
    await as("ua").mutation(api.outreachProspects.suppressEmail, { email: "a@mix.com", reason: "opt-out" });
    await expect(as("ua").mutation(api.outreachSend.send, { id: a.id })).rejects.toThrow(/opted out|approved draft|no longer queued/);
    expect(f).not.toHaveBeenCalled();

    const b = await approvedDraft("b@mix.com");
    await t.mutation(internal.outreach.setPostalAddress, { agencyId: AG, address: "9 Other Ave, Los Angeles, CA 90002", operator: "op" });
    await expect(as("ua").mutation(api.outreachSend.send, { id: b.id })).rejects.toThrow(/changed since approval/);
    expect(f).not.toHaveBeenCalled();
  });

  it("an expired approval cannot be sent", async () => {
    await seed(); await gates(); await goLive();
    const { id } = await approvedDraft();
    const f = resend();
    vi.setSystemTime(Date.now() + 25 * 3600_000);
    await expect(as("ua").mutation(api.outreachSend.send, { id })).rejects.toThrow(/expired/);
    expect(f).not.toHaveBeenCalled();
  });

  it("another agency cannot send this agency's draft", async () => {
    await seed(); await gates(); await goLive();
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId: "org_b", name: "b", slug: "b", plan: "max", status: "active", ownerClerkUserId: "ub", ownerEmail: "ub@x" });
      await ctx.db.insert("agencyMembers", { agencyId: "org_b", clerkUserId: "ub", email: "ub@x", name: "ub", role: "owner", status: "active", invitedAt: 0 });
    });
    const { id } = await approvedDraft();
    const f = resend();
    await expect(as("ub", "org_b").mutation(api.outreachSend.send, { id })).rejects.toThrow(/not found/);
    expect(f).not.toHaveBeenCalled();
  });

  it("delivery status is read from the provider and never moves backwards", async () => {
    await seed(); await gates(); await goLive();
    const { id } = await approvedDraft();
    resend();
    await as("ua").mutation(api.outreachSend.send, { id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ last_event: "delivered" }))));
    await t.action(internal.outreachSend._checkStatuses, { agencyId: AG });
    expect((await as("ua").query(api.outreach.communications, {}))?.[0].status).toBe("delivered");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ last_event: "sent" }))));
    await t.action(internal.outreachSend._checkStatuses, { agencyId: AG });
    expect((await as("ua").query(api.outreach.communications, {}))?.[0].status).toBe("delivered");
  });
});
