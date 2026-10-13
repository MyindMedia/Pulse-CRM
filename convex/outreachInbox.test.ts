import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { normalizeSubject } from "./mail/threading";
import { studioAddresses, threadClaim } from "./outreachInbox";

type Ident = { subject: string; name: string; orgId: string; orgType: string };
const idOf = (subject: string, orgId: string): Ident => ({ subject, name: subject, orgId, orgType: "agency" });
/** A row without its undefined fields, as Convex stores it. */
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/* The CSV can give several studios the same subject, so a subject alone never
   ties a reply to a studio: it must thread under that studio's Message-ID. */
const SUBJECT = "Four rooms, one calendar";
const MIX_MSG_ID = "<pulse-outreach-mix@studiopulse.tech>";
const UNION_MSG_ID = "<pulse-outreach-union@studiopulse.tech>";

describe("outreach inbox", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });
  afterEach(() => { vi.unstubAllEnvs(); });
  const as = (s: string, o: string) => t.withIdentity(idOf(s, o) as never);

  async function seedAgency(agencyId: string, owner: string, staff?: string) {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId, name: agencyId, slug: agencyId, plan: "max", status: "active", ownerClerkUserId: owner, ownerEmail: `${owner}@x` });
      await ctx.db.insert("agencyMembers", { agencyId, clerkUserId: owner, email: `${owner}@x`, name: owner, role: "owner", status: "active", invitedAt: 0 });
      if (staff) await ctx.db.insert("agencyMembers", { agencyId, clerkUserId: staff, email: `${staff}@x`, name: staff, role: "staff", status: "active", invitedAt: 0 });
    });
  }

  /** Two emailed studios sharing one CSV subject, one new studio, and mail around them. */
  async function seed() {
    await seedAgency("org_a", "ua", "ustaff");
    await seedAgency("org_b", "ub");
    return await t.run(async (ctx) => {
      const contacts = (emails: Array<[string, boolean]>, scrapedAt: number) => ({
        emails: emails.map(([address, generic]) => ({ address, generic, rank: 50, sourceUrl: `https://${address.split("@")[1]}/contact` })),
        phones: [{ number: "(323) 555-0100", sourceUrl: "https://mix.com" }], socials: [], booking: ["Square"], pages: [], scrapedAt,
      });
      const mix = await ctx.db.insert("outreachProspects", {
        agencyId: "org_a", dedupeKey: "site:mix.com", name: "MIX Recording", handle: "mixrec", websiteUrl: "https://mix.com", source: "paste",
        status: "replied", contacts: contacts([["jane@mix.com", false], ["info@mix.com", true]], 1500), repliedAt: 5000, createdAt: 1000, updatedAt: 9999,
      });
      const union = await ctx.db.insert("outreachProspects", {
        agencyId: "org_a", dedupeKey: "site:union.com", name: "Union Sound", websiteUrl: "https://union.com", source: "maps",
        status: "queued", contacts: contacts([["bob@union.com", false]], 1600), createdAt: 1100, updatedAt: 1100,
      });
      const fresh = await ctx.db.insert("outreachProspects", {
        agencyId: "org_a", dedupeKey: "ig:newstudio", handle: "newstudio", source: "shortcut", status: "needs_website", createdAt: 7000, updatedAt: 7000,
      });
      const other = await ctx.db.insert("outreachProspects", {
        agencyId: "org_b", dedupeKey: "site:mix.com", name: "MIX (other agency)", websiteUrl: "https://mix.com", source: "paste",
        status: "queued", contacts: contacts([["jane@mix.com", false]], 1500), createdAt: 8000, updatedAt: 8000,
      });

      const seq = (prospectId: Id<"outreachProspects">, recipient: string, threadMessageId: string, extra: Record<string, unknown> = {}) =>
        ctx.db.insert("outreachSequences", {
          agencyId: "org_a", prospectId, recipient, step: 0, status: "active", startedAt: 2000, lastSentAt: 2000,
          threadMessageId, threadSubject: SUBJECT, createdAt: 2000, updatedAt: 2000, ...extra,
        });
      await seq(mix, "jane@mix.com", MIX_MSG_ID, { status: "stopped", stoppedReason: "replied", stoppedAt: 5000 });
      await seq(union, "bob@union.com", UNION_MSG_ID);

      const draft = (prospectId: Id<"outreachProspects">, extra: Record<string, unknown>) => ctx.db.insert("outreachDrafts", clean({
        agencyId: "org_a", prospectId, studio: "MIX Recording", recipient: "jane@mix.com", persona: "lawrence" as const, templateKey: "lawrence_first",
        signatureMode: "image" as const, subject: SUBJECT, html: "<p>Hi MIX Recording team,</p>", text: "Hi MIX Recording team,\n\nSaw your second live room.",
        contentHash: "h", blockers: [], status: "sent" as const, sequenceStep: 0, approvedAt: 1900, createdAt: 1800, ...extra,
      }));
      const sent = await draft(mix, {});
      const pending = await draft(mix, { persona: "maxb", templateKey: "maxb_reply", sequenceStep: undefined, status: "draft", subject: `Re: ${SUBJECT}`, createdAt: 6000, text: "Hi again" });
      await draft(mix, { status: "superseded", createdAt: 1700 });
      const unionSent = await draft(union, { studio: "Union Sound", recipient: "bob@union.com", createdAt: 1850 });
      await ctx.db.insert("outreachCommunications", {
        agencyId: "org_a", channel: "email", templateKey: "lawrence_first", recipient: "jane@mix.com", sender: "Lawrence Berment <lawrenceb@studiopulse.tech>",
        subject: SUBJECT, isTest: false, status: "delivered", idempotencyKey: `draft:${sent}`, messageId: MIX_MSG_ID, createdAt: 2000,
      });
      await ctx.db.insert("outreachCommunications", {
        agencyId: "org_a", channel: "email", templateKey: "lawrence_first", recipient: "bob@union.com", sender: "Lawrence Berment <lawrenceb@studiopulse.tech>",
        subject: SUBJECT, isTest: false, status: "accepted", idempotencyKey: `draft:${unionSent}`, messageId: UNION_MSG_ID, createdAt: 2100,
      });

      const box = await ctx.db.insert("mailboxes", {
        agencyId: "org_a", address: "info@studiopulse.tech", localPart: "info", displayName: "Info", fromName: "Pulse", kind: "shared", active: true, createdAt: 0, createdBy: "ua",
      });
      const thread = (agencyId: string, participants: string[], last: { at: number; from: string; snippet: string }, extra: Record<string, unknown> = {}) =>
        ctx.db.insert("mailThreads", clean({
          agencyId, mailboxId: agencyId === "org_a" ? box : undefined, subject: `Re: ${SUBJECT}`, normalizedSubject: normalizeSubject(SUBJECT), participants,
          lastMessageAt: last.at, lastSnippet: last.snippet, lastFrom: last.from, messageCount: 1, unreadCount: 0, status: "open" as const, createdAt: last.at, ...extra,
        }));
      const message = (agencyId: string, threadId: Id<"mailThreads">, extra: Record<string, unknown>) => ctx.db.insert("mailMessages", clean({
        agencyId, threadId, mailboxId: agencyId === "org_a" ? box : undefined, direction: "in" as const, from: "Jane <jane@mix.com>", fromAddress: "jane@mix.com",
        to: ["info@studiopulse.tech"], cc: [], subject: `Re: ${SUBJECT}`, snippet: "", createdAt: 0, read: true, attachments: [], ...extra,
      }));

      // The studio's own thread: Jane answered, Lawrence replied from the Email tab.
      const t1 = await thread("org_a", ["jane@mix.com"], { at: 4000, from: "Lawrence Berment <lawrenceb@studiopulse.tech>", snippet: "Great, here is the link" }, { unreadCount: 1, messageCount: 2 });
      const m1 = await message("org_a", t1, {
        receivedAt: 3000, createdAt: 3000, read: false, snippet: "Thanks Lawrence, we're interested", text: "Thanks Lawrence, we're interested.",
        html: "<p>Thanks Lawrence, we're interested.</p>", inReplyTo: MIX_MSG_ID,
      });
      await message("org_a", t1, {
        direction: "out", from: "Lawrence Berment <lawrenceb@studiopulse.tech>", fromAddress: "lawrenceb@studiopulse.tech", to: ["jane@mix.com"],
        sentAt: 4000, createdAt: 4000, snippet: "Great, here is the link", text: "Great, here is the link.", sendStatus: "accepted",
      });
      // The owner answered from a personal address, threaded under Lawrence's Message-ID.
      const t2 = await thread("org_a", ["owner@gmail.com"], { at: 3500, from: "Owner <owner@gmail.com>", snippet: "I run the studio" });
      await message("org_a", t2, { from: "Owner <owner@gmail.com>", fromAddress: "owner@gmail.com", receivedAt: 3500, createdAt: 3500, snippet: "I run the studio", text: "I run the studio.", references: [MIX_MSG_ID] });
      // Union's reply on the same CSV subject: never MIX's.
      const t3 = await thread("org_a", ["bob@union.com"], { at: 3600, from: "Bob <bob@union.com>", snippet: "Not for us" });
      await message("org_a", t3, { from: "Bob <bob@union.com>", fromAddress: "bob@union.com", receivedAt: 3600, createdAt: 3600, snippet: "Not for us", inReplyTo: UNION_MSG_ID });
      // Quarantined mail and another agency's mail never show.
      const t4 = await thread("org_a", ["jane@mix.com"], { at: 4100, from: "Jane <jane@mix.com>", snippet: "QUARANTINED" }, { status: "quarantined" });
      await message("org_a", t4, { receivedAt: 4100, createdAt: 4100, snippet: "QUARANTINED" });
      const t5 = await thread("org_b", ["jane@mix.com"], { at: 4200, from: "Jane <jane@mix.com>", snippet: "OTHER AGENCY" });
      await message("org_b", t5, { receivedAt: 4200, createdAt: 4200, snippet: "OTHER AGENCY" });

      await ctx.db.patch(mix, {
        replyIntent: { label: "interested", probabilities: { interested: 0.94, not_now: 0.06 }, confidence: 0.9, model: "jev-test", messageId: m1, receivedAt: 3000, at: 3100, optedOut: false },
      });
      await ctx.db.insert("outreachDms", { agencyId: "org_a", prospectId: mix, handle: "mixrec", studio: "MIX Recording", text: "Hey MIX team", contentHash: "c", status: "sent", sentAt: 2500, createdAt: 2400 });
      await ctx.db.insert("outreachDms", { agencyId: "org_a", prospectId: mix, handle: "mixrec", studio: "MIX Recording", text: "unsent", contentHash: "d", status: "draft", createdAt: 2450 });
      const booking = await ctx.db.insert("outreachBookings", {
        agencyId: "org_a", zuopsBookingId: "z1", title: "Pulse demo", startsAt: 9000, endsAt: 9900, status: "confirmed", contactName: "Jane", contactEmail: "jane@mix.com",
        phone: "+13235550100", prospectId: mix, syncedAt: 1,
      });
      await ctx.db.insert("outreachCalls", {
        agencyId: "org_a", bookingId: booking, phone: "+13235550100", status: "completed", scheduledFor: 7900, dialedAt: 8000, attempts: 1, createdAt: 7800, updatedAt: 8100,
        result: { summary: "Confirmed for Tuesday", disposition: "confirmed" },
      });
      return { mix, union, fresh, other, sent, pending, t1, t2, t3, m1 };
    });
  }

  it("only agency members see the inbox, and only their own agency's studios", async () => {
    const ids = await seed();
    expect(await t.query(api.outreachInbox.list, {})).toBeNull();
    expect(await t.query(api.outreachInbox.conversation, { prospectId: ids.mix })).toBeNull();
    const b = await as("ub", "org_b").query(api.outreachInbox.list, {});
    expect(b?.rows.map((r) => r.name)).toEqual(["MIX (other agency)"]);
    expect(JSON.stringify(b)).not.toContain("Thanks Lawrence");
    expect(await as("ub", "org_b").query(api.outreachInbox.conversation, { prospectId: ids.mix })).toBeNull();
    expect(await as("ua", "org_a").query(api.outreachInbox.conversation, { prospectId: ids.other })).toBeNull();
  });

  it("list: newest activity first, with the latest message as the preview and an unread reply flagged", async () => {
    await seed();
    vi.stubEnv("MAIL_AGENCY_ID", "org_a");
    const list = await as("ua", "org_a").query(api.outreachInbox.list, {});
    expect(list?.mailVisible).toBe(true);
    expect(list?.rows.map((r) => r.name)).toEqual(["@newstudio", "MIX Recording", "Union Sound"]);
    const [fresh, mix, union] = list!.rows;
    expect(fresh).toMatchObject({ lastKind: "status", lastDirection: null, lastActivityAt: 7000, status: "needs_website", hasUnreadReply: false, sequence: null });
    expect(mix).toMatchObject({
      lastKind: "mail", lastDirection: "out", lastSnippet: "Great, here is the link", lastActivityAt: 4000, hasUnreadReply: true,
      replied: true, replyIntent: { label: "interested", optedOut: false }, primaryEmail: "jane@mix.com", host: "mix.com", handle: "mixrec",
    });
    expect(mix.emails).toEqual(["jane@mix.com", "info@mix.com"]);
    // Union's own reply is Union's: the studio wrote last.
    expect(union).toMatchObject({ lastKind: "mail", lastDirection: "in", lastSnippet: "Not for us", lastActivityAt: 3600, replied: true });
    expect(JSON.stringify(list)).not.toContain("QUARANTINED");
    expect(JSON.stringify(list)).not.toContain("OTHER AGENCY");
  });

  it("list: someone who cannot read the Email tab sees that a studio replied, never what it said", async () => {
    await seed();
    vi.stubEnv("MAIL_AGENCY_ID", "org_a");
    const list = await as("ustaff", "org_a").query(api.outreachInbox.list, {});
    expect(list?.mailVisible).toBe(false);
    const mix = list!.rows.find((r) => r.name === "MIX Recording")!;
    expect(mix).toMatchObject({ lastKind: "reply", lastDirection: "in", lastSnippet: null, lastActivityAt: 3000, hasUnreadReply: false });
    const union = list!.rows.find((r) => r.name === "Union Sound")!;
    expect(union).toMatchObject({ lastKind: "email", lastDirection: "out", lastSnippet: SUBJECT, lastActivityAt: 2100 });
    expect(JSON.stringify(list)).not.toMatch(/Thanks Lawrence|Not for us|here is the link/);
  });

  it("conversation: one time-ordered history of sends, replies, DMs, the demo and its call", async () => {
    const ids = await seed();
    vi.stubEnv("MAIL_AGENCY_ID", "org_a");
    const c = await as("ua", "org_a").query(api.outreachInbox.conversation, { prospectId: ids.mix });
    expect(c).not.toBeNull();
    expect(c!.timeline.map((i) => i.id)).toEqual([
      "event:added", "event:read", `draft:${ids.sent}`, expect.stringMatching(/^dm:/),
      expect.stringMatching(/^mail:/), expect.stringMatching(/^mail:/), expect.stringMatching(/^mail:/),
      "event:replied", `pending:${ids.pending}`, expect.stringMatching(/^call:/), expect.stringMatching(/^booking:/),
    ]);
    const byId = new Map(c!.timeline.map((i) => [i.id, i]));
    const first = byId.get(`draft:${ids.sent}`);
    expect(first).toMatchObject({
      kind: "email", source: "outreach", direction: "out", at: 2000, from: "Lawrence Berment <lawrenceb@studiopulse.tech>", to: ["jane@mix.com"],
      label: "Step 0: First email (Lawrence)", delivery: { status: "delivered" }, snippet: "Hi MIX Recording team, Saw your second live room.",
    });
    const mail = c!.timeline.filter((i) => i.kind === "email" && i.source === "mail");
    expect(mail.map((m) => (m.kind === "email" ? [m.direction, m.from, m.at] : null))).toEqual([
      ["in", "Jane <jane@mix.com>", 3000],
      ["in", "Owner <owner@gmail.com>", 3500], // a different address, threaded under Lawrence's Message-ID
      ["out", "Lawrence Berment <lawrenceb@studiopulse.tech>", 4000],
    ]);
    expect(mail[0]).toMatchObject({ unread: true, html: "<p>Thanks Lawrence, we're interested.</p>", intent: { label: "interested", probability: 0.94 } });
    expect(mail[2]).toMatchObject({ delivery: { status: "accepted" } });
    expect(byId.get(`pending:${ids.pending}`)).toMatchObject({ kind: "draft", status: "draft", label: "Reply in the thread (MaxB)", from: "MaxB | Pulse <info@studiopulse.tech>" });
    expect(c!.timeline.find((i) => i.kind === "call")).toMatchObject({ status: "completed", summary: "Confirmed for Tuesday", at: 8000 });
    expect(c!.timeline.find((i) => i.kind === "booking")).toMatchObject({ status: "confirmed", startsAt: 9000, contactEmail: "jane@mix.com" });
    // Union's reply on the same subject, the unsent DM, the superseded draft, quarantined and other-agency mail: none of it.
    const json = JSON.stringify(c);
    for (const absent of ["Not for us", "unsent", "QUARANTINED", "OTHER AGENCY", "+13235550100", "3235550100"]) expect(json).not.toContain(absent);
    expect(c!.timeline.filter((i) => i.kind === "event").map((i) => i.id)).toEqual(["event:added", "event:read", "event:replied"]);
    expect(c!.unreadThreadIds).toEqual([ids.t1]);
    expect(c!.prospect).toMatchObject({ displayName: "MIX Recording", host: "mix.com", status: "replied", handle: "mixrec" });
    expect(c!.prospect.contacts?.emails.map((e) => [e.address, e.generic, e.suppressed])).toEqual([["jane@mix.com", false, false], ["info@mix.com", true, false]]);
  });

  it("conversation: mail is left out for someone who cannot read the Email tab; Jev's label stays as an event", async () => {
    const ids = await seed();
    vi.stubEnv("MAIL_AGENCY_ID", "org_a");
    const c = await as("ustaff", "org_a").query(api.outreachInbox.conversation, { prospectId: ids.mix });
    expect(c?.mailVisible).toBe(false);
    expect(c?.canManage).toBe(false);
    expect(c!.timeline.some((i) => i.kind === "email" && i.source === "mail")).toBe(false);
    expect(c!.timeline.find((i) => i.id === "event:intent")).toMatchObject({ text: 'Jev read the latest reply as "interested".' });
    expect(c!.unreadThreadIds).toEqual([]);
    expect(JSON.stringify(c)).not.toMatch(/Thanks Lawrence|I run the studio/);
  });

  it("list: a replied studio whose owner wrote from a personal address previews that thread, never a same-subject stranger's", async () => {
    await seedAgency("org_a", "ua");
    vi.stubEnv("MAIL_AGENCY_ID", "org_a");
    await t.run(async (ctx) => {
      const pid = await ctx.db.insert("outreachProspects", {
        agencyId: "org_a", dedupeKey: "site:lowend.com", name: "Low End", websiteUrl: "https://lowend.com", source: "paste", status: "replied", repliedAt: 3000,
        contacts: { emails: [{ address: "info@lowend.com", generic: true, rank: 50, sourceUrl: "https://lowend.com" }], phones: [], socials: [], booking: [], pages: [], scrapedAt: 1 },
        createdAt: 1, updatedAt: 1,
      });
      await ctx.db.insert("outreachSequences", {
        agencyId: "org_a", prospectId: pid, recipient: "info@lowend.com", step: 0, status: "stopped", stoppedReason: "replied", startedAt: 2000, lastSentAt: 2000,
        threadMessageId: MIX_MSG_ID, threadSubject: SUBJECT, createdAt: 2000, updatedAt: 2000,
      });
      const thread = (participants: string[], at: number, snippet: string) => ctx.db.insert("mailThreads", {
        agencyId: "org_a", subject: `Re: ${SUBJECT}`, normalizedSubject: normalizeSubject(SUBJECT), participants, lastMessageAt: at, lastSnippet: snippet,
        lastFrom: snippet.startsWith("Here") ? "Lawrence <lawrenceb@studiopulse.tech>" : "Someone <x@y.com>", messageCount: 2, unreadCount: 0, status: "open", createdAt: at,
      });
      const own = await thread(["marcus@personal.com"], 4000, "Here is the demo link");
      await ctx.db.insert("mailMessages", {
        agencyId: "org_a", threadId: own, direction: "in", from: "Marcus <marcus@personal.com>", fromAddress: "marcus@personal.com", to: ["info@studiopulse.tech"], cc: [],
        subject: `Re: ${SUBJECT}`, snippet: "I run the studio", receivedAt: 2500, createdAt: 2500, read: true, attachments: [], inReplyTo: MIX_MSG_ID,
      });
      const stranger = await thread(["stranger@other.com"], 9000, "STRANGER");
      await ctx.db.insert("mailMessages", {
        agencyId: "org_a", threadId: stranger, direction: "in", from: "S <stranger@other.com>", fromAddress: "stranger@other.com", to: ["info@studiopulse.tech"], cc: [],
        subject: `Re: ${SUBJECT}`, snippet: "STRANGER", receivedAt: 9000, createdAt: 9000, read: true, attachments: [],
      });
    });
    const row = (await as("ua", "org_a").query(api.outreachInbox.list, {}))!.rows[0];
    expect(row).toMatchObject({ name: "Low End", lastKind: "mail", lastDirection: "out", lastSnippet: "Here is the demo link", lastActivityAt: 4000 });
  });

  it("opening a reply marks its thread read through the Email tab's own mutation", async () => {
    const ids = await seed();
    vi.stubEnv("MAIL_AGENCY_ID", "org_a");
    const ua = as("ua", "org_a");
    await ua.mutation(api.mail.markThreadRead, { threadId: ids.t1 });
    expect((await ua.query(api.outreachInbox.conversation, { prospectId: ids.mix }))!.unreadThreadIds).toEqual([]);
    expect((await ua.query(api.outreachInbox.list, {}))!.rows.find((r) => r.name === "MIX Recording")?.hasUnreadReply).toBe(false);
    await expect(as("ustaff", "org_a").mutation(api.mail.markThreadRead, { threadId: ids.t1 })).rejects.toThrow();
  });

  it("a thread belongs to a studio by its addresses, or by subject only when a reply threads under its email", () => {
    const seqs = [{ startedAt: 10, threadMessageId: MIX_MSG_ID, recipient: "jane@mix.com", threadSubject: SUBJECT }];
    const addresses = studioAddresses({ contacts: { emails: [{ address: "Info@Mix.com", generic: true, rank: 1, sourceUrl: "x" }], phones: [], socials: [], booking: [], pages: [], scrapedAt: 0 } }, seqs);
    expect([...addresses]).toEqual(["info@mix.com", "jane@mix.com"]);
    const th = (participants: string[], subject = "something else") => ({ participants, normalizedSubject: normalizeSubject(subject) });
    expect(threadClaim(th(["info@mix.com"]), addresses, seqs)).toBe("address");
    expect(threadClaim(th(["owner@gmail.com"], `RE: ${SUBJECT}`), addresses, seqs)).toBe("subject");
    expect(threadClaim(th(["owner@gmail.com"]), addresses, seqs)).toBeNull();
  });
});
