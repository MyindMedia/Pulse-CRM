import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { svixSign } from "./mail/svix";
import { normalizeSubject } from "./mail/threading";
import { OUTREACH_REPLY_QUESTIONS, AUTO_OPT_OUT_AT, autoOptOut, outreachReplyState, replyText } from "./lib/jev/outreachReplies";

/* Jev (TypeSafe System One) reply triage for outreach. The promises held here:
   a studio's reply gets a label, stored on the prospect, and nothing else
   changes; an `unsubscribe` at >= 0.9 opts the address out exactly the way
   "mark opted out" does; 0.85 does not; and with Jev unavailable everything
   happens as it did before this feature. */

const systemOne = vi.fn();
vi.mock("@typesafe-ai/sdk", () => {
  class APIError extends Error {}
  class TypeSafeClient {
    systemOne = systemOne;
  }
  return { TypeSafeClient, APIError };
});

const LABELS = ["interested", "not_now", "unsubscribe", "wrong_person", "question", "auto_reply"] as const;
type Label = (typeof LABELS)[number];

/** Jev's answer: probability `p` on `label`, the rest spread evenly. */
function jevSays(label: Label, p: number) {
  const rest = (1 - p) / (LABELS.length - 1);
  const probabilities = Object.fromEntries(LABELS.map((l) => [l, l === label ? p : rest])) as Record<Label, number>;
  const n = LABELS.length;
  return {
    model: "jev-1.13.0",
    answers: { replyIntent: { type: "choice", choice: label, confidence: (p - 1 / n) / (1 - 1 / n), probabilities } },
    usage: { input_tokens: 240, output_tokens: 9 },
  };
}

/* ------------------------------- pure ------------------------------- */

describe("Jev outreach reply question (pure)", () => {
  it("is one Choice question with six described options, and the option that acts is not first", () => {
    expect(Object.keys(OUTREACH_REPLY_QUESTIONS)).toEqual(["replyIntent"]);
    const q = OUTREACH_REPLY_QUESTIONS.replyIntent;
    expect(q.type).toBe("choice");
    expect(q.instructions.length).toBeGreaterThan(40);
    expect(Object.keys(q.criteria)).toEqual([...LABELS]);
    for (const description of Object.values(q.criteria)) expect(description.length).toBeGreaterThan(40);
    // jev-1.13 leans toward the first option; the one that opts people out is never first.
    expect(Object.keys(q.criteria)[0]).not.toBe("unsubscribe");
  });

  it("opts out only when unsubscribe is at least 0.9", () => {
    expect(AUTO_OPT_OUT_AT).toBe(0.9);
    expect(autoOptOut({ unsubscribe: 0.9 })).toBe(true);
    expect(autoOptOut({ unsubscribe: 0.97, interested: 0.01 })).toBe(true);
    expect(autoOptOut({ unsubscribe: 0.8999 })).toBe(false);
    expect(autoOptOut({ unsubscribe: 0.85 })).toBe(false);
    expect(autoOptOut({ interested: 0.99 })).toBe(false);
    expect(autoOptOut({})).toBe(false);
  });

  it("the state is the reply as data, the channel and the studio's name, and nothing else", () => {
    expect(outreachReplyState({ subject: "Re: Pulse", text: "Sounds good" }, "MIX Recording Studio")).toEqual({
      channel: "Email reply to a cold sales email that Pulse sent to a recording studio",
      company: "MIX Recording Studio",
      subject: "Re: Pulse",
      reply: "Sounds good",
    });
    expect(outreachReplyState({ subject: "s", text: "t" }, null)).not.toHaveProperty("company");
    expect(outreachReplyState({ subject: "s", text: "x".repeat(5000) }).reply).toHaveLength(2000);
  });

  it("reads only the studio's own words: quoted history and our own footer never reach Jev", () => {
    const footer = "Not relevant? Reply 'unsubscribe' and we will stop contacting you.";
    // Gmail plain text, written above the quote, attribution wrapped onto two lines.
    expect(replyText(`Please take us off your list.\n\nThanks,\nJane\n\nOn Tue, Oct 6, 2026 at 3:04 PM Lawrence Berment <\nlawrenceb@studiopulse.tech> wrote:\n\n> Hi MIX team,\n> ${footer}\n`))
      .toBe("Please take us off your list.\n\nThanks,\nJane");
    // A yes must not carry the word unsubscribe from the quoted footer.
    expect(replyText(`Love this, can we talk Thursday?\r\n\r\nOn Tue, Oct 6, 2026, Lawrence <lawrenceb@studiopulse.tech> wrote:\r\n> ${footer}`))
      .toBe("Love this, can we talk Thursday?");
    // Written below the quote.
    expect(replyText("On Oct 6, 2026, at 3:04 PM, Lawrence wrote:\n> Hi MIX team,\n> Want a demo?\n\nYes, Friday works.")).toBe("Yes, Friday works.");
    // The studio's own sentence that merely looks like an attribution stays.
    expect(replyText("On second thought, here is what my partner wrote:\nLet's do it.")).toBe("On second thought, here is what my partner wrote:\nLet's do it.");
    // Outlook: the history is not marked with ">", so everything from its header on goes.
    expect(replyText(`Not a good time, try us in March.\n\nFrom: Lawrence Berment <lawrenceb@studiopulse.tech>\nSent: Tuesday, October 6, 2026 3:04 PM\nTo: jane@mix.com\nSubject: A question\n\nHi MIX team. ${footer}`))
      .toBe("Not a good time, try us in March.");
    expect(replyText("Who is this?\n-----Original Message-----\nFrom: x")).toBe("Who is this?");
    // HTML only: the <blockquote> history goes.
    expect(replyText(undefined, `<div>I left the studio, write to <b>ops@mix.com</b>.</div><blockquote><p>Hi MIX team</p><p>${footer}</p></blockquote>`))
      .toBe("I left the studio, write to ops@mix.com.");
    // Nothing but quoted history, or our footer on its own.
    expect(replyText(`> Hi MIX team\n> ${footer}`)).toBe("");
    expect(replyText(`Thanks!\n${footer}`)).toBe("Thanks!");
    expect(replyText(undefined, undefined)).toBe("");
  });
});

/* --------------------------- triage, end to end --------------------------- */

type Ident = { subject: string; name: string; orgId: string; orgType: string };
const idOf = (s: string, o: string): Ident => ({ subject: s, name: s, orgId: o, orgType: "agency" });
const AG = "org_a";
const DAY = 24 * 3600_000;
const HOOK = "Saw that MIX just opened a second live room.";
const SUBJECT = "A question about running MIX Recording Studio";
const SECRET = "whsec_" + btoa("test-webhook-signing-secret-0123456");

describe("Jev outreach reply triage", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    vi.useFakeTimers();
    t = convexTest(schema);
    systemOne.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("RESEND_API_KEY", "re_test_key_value_123456");
    vi.stubEnv("TYPESAFE_API_KEY", "ts-test");
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });
  const ua = () => t.withIdentity(idOf("ua", AG) as never);

  /* The same setup as outreachSequences.test.ts: live sending on, Lawrence's
     first email accepted, MaxB's day-3 follow-up waiting in the Review queue. */
  async function seed() {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId: AG, name: AG, slug: AG, plan: "max", status: "active", ownerClerkUserId: "ua", ownerEmail: "ua@x" });
      await ctx.db.insert("agencyMembers", { agencyId: AG, clerkUserId: "ua", email: "ua@x", name: "ua", role: "owner", status: "active", invitedAt: 0 });
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
  async function pending(email = "jane@mix.com") {
    const pid = await t.run(async (ctx) => await ctx.db.insert("outreachProspects", {
      agencyId: AG, dedupeKey: `site:${email}`, name: "MIX Recording Studio", websiteUrl: "https://mix.com", source: "paste", status: "queued", createdAt: 1, updatedAt: 1,
      contacts: { emails: [{ address: email, generic: false, rank: 50, sourceUrl: "https://mix.com/contact" }], phones: [], socials: [], booking: [], pages: [], scrapedAt: 1 },
    }));
    const firstId = await ua().mutation(api.outreachDrafts.prepare, { prospectId: pid, email, persona: "lawrence", templateKey: "lawrence_first", observation: HOOK });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: `re-${Math.random()}` }), { status: 200 })));
    await ua().mutation(api.outreachDrafts.approve, { id: firstId });
    await ua().mutation(api.outreachSend.send, { id: firstId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.setSystemTime(Date.now() + 3 * DAY + 1000);
    await tick();
    return { pid, firstId, threadId: `<pulse-outreach-${firstId}@studiopulse.tech>` };
  }
  const tick = () => t.mutation(internal.outreachSequences.tick, {});
  const seqOf = (pid: Id<"outreachProspects">) => t.run(async (ctx) => (await ctx.db.query("outreachSequences").collect()).find((s) => s.prospectId === pid) ?? null);
  const followUp = (pid: Id<"outreachProspects">) => t.run(async (ctx) => (await ctx.db.query("outreachDrafts").collect()).find((d) => d.prospectId === pid && d.sequenceStep === 1) ?? null);
  const prospectOf = (pid: Id<"outreachProspects">) => t.run(async (ctx) => await ctx.db.get(pid));
  const optOuts = () => t.run(async (ctx) => await ctx.db.query("outreachSuppressions").collect());
  const triage = (messageId: Id<"mailMessages">) => t.action(internal.outreachProspects.triageReply, { messageId });

  /** An inbound message stored the way mail._ingest stores one. By default Jane
   *  answers in Lawrence's thread (In-Reply-To his Message-ID). */
  async function reply(text: string, o: { inReplyTo?: string; from?: string; subject?: string } = {}) {
    const from = o.from ?? "jane@mix.com";
    const subject = o.subject ?? `Re: ${SUBJECT}`;
    return await t.run(async (ctx) => {
      const threadId = await ctx.db.insert("mailThreads", {
        agencyId: AG, subject, normalizedSubject: normalizeSubject(subject), participants: [from],
        lastMessageAt: Date.now(), lastSnippet: text.slice(0, 160), lastFrom: from, messageCount: 1, unreadCount: 1, status: "open", createdAt: Date.now(),
      });
      return await ctx.db.insert("mailMessages", {
        agencyId: AG, threadId, direction: "in", from: `Jane <${from}>`, fromAddress: from, to: ["lawrenceb@studiopulse.tech"], cc: [],
        subject, text, snippet: text.slice(0, 160), inReplyTo: o.inReplyTo, references: [],
        receivedAt: Date.now(), createdAt: Date.now(), read: false, bodyStatus: "ok", attachments: [],
      });
    });
  }

  /** Follow-ups stopped for `reason`, the waiting day-3 draft cancelled, and nothing drafted again later. */
  async function expectStopped(pid: Id<"outreachProspects">, reason: string) {
    expect(await seqOf(pid)).toMatchObject({ status: "stopped", stoppedReason: reason });
    expect((await followUp(pid))?.status).toBe("cancelled");
    vi.setSystemTime(Date.now() + 30 * DAY);
    expect((await tick()).drafted).toBe(0);
  }
  /** Exactly as before the reply: still queued, follow-ups running, day-3 draft waiting, nobody opted out. */
  async function expectUntouched(pid: Id<"outreachProspects">) {
    expect((await prospectOf(pid))?.status).toBe("queued");
    expect(await seqOf(pid)).toMatchObject({ status: "active" });
    expect((await followUp(pid))?.status).toBe("draft");
    expect(await optOuts()).toHaveLength(0);
  }

  it("labels the studio's reply on the prospect (label, every probability, confidence, model) and changes nothing else", async () => {
    await seed();
    const { pid, threadId } = await pending();
    const messageId = await reply(
      "Sounds great. Can we do a demo Thursday at 2?\n\nOn Tue, Oct 6, 2026 at 3:04 PM Lawrence Berment <lawrenceb@studiopulse.tech> wrote:\n> Hi MIX Recording Studio team,\n> Not relevant? Reply 'unsubscribe' and we will stop contacting you.",
      { inReplyTo: threadId },
    );
    systemOne.mockResolvedValue(jevSays("interested", 0.94));

    expect(await triage(messageId)).toEqual({ triaged: true, label: "interested", optedOut: false });

    const p = await prospectOf(pid);
    expect(p?.replyIntent).toMatchObject({ label: "interested", model: "jev-1.13.0", messageId, optedOut: false });
    expect(p?.replyIntent?.probabilities).toEqual(jevSays("interested", 0.94).answers.replyIntent.probabilities);
    expect(p?.replyIntent?.confidence).toBeCloseTo(0.928, 3);
    // Jev read the studio's own words as data, with the studio's name: no quoted pitch, no addresses.
    const { state, questions } = systemOne.mock.calls[0][0];
    expect(questions).toEqual(OUTREACH_REPLY_QUESTIONS);
    expect(state).toEqual({
      channel: expect.any(String), company: "MIX Recording Studio", subject: `Re: ${SUBJECT}`,
      reply: "Sounds great. Can we do a demo Thursday at 2?",
    });
    expect(JSON.stringify(state)).not.toMatch(/@|unsubscribe/i);
    // A label only.
    await expectUntouched(pid);
    // The owner sees it on the prospect's row.
    expect((await ua().query(api.outreachProspects.list, {}))!.rows[0].replyIntent).toEqual({
      label: "interested", probability: 0.94, confidence: p?.replyIntent?.confidence, optedOut: false, receivedAt: p?.replyIntent?.receivedAt,
    });
  });

  it("unsubscribe at >= 0.9 opts the address out the way 'mark opted out' does: follow-ups stop and nothing more can be sent", async () => {
    await seed();
    const { pid, threadId } = await pending();
    // A MaxB reply was already approved and waiting for its Send click.
    const waiting = await ua().mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jane@mix.com", persona: "maxb", templateKey: "maxb_reply" });
    await ua().mutation(api.outreachDrafts.approve, { id: waiting });
    const messageId = await reply("Please remove us from your list and do not email again.", { inReplyTo: threadId });
    systemOne.mockResolvedValue(jevSays("unsubscribe", 0.93));

    expect(await triage(messageId)).toEqual({ triaged: true, label: "unsubscribe", optedOut: true });

    expect(await optOuts()).toMatchObject([{ agencyId: AG, email: "jane@mix.com", reason: "opt-out: asked to stop in a reply (Jev, unsubscribe 93%)" }]);
    expect(await prospectOf(pid)).toMatchObject({ status: "suppressed", replyIntent: { label: "unsubscribe", optedOut: true } });
    expect((await ua().query(api.outreachProspects.list, {}))!.rows[0].contacts?.emails[0].suppressed).toBe(true);
    // The same trail the button leaves, with Jev as the actor.
    const byJev = (await t.run((ctx) => ctx.db.query("outreachEvents").collect())).filter((e) => e.actor === "jev").map((e) => e.action);
    expect(byJev).toEqual(["outreach.reply_labeled", "outreach.sequence_stopped", "outreach.email_suppressed"]);
    // Nothing more goes to that address: the approved reply is refused, and no new one can be written.
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "re-x" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await expect(ua().mutation(api.outreachSend.send, { id: waiting })).rejects.toThrow(/opted out/);
    await expect(ua().mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jane@mix.com", persona: "maxb", templateKey: "maxb_reply" })).rejects.toThrow(/can no longer be emailed/);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(f).not.toHaveBeenCalled();
    await expectStopped(pid, "opted_out");
  });

  it("an opt-out still lands when the hourly cron already marked the studio replied: MaxB can no longer write to it", async () => {
    await seed();
    const { pid, threadId } = await pending();
    const messageId = await reply("Stop emailing me.", { inReplyTo: threadId });
    expect((await tick()).stopped).toBe(1); // today's behavior: the reply stops the follow-ups
    systemOne.mockResolvedValue(jevSays("unsubscribe", 0.97));

    expect(await triage(messageId)).toEqual({ triaged: true, label: "unsubscribe", optedOut: true });

    expect((await optOuts()).map((s) => s.email)).toEqual(["jane@mix.com"]);
    expect(await seqOf(pid)).toMatchObject({ status: "stopped", stoppedReason: "replied" });
    await expect(ua().mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jane@mix.com", persona: "maxb", templateKey: "maxb_reply" })).rejects.toThrow(/opted out/);
  });

  it("unsubscribe at 0.85 is a label only: nobody is opted out and the follow-ups keep running", async () => {
    await seed();
    const { pid, threadId } = await pending();
    const messageId = await reply("Not really for us right now. Maybe take us off the list?", { inReplyTo: threadId });
    systemOne.mockResolvedValue(jevSays("unsubscribe", 0.85));

    expect(await triage(messageId)).toEqual({ triaged: true, label: "unsubscribe", optedOut: false });

    expect((await prospectOf(pid))?.replyIntent).toMatchObject({ label: "unsubscribe", optedOut: false });
    await expectUntouched(pid);
  });

  it("with Jev unavailable (no key, or an error) nothing is written and the reply is handled exactly as today", async () => {
    await seed();
    const { pid, threadId } = await pending();
    const messageId = await reply("Please take me off your list.", { inReplyTo: threadId });

    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect(await triage(messageId)).toEqual({ triaged: false, reason: "no_key" });
    expect(systemOne).not.toHaveBeenCalled();
    vi.stubEnv("TYPESAFE_API_KEY", "ts-test");
    systemOne.mockRejectedValue(new Error("network down"));
    expect(await triage(messageId)).toEqual({ triaged: false, reason: "jev_unavailable" });

    expect((await prospectOf(pid))?.replyIntent).toBeUndefined();
    await expectUntouched(pid);
    // Today's behavior: the hourly cron sees the reply and stops the follow-ups as "replied".
    expect((await tick()).stopped).toBe(1);
    expect((await prospectOf(pid))?.status).toBe("replied");
    await expectStopped(pid, "replied");
    expect(await optOuts()).toHaveLength(0);
  });

  it("mail that does not answer an outreach email never goes to Jev, and neither does our own mail", async () => {
    await seed();
    const { pid, threadId } = await pending();
    systemOne.mockResolvedValue(jevSays("unsubscribe", 0.99));

    const stranger = await reply("Do you sell gift cards?", { from: "someone@else.com", subject: "Gift cards" });
    expect(await triage(stranger)).toEqual({ triaged: false, reason: "not_an_outreach_reply" });
    const ownForward = await reply("FYI they want out.", { from: "lawrenceb@studiopulse.tech", inReplyTo: threadId });
    expect(await triage(ownForward)).toEqual({ triaged: false, reason: "not_an_outreach_reply" });

    expect(systemOne).not.toHaveBeenCalled();
    await expectUntouched(pid);
  });

  /* ------------------------ through the Resend webhook ------------------------ */

  async function post(event: unknown) {
    const body = JSON.stringify(event);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await svixSign(SECRET, "msg_x", ts, body);
    return await t.fetch("/resend/inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json", "svix-id": "msg_x", "svix-timestamp": ts, "svix-signature": `v1,${sig}` },
      body,
    });
  }
  const webhook = (id: string) => ({
    type: "email.received", created_at: new Date(Date.now()).toISOString(),
    data: { email_id: id, from: "Jane <jane@mix.com>", to: ["lawrenceb@studiopulse.tech"], cc: [], received_for: ["lawrenceb@studiopulse.tech"], message_id: `<${id}@mix.com>`, subject: `Re: ${SUBJECT}`, attachments: [] },
  });
  /** Resend's received-email API: `bodies[id]` is the full message, or a 500 while it is missing. */
  function stubResend(bodies: Record<string, { text: string; inReplyTo: string } | undefined>) {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const m = /emails\/receiving\/([^/]+)(\/attachments)?$/.exec(String(input));
      if (m?.[2]) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      const b = m ? bodies[decodeURIComponent(m[1])] : undefined;
      if (!m || !b) return new Response("{}", { status: 500 });
      return new Response(JSON.stringify({
        id: m[1], from: "Jane <jane@mix.com>", to: ["lawrenceb@studiopulse.tech"], cc: [], subject: `Re: ${SUBJECT}`, text: b.text, html: null,
        headers: { "in-reply-to": b.inReplyTo, references: b.inReplyTo }, message_id: `<${m[1]}@mix.com>`, created_at: new Date(Date.now()).toISOString(), attachments: [],
      }), { status: 200 });
    }));
  }
  const queuedTriage = () => t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) => f.name.includes("triageReply")),
  );
  async function seedMail() {
    vi.stubEnv("MAIL_AGENCY_ID", AG);
    vi.stubEnv("RESEND_WEBHOOK_SECRET", SECRET);
    await seed();
    await ua().mutation(api.mail.ensureDefaults, {});
  }

  it("a reply arriving through the Resend webhook is labeled once stored; without the Jev key nothing is even scheduled", async () => {
    await seedMail();
    const { pid, threadId } = await pending();
    stubResend({ r1: { text: "Please unsubscribe me.", inReplyTo: threadId }, r2: { text: "Please unsubscribe me.", inReplyTo: threadId } });

    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect((await post(webhook("r1"))).status).toBe(200);
    expect(await queuedTriage()).toHaveLength(0);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(systemOne).not.toHaveBeenCalled();
    expect((await prospectOf(pid))?.replyIntent).toBeUndefined();
    expect(await optOuts()).toHaveLength(0);

    vi.stubEnv("TYPESAFE_API_KEY", "ts-test");
    systemOne.mockResolvedValue(jevSays("unsubscribe", 0.96));
    expect((await post(webhook("r2"))).status).toBe(200);
    expect(await queuedTriage()).toHaveLength(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(systemOne).toHaveBeenCalledTimes(1);
    expect(systemOne.mock.calls[0][0].state).toMatchObject({ reply: "Please unsubscribe me.", company: "MIX Recording Studio" });
    expect((await prospectOf(pid))?.replyIntent).toMatchObject({ label: "unsubscribe", optedOut: true });
    expect((await optOuts()).map((s) => s.email)).toEqual(["jane@mix.com"]);
    expect(await seqOf(pid)).toMatchObject({ status: "stopped", stoppedReason: "opted_out" });
  });

  it("a reply whose body arrives late is labeled after the body is fetched, not before", async () => {
    await seedMail();
    const { pid, threadId } = await pending();
    const bodies: Record<string, { text: string; inReplyTo: string } | undefined> = {};
    stubResend(bodies);
    systemOne.mockResolvedValue(jevSays("not_now", 0.9));

    expect((await post(webhook("late"))).status).toBe(200); // stored from metadata only; the body fetch failed
    expect(await queuedTriage()).toHaveLength(0);
    bodies.late = { text: "Busy season, try us in January.", inReplyTo: threadId };
    await t.finishAllScheduledFunctions(vi.runAllTimers); // the 1-minute retry fetches the body, then Jev reads it

    expect(systemOne).toHaveBeenCalledTimes(1);
    expect(systemOne.mock.calls[0][0].state).toMatchObject({ reply: "Busy season, try us in January." });
    expect((await prospectOf(pid))?.replyIntent).toMatchObject({ label: "not_now", optedOut: false });
    expect(await optOuts()).toHaveLength(0);
  });
});
