import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

type Ident = { subject: string; name: string; orgId: string; orgType: string };
const idOf = (s: string, o: string): Ident => ({ subject: s, name: s, orgId: o, orgType: "agency" });
const AG = "org_a";
const DAY = 24 * 3600_000;
const HOOK = "Saw that MIX just opened a second live room.";
const SUBJECT = "A question about running MIX Recording Studio";

describe("outreach follow-up sequence", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { vi.useFakeTimers(); t = convexTest(schema); vi.stubEnv("RESEND_API_KEY", "re_test_key_value_123456"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
  const as = (s: string) => t.withIdentity(idOf(s, AG) as never);
  const ua = () => as("ua");

  async function seed() {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId: AG, name: AG, slug: AG, plan: "max", status: "active", ownerClerkUserId: "ua", ownerEmail: "ua@x" });
      await ctx.db.insert("agencyMembers", { agencyId: AG, clerkUserId: "ua", email: "ua@x", name: "ua", role: "owner", status: "active", invitedAt: 0 });
      await ctx.db.insert("agencyMembers", { agencyId: AG, clerkUserId: "ustaff", email: "ustaff@x", name: "ustaff", role: "staff", status: "active", invitedAt: 0 });
    });
    await t.mutation(internal.outreach.setProviderMapping, { agencyId: AG, ghlLocationId: "l", ghlCalendarId: "c", bookingUrl: "https://studiopulse.tech/demo", bookingDurationMin: 30, timezone: "UTC", operator: "op" });
    await t.mutation(internal.outreach.upsertSender, { agencyId: AG, label: "MaxB", address: "info@studiopulse.tech", verified: true, operator: "op" });
    await t.mutation(internal.outreach.upsertSender, { agencyId: AG, label: "Lawrence", address: "lawrenceb@studiopulse.tech", verified: true, operator: "op" });
    await t.mutation(internal.outreach.setPostalAddress, { agencyId: AG, address: "835 Wilshire Blvd, Los Angeles, CA 90017", operator: "op" });
    await t.mutation(internal.outreach.confirmOwnerTest, { agencyId: AG, operator: "op", note: "Landed in Gmail" });
    await t.mutation(internal.outreach.upsertTemplate, { agencyId: AG, key: "lawrence_first", name: "Lawrence", subject: "s", bookingUrl: "https://studiopulse.tech/demo", contentHash: "h", source: "t", approvedBy: "lawrence" });
    await ua().mutation(api.outreach.setLive, { enabled: true, confirm: "SEND" });
    await ua().mutation(api.outreach.setPaused, { paused: false });
  }
  async function prospect(email = "jane@mix.com", extra: Record<string, unknown> = {}) {
    return await t.run(async (ctx) => await ctx.db.insert("outreachProspects", {
      agencyId: AG, dedupeKey: `site:${email}`, name: "MIX Recording Studio", websiteUrl: "https://mix.com", source: "paste", status: "queued", createdAt: 1, updatedAt: 1,
      contacts: { emails: [{ address: email, generic: false, rank: 50, sourceUrl: "https://mix.com/contact" }], phones: [], socials: [], booking: [], pages: [], scrapedAt: 1 },
      ...extra,
    }));
  }
  const resend = () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: `re-${Math.random()}` }), { status: 200 }));
    vi.stubGlobal("fetch", f); return f;
  };
  async function sendDraft(id: Id<"outreachDrafts">) {
    await ua().mutation(api.outreachDrafts.approve, { id });
    await ua().mutation(api.outreachSend.send, { id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  }
  /** Lawrence's first email, sent and accepted. */
  async function started(email = "jane@mix.com", extra: Record<string, unknown> = {}) {
    const pid = await prospect(email, extra);
    const id = await ua().mutation(api.outreachDrafts.prepare, { prospectId: pid, email, persona: "lawrence", templateKey: "lawrence_first", observation: HOOK });
    resend();
    await sendDraft(id);
    return { pid, firstId: id };
  }
  const seqOf = (pid: Id<"outreachProspects">) => t.run(async (ctx) => (await ctx.db.query("outreachSequences").collect()).find((s) => s.prospectId === pid) ?? null);
  const draftsOf = (pid: Id<"outreachProspects">) => t.run(async (ctx) => (await ctx.db.query("outreachDrafts").collect()).filter((d) => d.prospectId === pid));
  const tick = () => t.mutation(internal.outreachSequences.tick, {});
  const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

  it("an accepted first email starts the sequence with its Message-ID and subject", async () => {
    await seed();
    const { pid, firstId } = await started();
    const s = await seqOf(pid);
    expect(s).toMatchObject({ step: 0, status: "active", recipient: "jane@mix.com", threadSubject: SUBJECT, threadMessageId: `<pulse-outreach-${firstId}@studiopulse.tech>` });
    expect(s!.nextDueAt! - s!.startedAt).toBe(3 * DAY);
    const comm = await t.run(async (ctx) => await ctx.db.query("outreachCommunications").first());
    expect(comm?.messageId).toBe(`<pulse-outreach-${firstId}@studiopulse.tech>`);
  });

  it("the cron only creates drafts: nothing is approved, sent or fetched", async () => {
    await seed();
    const { pid } = await started();
    const f = resend();
    expect(await tick()).toEqual({ stopped: 0, drafted: 0 }); // not due yet
    later(3 * DAY + 1000);
    expect(await tick()).toEqual({ stopped: 0, drafted: 1 });
    expect(await tick()).toEqual({ stopped: 0, drafted: 0 }); // no duplicate while it waits for review
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(f).not.toHaveBeenCalled();
    const follow = (await draftsOf(pid)).find((d) => d.sequenceStep === 1)!;
    expect(follow).toMatchObject({ status: "draft", persona: "maxb", templateKey: "maxb_followup_1", subject: `Re: ${SUBJECT}` });
    expect(follow.approvedAt).toBeUndefined();
    expect(await t.run(async (ctx) => (await ctx.db.query("outreachCommunications").collect()).length)).toBe(1);
    expect((await seqOf(pid))?.pendingDraftId).toBe(follow._id);
  });

  it("nothing is drafted while Outreach is paused", async () => {
    await seed();
    const { pid } = await started();
    await ua().mutation(api.outreach.setPaused, { paused: true });
    later(4 * DAY);
    expect((await tick()).drafted).toBe(0);
    expect((await draftsOf(pid)).filter((d) => d.sequenceStep === 1)).toHaveLength(0);
  });

  it("MaxB's follow-ups reply in Lawrence's thread on day 3, 7 and 14, then the sequence is done", async () => {
    await seed();
    const { pid, firstId } = await started();
    const msgId = `<pulse-outreach-${firstId}@studiopulse.tech>`;
    const startedAt = (await seqOf(pid))!.startedAt;
    for (const [step, day] of [[1, 3], [2, 7], [3, 14]] as const) {
      vi.setSystemTime(startedAt + day * DAY + 1000);
      expect((await tick()).drafted).toBe(1);
      const d = (await draftsOf(pid)).find((x) => x.sequenceStep === step)!;
      const f = resend();
      await sendDraft(d._id);
      expect(f).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
      expect(body.from).toBe("MaxB | Pulse <info@studiopulse.tech>");
      expect(body.subject).toBe(`Re: ${SUBJECT}`);
      expect(body.reply_to).toEqual(["lawrenceb@studiopulse.tech", "info@studiopulse.tech"]);
      expect(body.headers).toMatchObject({ "In-Reply-To": msgId, References: msgId, "Message-ID": `<pulse-outreach-${d._id}@studiopulse.tech>` });
      expect(body.text).toMatch(/work with Lawrence/);
      const s = await seqOf(pid);
      expect(s?.step).toBe(step);
      if (step < 3) expect(s!.nextDueAt).toBe(startedAt + [0, 3, 7, 14][step + 1] * DAY);
    }
    expect((await seqOf(pid))).toMatchObject({ status: "done", step: 3 });
    later(30 * DAY);
    expect((await tick()).drafted).toBe(0);
  });

  it("a follow-up override from the CSV becomes that step's body", async () => {
    await seed();
    const { pid } = await started("jane@mix.com", { followups: { step1: "Custom day 3 note from the sheet." } });
    later(3 * DAY + 1000);
    await tick();
    const d = (await draftsOf(pid)).find((x) => x.sequenceStep === 1)!;
    expect(d.bodyOverride).toBe("Custom day 3 note from the sheet.");
    expect(d.text).toContain("Custom day 3 note from the sheet.");
  });

  it("a follow-up cannot be sent once the sequence has stopped", async () => {
    await seed();
    const { pid } = await started();
    later(3 * DAY + 1000);
    await tick();
    const d = (await draftsOf(pid)).find((x) => x.sequenceStep === 1)!;
    await ua().mutation(api.outreachDrafts.approve, { id: d._id });
    await t.run(async (ctx) => { const s = await ctx.db.query("outreachSequences").first(); await ctx.db.patch(s!._id, { status: "stopped", stoppedReason: "manual" }); });
    const f = resend();
    await expect(ua().mutation(api.outreachSend.send, { id: d._id })).rejects.toThrow(/stopped/);
    expect(f).not.toHaveBeenCalled();
  });

  it("an unknown outcome on Lawrence's email blocks a second cold email to that studio", async () => {
    await seed();
    const pid = await prospect();
    const id = await ua().mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jane@mix.com", persona: "lawrence", templateKey: "lawrence_first", observation: HOOK });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));
    await sendDraft(id);
    expect(await seqOf(pid)).toBeNull(); // unknown: no sequence, never retried
    await expect(ua().mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jane@mix.com", persona: "lawrence", templateKey: "lawrence_first", observation: HOOK })).rejects.toThrow(/already emailed/);
  });

  it("after a bounce or a spam complaint, not even a MaxB reply can be written or sent", async () => {
    await seed();
    const { pid } = await started();
    const rid = await ua().mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jane@mix.com", persona: "maxb", templateKey: "maxb_reply" });
    await ua().mutation(api.outreachDrafts.approve, { id: rid });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ last_event: "complained" }))));
    await t.action(internal.outreachSend._checkStatuses, { agencyId: AG });
    const f = resend();
    await expect(ua().mutation(api.outreachSend.send, { id: rid })).rejects.toThrow(/spam/);
    await expect(ua().mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jane@mix.com", persona: "maxb", templateKey: "maxb_reply" })).rejects.toThrow(/spam/);
    expect(f).not.toHaveBeenCalled();
  });

  /* ------------------------------ stop conditions ------------------------------ */

  /** A running sequence at step 0 with its day-3 draft waiting in the queue. */
  async function pending(email = "jane@mix.com") {
    const r = await started(email);
    later(3 * DAY + 1000);
    await tick();
    return r;
  }
  async function expectStopped(pid: Id<"outreachProspects">, reason: string) {
    const s = await seqOf(pid);
    expect(s).toMatchObject({ status: "stopped", stoppedReason: reason });
    expect(s?.nextDueAt).toBeUndefined();
    const open = (await draftsOf(pid)).filter((d) => (d.sequenceStep ?? 0) >= 1 && ["draft", "hold", "approved"].includes(d.status));
    expect(open).toHaveLength(0); // the waiting follow-up was cancelled
    later(30 * DAY);
    expect((await tick()).drafted).toBe(0);
  }

  it("stops when a person marks the studio replied; the prospect shows replied and MaxB can still reply", async () => {
    await seed();
    const { pid } = await pending();
    await expect(as("ustaff").mutation(api.outreachProspects.markReplied, { id: pid })).rejects.toThrow(/owner or admin/);
    await ua().mutation(api.outreachProspects.markReplied, { id: pid });
    expect((await ua().query(api.outreachProspects.list, {}))!.rows[0]).toMatchObject({ status: "replied", sequence: { status: "stopped", stoppedReason: "replied" } });
    await expectStopped(pid, "replied");
    const rid = await ua().mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jane@mix.com", persona: "maxb", templateKey: "maxb_reply" });
    expect((await ua().query(api.outreachDrafts.preview, { id: rid }))?.subject).toBe(`Re: ${SUBJECT}`);
  });

  it("stops when stored inbound mail shows a reply (read-only over the mail tables)", async () => {
    await seed();
    const { pid, firstId } = await pending();
    await t.run(async (ctx) => {
      const mailboxId = await ctx.db.insert("mailboxes", { agencyId: AG, address: "lawrenceb@studiopulse.tech", localPart: "lawrenceb", displayName: "Lawrence", fromName: "Lawrence", kind: "personal", active: true, createdAt: 1, createdBy: "op" });
      const threadId = await ctx.db.insert("mailThreads", {
        agencyId: AG, mailboxId, subject: `Re: ${SUBJECT}`, normalizedSubject: SUBJECT.toLowerCase(), participants: ["owner@other.com"],
        lastMessageAt: Date.now(), lastSnippet: "Sounds good", lastFrom: "owner@other.com", messageCount: 1, unreadCount: 1, status: "open", createdAt: Date.now(),
      });
      // A colleague answers from a different address, threaded under Lawrence's Message-ID.
      await ctx.db.insert("mailMessages", {
        agencyId: AG, threadId, mailboxId, direction: "in", from: "Owner <owner@other.com>", fromAddress: "owner@other.com", to: ["lawrenceb@studiopulse.tech"], cc: [],
        subject: `Re: ${SUBJECT}`, snippet: "Sounds good", inReplyTo: `<pulse-outreach-${firstId}@studiopulse.tech>`, references: [], receivedAt: Date.now(), createdAt: Date.now(), read: false, attachments: [],
      });
    });
    expect((await tick()).stopped).toBe(1);
    expect((await t.run(async (ctx) => await ctx.db.get(pid)))?.status).toBe("replied");
    await expectStopped(pid, "replied");
  });

  it("inbound mail from the recipient counts; mail from before the first email does not", async () => {
    await seed();
    const { pid } = await pending();
    const startedAt = (await seqOf(pid))!.startedAt;
    const insert = (at: number) => t.run(async (ctx) => {
      const threadId = await ctx.db.insert("mailThreads", {
        agencyId: AG, subject: "Hello", normalizedSubject: "hello", participants: ["jane@mix.com"],
        lastMessageAt: Date.now(), lastSnippet: "hi", lastFrom: "jane@mix.com", messageCount: 1, unreadCount: 1, status: "open", createdAt: at,
      });
      await ctx.db.insert("mailMessages", {
        agencyId: AG, threadId, direction: "in", from: "jane@mix.com", fromAddress: "jane@mix.com", to: ["info@studiopulse.tech"], cc: [],
        subject: "Hello", snippet: "hi", receivedAt: at, createdAt: at, read: false, attachments: [],
      });
    });
    await insert(startedAt - DAY);
    expect((await tick()).stopped).toBe(0);
    await insert(Date.now());
    expect((await tick()).stopped).toBe(1);
    await expectStopped(pid, "replied");
  });

  it("stops when the studio books a demo (Zuops booking matched by email)", async () => {
    await seed();
    const { pid } = await pending();
    await t.mutation(internal.outreachZuops._upsert, { agencyId: AG, bookings: [{ id: "bk1", title: "Pulse demo", startsAt: Date.now() + DAY, endsAt: Date.now() + DAY + 1800_000, status: "confirmed", lead: { email: "jane@mix.com", name: "Jane", consent: {}, emailOptOut: false, dnd: false } }] });
    await expectStopped(pid, "demo_booked");
  });

  it("stops on a booking found by the cron even without a matched prospect card", async () => {
    await seed();
    const { pid } = await pending();
    await t.run(async (ctx) => {
      await ctx.db.insert("outreachBookings", { agencyId: AG, zuopsBookingId: "bk2", title: "Pulse demo", startsAt: Date.now(), endsAt: Date.now() + 1, status: "confirmed", contactEmail: "jane@mix.com", syncedAt: Date.now() });
    });
    expect((await tick()).stopped).toBe(1);
    await expectStopped(pid, "demo_booked");
  });

  it("stops when the provider reports a bounce", async () => {
    await seed();
    const { pid } = await pending();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ last_event: "bounced" }))));
    await t.action(internal.outreachSend._checkStatuses, { agencyId: AG });
    await expectStopped(pid, "bounced");
  });

  it("stops when the provider reports a spam complaint", async () => {
    await seed();
    const { pid } = await pending();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ last_event: "complained" }))));
    await t.action(internal.outreachSend._checkStatuses, { agencyId: AG });
    await expectStopped(pid, "complained");
  });

  it("stops when the address opts out", async () => {
    await seed();
    const { pid } = await pending();
    await ua().mutation(api.outreachProspects.suppressEmail, { email: "jane@mix.com", reason: "opt-out" });
    await expectStopped(pid, "opted_out");
  });

  it("stops when the address is on the suppression list", async () => {
    await seed();
    const { pid } = await pending();
    await t.run(async (ctx) => { await ctx.db.insert("outreachSuppressions", { agencyId: AG, email: "jane@mix.com", reason: "hard bounce on another campaign", at: Date.now() }); });
    expect((await tick()).stopped).toBe(1);
    await expectStopped(pid, "suppressed");
  });

  it("stops by hand: the Stop follow-ups button, or cancelling a follow-up draft", async () => {
    await seed();
    const a = await pending("jane@mix.com");
    await expect(as("ustaff").mutation(api.outreachSequences.stop, { prospectId: a.pid })).rejects.toThrow(/owner or admin/);
    await ua().mutation(api.outreachSequences.stop, { prospectId: a.pid });
    await expectStopped(a.pid, "manual");

    const b = await pending("bob@mix.com");
    const d = (await draftsOf(b.pid)).find((x) => x.sequenceStep === 1)!;
    await ua().mutation(api.outreachDrafts.cancel, { id: d._id });
    await expectStopped(b.pid, "manual");
  });

  it("a superseded follow-up (its override changed) is drafted again with the new copy", async () => {
    await seed();
    const { pid } = await pending();
    const old = (await draftsOf(pid)).find((x) => x.sequenceStep === 1)!;
    await t.run(async (ctx) => {
      await ctx.db.patch(old._id, { status: "superseded" });
      await ctx.db.patch(pid, { followups: { step1: "New day 3 copy." } });
    });
    expect((await tick()).drafted).toBe(1);
    const fresh = (await draftsOf(pid)).filter((x) => x.sequenceStep === 1 && x.status === "draft");
    expect(fresh).toHaveLength(1);
    expect(fresh[0].text).toContain("New day 3 copy.");
  });
});
