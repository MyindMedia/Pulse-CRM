import { query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { agencyScope } from "./outreach/scope";
import { mailAccess } from "./mail";
import { prospectRow } from "./outreachProspects";
import { answersSequence, threadMatchesSequence, STOP_MEANING } from "./outreach/sequence";
import { ownAddress } from "./mail/address";
import { normalizeSubject } from "./mail/threading";
import { STATUS_MEANING, redact, type CommStatus } from "./outreach/policy";
import { PERSONAS, TEMPLATES, isTemplateKey } from "./outreach/templates";
import { APPROVAL_TTL_MS } from "./outreach/drafting";
import {
  displayName, hostName, latestActivity, mergeTimeline, previewLine,
  type Activity, type EmailItem, type InboxRow, type TimelineItem,
} from "./outreach/inbox";

/* ============================================================
   The Outreach inbox (Prospects tab): a compact list of studios and, for one
   studio, everything Pulse knows about it in time order.

   Read only. Scoped exactly like outreachProspects.list: the agency comes from
   the signed-in viewer, never from an argument, so no query here can return
   another agency's rows. Received mail (bodies, previews, unread state) is
   shown only to viewers who may read the Email tab (mail.mailAccess), so this
   view never widens who can read studiopulse.tech mail.

   Replies are matched with the rule outreach/sequence.ts already uses for
   follow-ups (threadMatchesSequence + answersSequence), applied to every
   address the studio published as well as the one Lawrence wrote to.
   ============================================================ */

const MAX_PROSPECTS = 300; // the Prospects list's own cap
const MAX_SUPPRESSIONS = 5000;
const MAX_SEQUENCES = 2000;
const MAX_COMMS = 500;
const MAX_DMS = 300;
const MAX_MAILBOXES = 25;
const MAX_THREADS_PER_MAILBOX = 200; // as detectReplies
const MAX_MESSAGES_PER_THREAD = 25;
const MAX_MAIL_MESSAGES = 60;
const MAX_SUBJECT_CHECKS = 10;
/** The list reads messages only for studios already marked replied whose reply
 *  no address explains (an owner answering from a personal address). */
const MAX_LIST_SUBJECT_CHECKS = 10;
const MAX_LIST_MESSAGES_PER_THREAD = 10;
const MAX_POINTER_LOOKUPS = 20;
const MAX_DRAFTS = 60;
const MAX_PROSPECT_DMS = 30;
const MAX_BOOKINGS = 300;
const MAX_CALLS_PER_BOOKING = 3;
const MAX_TIMELINE = 150;
/** Message bodies returned by one conversation, newest first. Older bodies past
 *  this are left out (the Email tab still has them), so one long thread can
 *  never push the result past Convex's limits. */
const BODY_BUDGET_CHARS = 1_500_000;
const MAX_TEXT_CHARS = 20_000;

type SeqLite = Pick<Doc<"outreachSequences">, "startedAt" | "threadMessageId" | "recipient" | "threadSubject">;

/** Every address that identifies the studio: what it published on its site
 *  and every address an outreach sequence wrote to. Lowercased. */
export function studioAddresses(p: Pick<Doc<"outreachProspects">, "contacts">, seqs: readonly SeqLite[]): Set<string> {
  const out = new Set<string>();
  for (const e of p.contacts?.emails ?? []) out.add(e.address.trim().toLowerCase());
  for (const s of seqs) out.add(s.recipient.trim().toLowerCase());
  return out;
}

/** How a mail thread belongs to one studio.
 *  "address": it names one of the studio's addresses (the participant half of
 *  threadMatchesSequence, applied to every known address). "subject": it only
 *  carries a sequence's subject, so it belongs to the studio only when one of
 *  its inbound messages answersSequence (threads under Lawrence's Message-ID,
 *  or comes from the address he wrote to). null: not this studio's. */
export function threadClaim(
  th: Pick<Doc<"mailThreads">, "participants" | "normalizedSubject">, addresses: ReadonlySet<string>, seqs: readonly SeqLite[],
): "address" | "subject" | null {
  if (th.participants.some((a) => addresses.has(a))) return "address";
  return seqs.some((s) => threadMatchesSequence(th, s)) ? "subject" : null;
}

/** The most recent threads of every mailbox plus Unrouted, as detectReplies
 *  reads them. Quarantined mail is never shown anywhere. */
async function recentThreads(ctx: QueryCtx, agencyId: string): Promise<Doc<"mailThreads">[]> {
  const boxes = await ctx.db.query("mailboxes").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).take(MAX_MAILBOXES);
  const ids: Array<Id<"mailboxes"> | undefined> = [...boxes.map((b) => b._id), undefined];
  const out: Doc<"mailThreads">[] = [];
  for (const mailboxId of ids) {
    const rows = await ctx.db
      .query("mailThreads")
      .withIndex("by_agency_mailbox_last", (q) => q.eq("agencyId", agencyId).eq("mailboxId", mailboxId))
      .order("desc")
      .take(MAX_THREADS_PER_MAILBOX);
    for (const t of rows) if (t.status !== "quarantined") out.push(t);
  }
  return out;
}

const threadMessages = (ctx: QueryCtx, threadId: Id<"mailThreads">) =>
  ctx.db.query("mailMessages").withIndex("by_thread", (q) => q.eq("threadId", threadId)).order("desc").take(MAX_MESSAGES_PER_THREAD);

const fromOurSide = (from: string) => ownAddress(from) !== null;

function groupByMany<T>(rows: readonly T[], keys: (r: T) => readonly string[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    for (const k of keys(r)) {
      const list = out.get(k);
      if (list) list.push(r);
      else out.set(k, [r]);
    }
  }
  return out;
}
const groupBy = <T>(rows: readonly T[], key: (r: T) => string) => groupByMany(rows, (r) => [key(r)]);

/* --------------------------------- list --------------------------------- */

type MailSummary = { at: number; direction: "in" | "out"; snippet: string; unread: boolean };

/** The latest matched thread per studio, for the list, by the same rule as
 *  `conversation` (threadClaim) with tighter read bounds: the address half is an
 *  index lookup per address; the subject half reads messages, so the list runs
 *  it only for a studio already marked replied that no address explains (an
 *  owner answering from a personal address), up to MAX_LIST_SUBJECT_CHECKS
 *  threads; Jev's pointer to the reply it read covers the rest. */
async function latestMailByStudio(
  ctx: QueryCtx, agencyId: string, prospects: readonly Doc<"outreachProspects">[], addressesOf: Map<string, Set<string>>,
  seqsOf: Map<string, Doc<"outreachSequences">[]>,
): Promise<Map<string, MailSummary>> {
  const threads = await recentThreads(ctx, agencyId);
  const byParticipant = groupByMany(threads, (t) => t.participants);
  const bySubject = groupBy(threads, (t) => t.normalizedSubject);
  const byId = new Map<string, Doc<"mailThreads">>(threads.map((t) => [t._id, t]));
  const out = new Map<string, MailSummary>();
  let lookups = 0;
  let subjectChecks = 0;
  for (const p of prospects) {
    const claimed = new Map<string, Doc<"mailThreads">>();
    for (const a of addressesOf.get(p._id) ?? []) for (const t of byParticipant.get(a) ?? []) claimed.set(t._id, t);
    const seqs = seqsOf.get(p._id) ?? [];
    if (claimed.size === 0 && (p.status === "replied" || p.repliedAt)) {
      for (const s of seqs) {
        for (const t of bySubject.get(normalizeSubject(s.threadSubject)) ?? []) {
          if (claimed.has(t._id) || subjectChecks >= MAX_LIST_SUBJECT_CHECKS) continue;
          subjectChecks++;
          const msgs = await ctx.db.query("mailMessages").withIndex("by_thread", (q) => q.eq("threadId", t._id)).order("desc").take(MAX_LIST_MESSAGES_PER_THREAD);
          if (msgs.some((m) => answersSequence(m, s))) claimed.set(t._id, t);
        }
      }
    }
    if (claimed.size === 0 && p.replyIntent && lookups < MAX_POINTER_LOOKUPS) {
      lookups++;
      const m = await ctx.db.get(p.replyIntent.messageId);
      if (m && m.agencyId === agencyId) {
        const t = byId.get(m.threadId) ?? (await ctx.db.get(m.threadId));
        if (t && t.agencyId === agencyId && t.status !== "quarantined") claimed.set(t._id, t);
      }
    }
    if (claimed.size === 0) continue;
    const all = [...claimed.values()];
    const latest = all.reduce((a, b) => (b.lastMessageAt > a.lastMessageAt ? b : a));
    out.set(p._id, {
      at: latest.lastMessageAt,
      direction: fromOurSide(latest.lastFrom) ? "out" : "in",
      snippet: previewLine(latest.lastSnippet),
      unread: all.some((t) => t.status === "open" && t.unreadCount > 0),
    });
  }
  return out;
}

/** One compact row per studio, newest activity first. `null` = not an agency member. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    const agencyId = scope.agencyId;
    const mailVisible = (await mailAccess(ctx)).allowed;

    const prospects = await ctx.db.query("outreachProspects").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).order("desc").take(MAX_PROSPECTS);
    const suppressed = new Set(
      (await ctx.db.query("outreachSuppressions").withIndex("by_agency_email", (q) => q.eq("agencyId", agencyId)).take(MAX_SUPPRESSIONS)).map((s) => s.email),
    );
    const seqs = groupBy(
      await ctx.db.query("outreachSequences").withIndex("by_agency_recipient", (q) => q.eq("agencyId", agencyId)).take(MAX_SEQUENCES),
      (s) => s.prospectId,
    );

    const addressesOf = new Map<string, Set<string>>();
    const studiosAt = new Map<string, string[]>();
    for (const p of prospects) {
      const addrs = studioAddresses(p, seqs.get(p._id) ?? []);
      addressesOf.set(p._id, addrs);
      for (const a of addrs) studiosAt.set(a, [...(studiosAt.get(a) ?? []), p._id]);
    }

    // Outreach emails Pulse sent. A send names its recipient, not its studio, so
    // the address links it (newest first: the first hit per studio is its latest).
    const lastEmail = new Map<string, Activity>();
    const comms = await ctx.db.query("outreachCommunications").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).order("desc").take(MAX_COMMS);
    for (const c of comms) {
      if (c.isTest) continue;
      for (const id of studiosAt.get(c.recipient) ?? []) {
        if (!lastEmail.has(id)) lastEmail.set(id, { at: c.createdAt, kind: "email", direction: "out", snippet: c.subject });
      }
    }

    const lastDm = new Map<string, Activity>();
    const dms = await ctx.db.query("outreachDms").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).order("desc").take(MAX_DMS);
    for (const d of dms) {
      if (d.status !== "sent" && d.status !== "approved") continue;
      const at = d.sentAt ?? d.approvedAt ?? d.createdAt;
      const prev = lastDm.get(d.prospectId);
      if (!prev || at > prev.at) lastDm.set(d.prospectId, { at, kind: "dm", direction: "out", snippet: previewLine(d.text) });
    }

    const mail = mailVisible ? await latestMailByStudio(ctx, agencyId, prospects, addressesOf, seqs) : new Map<string, MailSummary>();

    const rows: InboxRow[] = prospects.map((p) => {
      const acts: Activity[] = [];
      const email = lastEmail.get(p._id);
      if (email) acts.push(email);
      const dm = lastDm.get(p._id);
      if (dm) acts.push(dm);
      const m = mail.get(p._id);
      if (m) acts.push({ at: m.at, kind: "mail", direction: m.direction, snippet: m.snippet });
      else {
        // A reply the viewer cannot read here (or one that came by phone or DM).
        const repliedAt = p.replyIntent?.receivedAt ?? p.repliedAt;
        if (repliedAt) acts.push({ at: repliedAt, kind: "reply", direction: "in", snippet: null });
      }
      const last = latestActivity(acts, p.createdAt);
      const seq = (seqs.get(p._id) ?? []).sort((a, b) => b.createdAt - a.createdAt)[0];
      const emails = (p.contacts?.emails ?? []).map((e) => e.address);
      const open = emails.filter((e) => !suppressed.has(e));
      const optedOut = p.status === "suppressed" || Boolean(p.replyIntent?.optedOut) || (emails.length > 0 && open.length === 0);
      return {
        id: p._id,
        name: displayName(p),
        handle: p.handle ?? null,
        host: p.websiteUrl ? hostName(p.websiteUrl) : null,
        websiteUrl: p.websiteUrl ?? null,
        primaryEmail: seq?.recipient ?? open[0] ?? emails[0] ?? null,
        emails,
        status: p.status,
        note: p.note ?? null,
        createdAt: p.createdAt,
        lastActivityAt: last.at,
        lastKind: last.kind,
        lastDirection: last.direction,
        lastSnippet: last.snippet,
        hasUnreadReply: m?.unread ?? false,
        replied: p.status === "replied" || Boolean(p.repliedAt) || Boolean(p.replyIntent) || last.direction === "in",
        replyIntent: p.replyIntent ? { label: p.replyIntent.label, optedOut: p.replyIntent.optedOut } : null,
        bookedAt: p.bookedAt ?? null,
        optedOut,
        routingConfirmed: p.routingConfirmed ?? false,
        sequence: seq ? { step: seq.step, status: seq.status } : null,
      };
    });
    rows.sort((a, b) => b.lastActivityAt - a.lastActivityAt || b.createdAt - a.createdAt);
    return { canManage: scope.canManage, mailVisible, suppressedCount: suppressed.size, rows };
  },
});

/* ------------------------------ conversation ------------------------------ */

const SOURCE_TEXT: Record<Doc<"outreachProspects">["source"], string> = {
  paste: "to the list by paste",
  shortcut: "from the iPhone shortcut",
  instaloader: "from the Instaloader helper",
  maps: "from a Google Maps search",
  instagram_search: "from an Instagram search",
};

const MAIL_SEND_MEANING: Record<string, string> = {
  sending: "Being handed to the email provider right now.",
  accepted: "The provider accepted the message. This is not inbox delivery.",
  rejected: "The provider refused the message. Nothing was sent.",
  unknown: "The outcome is unclear. Check Resend before sending it again.",
};

const templateName = (key: string) => (isTemplateKey(key) ? TEMPLATES[key].name : key);
const personaFrom = (persona: Doc<"outreachDrafts">["persona"]) => `${PERSONAS[persona].fromName} <${PERSONAS[persona].fromEmail}>`;
const clip = (s: string | undefined | null) => (s ? s.slice(0, MAX_TEXT_CHARS) : null);

/** The studio's mail threads, by the reply rule (see threadClaim), plus the
 *  thread of the reply Jev read (sequencesAnsweredBy already tied it to this
 *  studio). Returns each thread with its newest messages. */
async function studioThreads(
  ctx: QueryCtx, agencyId: string, p: Doc<"outreachProspects">, addresses: ReadonlySet<string>, seqs: readonly SeqLite[],
): Promise<Array<{ thread: Doc<"mailThreads">; messages: Doc<"mailMessages">[] }>> {
  const claimed = new Map<string, { thread: Doc<"mailThreads">; messages: Doc<"mailMessages">[] | null }>();
  let checks = 0;
  for (const th of await recentThreads(ctx, agencyId)) {
    const claim = threadClaim(th, addresses, seqs);
    if (claim === "address") claimed.set(th._id, { thread: th, messages: null });
    else if (claim === "subject" && checks < MAX_SUBJECT_CHECKS) {
      checks++;
      const msgs = await threadMessages(ctx, th._id);
      if (msgs.some((m) => seqs.some((s) => answersSequence(m, s)))) claimed.set(th._id, { thread: th, messages: msgs });
    }
  }
  if (p.replyIntent) {
    const m = await ctx.db.get(p.replyIntent.messageId);
    if (m && m.agencyId === agencyId && !claimed.has(m.threadId)) {
      const th = await ctx.db.get(m.threadId);
      if (th && th.agencyId === agencyId && th.status !== "quarantined") claimed.set(th._id, { thread: th, messages: null });
    }
  }
  const out: Array<{ thread: Doc<"mailThreads">; messages: Doc<"mailMessages">[] }> = [];
  let total = 0;
  const newestFirst = [...claimed.values()].sort((a, b) => b.thread.lastMessageAt - a.thread.lastMessageAt);
  for (const c of newestFirst) {
    if (total >= MAX_MAIL_MESSAGES) break;
    const msgs = (c.messages ?? (await threadMessages(ctx, c.thread._id))).slice(0, MAX_MAIL_MESSAGES - total);
    total += msgs.length;
    out.push({ thread: c.thread, messages: msgs });
  }
  return out;
}

/** One studio: its contact card and a merged, time-ordered history (oldest
 *  first). `null` = not an agency member, or not this agency's studio. */
export const conversation = query({
  args: { prospectId: v.id("outreachProspects") },
  handler: async (ctx, { prospectId }) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    const agencyId = scope.agencyId;
    const p = await ctx.db.get(prospectId);
    if (!p || p.agencyId !== agencyId) return null;
    const mailVisible = (await mailAccess(ctx)).allowed;
    const now = Date.now();

    const seqs = await ctx.db.query("outreachSequences").withIndex("by_prospect", (q) => q.eq("prospectId", prospectId)).take(5);
    const seq = [...seqs].sort((a, b) => b.createdAt - a.createdAt)[0];
    const addresses = studioAddresses(p, seqs);
    const suppressed = new Set<string>();
    for (const e of p.contacts?.emails ?? []) {
      const row = await ctx.db.query("outreachSuppressions").withIndex("by_agency_email", (q) => q.eq("agencyId", agencyId).eq("email", e.address)).first();
      if (row) suppressed.add(e.address);
    }

    const items: TimelineItem[] = [];
    let budget = BODY_BUDGET_CHARS;
    const spend = (html: string | null, text: string | null) => {
      const size = (html?.length ?? 0) + (text?.length ?? 0);
      if (size > budget) return false;
      budget -= size;
      return true;
    };

    /* Mail first, newest first, so the body budget goes to the newest messages. */
    const intentFor = (id: Id<"mailMessages">) =>
      p.replyIntent && p.replyIntent.messageId === id
        ? { label: p.replyIntent.label, probability: p.replyIntent.probabilities[p.replyIntent.label] ?? null, optedOut: p.replyIntent.optedOut }
        : null;
    const unreadThreadIds: Id<"mailThreads">[] = [];
    let intentShown = false;
    if (mailVisible) {
      const threads = await studioThreads(ctx, agencyId, p, addresses, seqs);
      const messages = threads.flatMap((t) => t.messages).sort((a, b) => (b.receivedAt ?? b.sentAt ?? b.createdAt) - (a.receivedAt ?? a.sentAt ?? a.createdAt));
      for (const t of threads) if (t.thread.unreadCount > 0) unreadThreadIds.push(t.thread._id);
      for (const m of messages) {
        const html = m.html ?? null;
        const text = clip(m.text);
        const keep = spend(html, text);
        const intent = intentFor(m._id);
        if (intent) intentShown = true;
        const item: EmailItem = {
          id: `mail:${m._id}`, kind: "email", source: "mail", at: m.receivedAt ?? m.sentAt ?? m.createdAt, direction: m.direction,
          from: m.from, to: m.to, cc: m.cc, subject: m.subject, snippet: m.snippet,
          text: keep ? text : null, html: keep ? html : null, htmlTruncated: m.htmlTruncated ?? false, bodyOmitted: !keep,
          bodyPending: m.bodyStatus === "pending", label: null, draftId: null, messageId: m._id, threadId: m.threadId,
          unread: m.direction === "in" && !m.read,
          delivery: m.direction === "out" && m.sendStatus
            ? { status: m.sendStatus, meaning: MAIL_SEND_MEANING[m.sendStatus] ?? "", error: m.sendError ?? null }
            : null,
          intent,
          attachments: m.attachments.map((x, i) => ({
            index: i, filename: x.filename, contentType: x.contentType, size: x.size ?? null, inline: x.inline, status: x.status, note: x.note ?? null,
          })),
          authFailed: m.direction === "in" && Boolean(m.authentication?.dmarc) && m.authentication?.dmarc !== "pass",
        };
        items.push(item);
      }
    }

    /* Outreach emails: sent (or sending) drafts with what the provider said, and
       drafts still waiting in the Review queue. Superseded and cancelled drafts
       never went anywhere and are left out. */
    const drafts = await ctx.db.query("outreachDrafts").withIndex("by_prospect", (q) => q.eq("prospectId", prospectId)).order("desc").take(MAX_DRAFTS);
    const draftKeys = new Set<string>();
    for (const d of drafts) {
      if (d.agencyId !== agencyId) continue;
      const from = personaFrom(d.persona);
      const label = d.sequenceStep === undefined ? templateName(d.templateKey) : `Step ${d.sequenceStep}: ${templateName(d.templateKey)}`;
      if (d.status === "sent" || d.status === "sending") {
        const key = `draft:${d._id}`;
        draftKeys.add(key);
        const comm = await ctx.db.query("outreachCommunications").withIndex("by_agency_key", (q) => q.eq("agencyId", agencyId).eq("idempotencyKey", key)).first();
        const status: string = comm?.status ?? (d.status === "sent" ? "accepted" : "submitting");
        const text = clip(d.text);
        const keep = spend(d.html, text);
        items.push({
          id: `draft:${d._id}`, kind: "email", source: "outreach", at: comm?.createdAt ?? d.approvedAt ?? d.createdAt, direction: "out",
          from, to: [d.recipient], cc: [], subject: d.subject, snippet: previewLine(d.text),
          text: keep ? text : null, html: keep ? d.html : null, htmlTruncated: false, bodyOmitted: !keep, bodyPending: false,
          label, draftId: d._id, messageId: null, threadId: null, unread: false,
          delivery: { status, meaning: STATUS_MEANING[status as CommStatus] ?? "", error: redact(comm?.lastError) ?? null },
          intent: null, attachments: [], authFailed: false,
        });
      } else if (d.status === "draft" || d.status === "hold" || d.status === "approved") {
        const expired = d.status === "approved" && d.approvedAt !== undefined && now - d.approvedAt > APPROVAL_TTL_MS;
        items.push({
          id: `pending:${d._id}`, kind: "draft", draftId: d._id, at: d.createdAt, direction: "out",
          status: expired ? "expired" : d.status, holdReason: d.holdReason ?? null, label, from, to: [d.recipient],
          subject: d.subject, snippet: previewLine(d.text), text: d.text.slice(0, MAX_TEXT_CHARS),
        });
      }
    }

    /* A send recorded without a draft (an operator log entry) to one of the studio's addresses. */
    const comms = await ctx.db.query("outreachCommunications").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).order("desc").take(MAX_COMMS);
    for (const c of comms) {
      if (c.isTest || !addresses.has(c.recipient) || draftKeys.has(c.idempotencyKey) || c.idempotencyKey.startsWith("draft:")) continue;
      items.push({
        id: `log:${c._id}`, kind: "email", source: "log", at: c.createdAt, direction: "out",
        from: c.sender, to: [c.recipient], cc: [], subject: c.subject, snippet: c.subject, text: null, html: null,
        htmlTruncated: false, bodyOmitted: false, bodyPending: false, label: c.templateKey ? templateName(c.templateKey) : null,
        draftId: null, messageId: null, threadId: null, unread: false,
        delivery: { status: c.status, meaning: STATUS_MEANING[c.status], error: redact(c.lastError) ?? null },
        intent: null, attachments: [], authFailed: false,
      });
    }

    /* Instagram DMs a person approved or marked sent (Pulse never sends a DM). */
    const dms = await ctx.db.query("outreachDms").withIndex("by_prospect", (q) => q.eq("prospectId", prospectId)).order("desc").take(MAX_PROSPECT_DMS);
    for (const d of dms) {
      if (d.agencyId !== agencyId || (d.status !== "sent" && d.status !== "approved")) continue;
      items.push({
        id: `dm:${d._id}`, kind: "dm", at: d.sentAt ?? d.approvedAt ?? d.createdAt, direction: "out",
        status: d.status, handle: d.handle, text: d.text, snippet: previewLine(d.text),
      });
    }

    /* Demos booked on the Zuops calendar, matched by the sync or by email, and their confirmation calls. */
    const bookings = (await ctx.db.query("outreachBookings").withIndex("by_agency_start", (q) => q.eq("agencyId", agencyId)).order("desc").take(MAX_BOOKINGS))
      .filter((b) => b.prospectId === prospectId || (b.contactEmail && addresses.has(b.contactEmail.trim().toLowerCase())));
    for (const b of bookings) {
      items.push({
        id: `booking:${b._id}`, kind: "booking", at: b.startsAt, direction: null, status: b.status, title: b.title,
        startsAt: b.startsAt, endsAt: b.endsAt, timezone: b.timezone ?? null, location: b.location ?? null, meetingUrl: b.meetingUrl ?? null,
        contactName: b.contactName ?? null, contactEmail: b.contactEmail ?? null,
      });
      const calls = await ctx.db.query("outreachCalls").withIndex("by_agency_booking", (q) => q.eq("agencyId", agencyId).eq("bookingId", b._id)).take(MAX_CALLS_PER_BOOKING);
      for (const c of calls) {
        // The phone number never leaves the server.
        items.push({
          id: `call:${c._id}`, kind: "call", at: c.dialedAt ?? c.scheduledFor, direction: "out", status: c.status,
          skipReason: c.skipReason ?? null, summary: c.result?.summary ?? null, disposition: c.result?.disposition ?? null,
          error: c.result?.error ?? null, answeredBy: c.answeredBy ?? null,
        });
      }
    }

    /* Key status changes, from fields the studio's row already carries. */
    items.push({ id: "event:added", kind: "event", at: p.createdAt, direction: null, text: `Added ${SOURCE_TEXT[p.source]}.` });
    if (p.contacts) {
      const n = p.contacts.emails.length;
      items.push({
        id: "event:read", kind: "event", at: p.contacts.scrapedAt, direction: null,
        text: n ? `Read the studio's website: ${n} published email address${n === 1 ? "" : "es"} found.` : "Read the studio's website: no published email address found.",
      });
    }
    if (p.routingConfirmed && p.routingConfirmedAt) {
      items.push({ id: "event:routing", kind: "event", at: p.routingConfirmedAt, direction: null, text: "Routing confirmed: you checked who handles studio operations." });
    }
    if (p.repliedAt) items.push({ id: "event:replied", kind: "event", at: p.repliedAt, direction: null, text: "Status changed to replied. Follow-ups stopped." });
    for (const s of seqs) {
      if (s.stoppedAt && s.stoppedReason && s.stoppedReason !== "replied") {
        items.push({ id: `event:stopped:${s._id}`, kind: "event", at: s.stoppedAt, direction: null, text: `Follow-ups stopped. ${STOP_MEANING[s.stoppedReason]}` });
      }
    }
    if (p.replyIntent && !intentShown) {
      items.push({
        id: "event:intent", kind: "event", at: p.replyIntent.at, direction: null,
        text: `Jev read the latest reply as "${p.replyIntent.label.replace(/_/g, " ")}".${p.replyIntent.optedOut ? " The address was opted out automatically." : ""}`,
      });
    }

    const { items: timeline, truncated } = mergeTimeline(items, MAX_TIMELINE);
    return {
      canManage: scope.canManage,
      mailVisible,
      prospect: {
        ...prospectRow(p, suppressed, seq),
        displayName: displayName(p),
        host: p.websiteUrl ? hostName(p.websiteUrl) : null,
        routingConfirmedAt: p.routingConfirmedAt ?? null,
      },
      timeline,
      truncated,
      unreadThreadIds,
    };
  },
});
