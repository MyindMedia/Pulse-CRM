import { query, internalQuery, internalAction, type QueryCtx, type MutationCtx } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { AccessError } from "./lib/access";
import { agencyScope, logEvent, type AgencyScope } from "./outreach/scope";
import { redact } from "./outreach/policy";
import { fileUrl, claimFile } from "./lib/media";
import { checkLocalPart, checkDisplayName, bareAddress, isSendableAddress, ownAddress, quarantinedRecipient, routeRecipients, MAIL_DOMAIN } from "./mail/address";
import { normalizeSubject, lookupOrder, chooseBySubject, buildReferences, replySubject } from "./mail/threading";
import { buildOutboundPayload, payloadFromStored } from "./mail/compose";
import { snippetOf } from "./mail/inbound";
import { stripEmDashes } from "./lib/text";

/* ============================================================
   Agency Email tab: a shared inbox for studiopulse.tech.

   The domain belongs to one agency (MAIL_AGENCY_ID, falling back to
   OUTREACH_INTAKE_AGENCY_ID). Only that agency's owners and admins can read or
   send. Inbound mail arrives through convex/mailInbound.ts.
   ============================================================ */

type Ctx = QueryCtx | MutationCtx;

export function mailAgencyId(): string | null {
  return process.env.MAIL_AGENCY_ID || process.env.OUTREACH_INTAKE_AGENCY_ID || null;
}

type MailAccess = { allowed: true; scope: AgencyScope } | { allowed: false; reason: "signed_out" | "forbidden" | "not_setup" };

async function mailAccess(ctx: Ctx): Promise<MailAccess> {
  const scope = await agencyScope(ctx);
  if (!scope) return { allowed: false, reason: "signed_out" };
  if (!scope.canManage) return { allowed: false, reason: "forbidden" };
  const owner = mailAgencyId();
  if (!owner) return { allowed: false, reason: "not_setup" };
  if (scope.agencyId !== owner) return { allowed: false, reason: "forbidden" };
  return { allowed: true, scope };
}

async function requireMail(ctx: Ctx): Promise<AgencyScope> {
  const a = await mailAccess(ctx);
  if (a.allowed) return a.scope;
  if (a.reason === "not_setup") throw new ConvexError("Email is not set up on this deployment. Set MAIL_AGENCY_ID.");
  throw new AccessError("FORBIDDEN", "Only an owner or admin of the agency that owns studiopulse.tech can use Email");
}

/** For the nav and the page: may this viewer use Email? */
export const access = query({
  args: {},
  handler: async (ctx) => {
    const a = await mailAccess(ctx);
    return a.allowed ? { allowed: true as const, domain: MAIL_DOMAIN } : { allowed: false as const, reason: a.reason, domain: MAIL_DOMAIN };
  },
});

/* ------------------------------- mailboxes ------------------------------- */

export const DEFAULT_MAILBOXES: ReadonlyArray<{
  localPart: string; displayName: string; fromName: string; kind: "shared" | "personal"; signature?: "lawrence";
}> = [
  { localPart: "support", displayName: "Support", fromName: "Pulse Support", kind: "shared" },
  { localPart: "lawrenceb", displayName: "Lawrence B", fromName: "Lawrence Berment", kind: "personal", signature: "lawrence" },
  // Outreach emails set reply-to info@, so prospect replies land here.
  { localPart: "info", displayName: "Info", fromName: "Pulse", kind: "shared" },
];

async function seed(ctx: MutationCtx, agencyId: string, actor: string): Promise<number> {
  let added = 0;
  for (const d of DEFAULT_MAILBOXES) {
    const address = `${d.localPart}@${MAIL_DOMAIN}`;
    const existing = await ctx.db.query("mailboxes").withIndex("by_address", (q) => q.eq("address", address)).first();
    if (existing) continue;
    await ctx.db.insert("mailboxes", {
      agencyId, address, localPart: d.localPart, displayName: d.displayName, fromName: d.fromName, kind: d.kind,
      ...(d.signature ? { signature: d.signature } : {}), active: true, createdAt: Date.now(), createdBy: actor,
    });
    added++;
  }
  if (added) await logEvent(ctx, agencyId, actor, "mail.mailboxes_seeded", "ok", undefined, `${added}`);
  return added;
}

/** Creates Support, Lawrence B and Info if they do not exist yet. Safe to call repeatedly. */
export const ensureDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    const scope = await requireMail(ctx);
    return await seed(ctx, scope.agencyId, scope.actor);
  },
});

/** Same, from the CLI (`npx convex run --prod mail:seedDefaults`). */
export const seedDefaults = internalMutation({
  args: {},
  handler: async (ctx) => {
    const agencyId = mailAgencyId();
    if (!agencyId) throw new ConvexError("Set MAIL_AGENCY_ID first");
    return await seed(ctx, agencyId, "cli");
  },
});

export const createMailbox = mutation({
  args: { localPart: v.string(), displayName: v.string(), fromName: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const scope = await requireMail(ctx);
    const lp = checkLocalPart(a.localPart);
    if (!lp.ok) throw new ConvexError(lp.error);
    const dn = checkDisplayName(a.displayName);
    if (!dn.ok) throw new ConvexError(dn.error);
    const fn = a.fromName?.trim() ? checkDisplayName(a.fromName) : dn;
    if (!fn.ok) throw new ConvexError(fn.error);
    const dup = await ctx.db.query("mailboxes").withIndex("by_address", (q) => q.eq("address", lp.address)).first();
    if (dup) throw new ConvexError(`${lp.address} already exists.`);
    const id = await ctx.db.insert("mailboxes", {
      agencyId: scope.agencyId, address: lp.address, localPart: lp.localPart, displayName: dn.value, fromName: fn.value,
      kind: "shared", active: true, createdAt: Date.now(), createdBy: scope.actor,
    });
    await logEvent(ctx, scope.agencyId, scope.actor, "mail.mailbox_created", "ok", lp.address);
    return { id, address: lp.address, displayName: dn.value };
  },
});

async function unreadFor(ctx: Ctx, agencyId: string, mailboxId: Id<"mailboxes"> | undefined): Promise<number> {
  const rows = await ctx.db
    .query("mailThreads")
    .withIndex("by_agency_mailbox_last", (q) => q.eq("agencyId", agencyId).eq("mailboxId", mailboxId))
    .order("desc")
    .take(500);
  return rows.reduce((n, t) => n + (t.status === "open" ? t.unreadCount : 0), 0);
}

export const listMailboxes = query({
  args: {},
  handler: async (ctx) => {
    const a = await mailAccess(ctx);
    if (!a.allowed) return null;
    const boxes = await ctx.db.query("mailboxes").withIndex("by_agency", (q) => q.eq("agencyId", a.scope.agencyId)).collect();
    const out = [];
    for (const b of boxes.sort((x, y) => x.createdAt - y.createdAt)) {
      out.push({
        _id: b._id, address: b.address, displayName: b.displayName, fromName: b.fromName, kind: b.kind,
        active: b.active, unread: await unreadFor(ctx, a.scope.agencyId, b._id),
      });
    }
    return { mailboxes: out, unroutedUnread: await unreadFor(ctx, a.scope.agencyId, undefined), domain: MAIL_DOMAIN };
  },
});

/* -------------------------------- threads -------------------------------- */

export const listThreads = query({
  args: { box: v.union(v.id("mailboxes"), v.literal("unrouted")), archived: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const access = await mailAccess(ctx);
    if (!access.allowed) return null;
    const mailboxId = a.box === "unrouted" ? undefined : a.box;
    if (mailboxId) {
      const box = await ctx.db.get(mailboxId);
      if (!box || box.agencyId !== access.scope.agencyId) return null;
    }
    const want = a.archived ? "archived" : "open";
    const rows = await ctx.db
      .query("mailThreads")
      .withIndex("by_agency_mailbox_last", (q) => q.eq("agencyId", access.scope.agencyId).eq("mailboxId", mailboxId))
      .order("desc")
      .take(300);
    return rows.filter((t) => t.status === want).slice(0, 100).map((t) => ({
      _id: t._id, subject: t.subject, lastFrom: t.lastFrom, lastSnippet: t.lastSnippet, lastMessageAt: t.lastMessageAt,
      unreadCount: t.unreadCount, messageCount: t.messageCount, participants: t.participants,
      originalRecipients: t.originalRecipients ?? [], status: t.status,
    }));
  },
});

async function ownThread(ctx: Ctx, agencyId: string, threadId: Id<"mailThreads">): Promise<Doc<"mailThreads">> {
  const t = await ctx.db.get(threadId);
  if (!t || t.agencyId !== agencyId) throw new AccessError("FORBIDDEN", "Thread not found");
  return t;
}

export const getThread = query({
  args: { threadId: v.id("mailThreads") },
  handler: async (ctx, { threadId }) => {
    const a = await mailAccess(ctx);
    if (!a.allowed) return null;
    const t = await ctx.db.get(threadId);
    if (!t || t.agencyId !== a.scope.agencyId) return null;
    const msgs = await ctx.db.query("mailMessages").withIndex("by_thread", (q) => q.eq("threadId", threadId)).take(200);
    const mailbox = t.mailboxId ? await ctx.db.get(t.mailboxId) : null;
    return {
      thread: { _id: t._id, subject: t.subject, status: t.status, participants: t.participants, originalRecipients: t.originalRecipients ?? [], mailboxId: t.mailboxId ?? null },
      mailbox: mailbox ? { _id: mailbox._id, address: mailbox.address, displayName: mailbox.displayName, fromName: mailbox.fromName, kind: mailbox.kind } : null,
      messages: msgs.map((m) => ({
        _id: m._id, direction: m.direction, from: m.from, fromAddress: m.fromAddress, to: m.to, cc: m.cc, subject: m.subject,
        text: m.text ?? null, html: m.html ?? null, htmlTruncated: m.htmlTruncated ?? false, at: m.receivedAt ?? m.sentAt ?? m.createdAt,
        read: m.read, bodyStatus: m.bodyStatus ?? "ok", sendStatus: m.sendStatus ?? null, sendError: m.sendError ?? null,
        authentication: m.authentication ?? null,
        attachments: m.attachments.map((x, i) => ({ index: i, filename: x.filename, contentType: x.contentType, size: x.size ?? null, inline: x.inline, status: x.status, note: x.note ?? null })),
      })),
    };
  },
});

/** A short-lived signed URL for one stored attachment. */
export const attachmentUrl = query({
  args: { messageId: v.id("mailMessages"), index: v.number() },
  handler: async (ctx, a) => {
    const access = await mailAccess(ctx);
    if (!access.allowed) return null;
    const m = await ctx.db.get(a.messageId);
    if (!m || m.agencyId !== access.scope.agencyId) return null;
    const att = m.attachments[a.index];
    if (!att || att.status !== "stored" || !att.fileRef) return null;
    return await fileUrl(ctx, att.fileRef, { expiresIn: 600 });
  },
});

export const markThreadRead = mutation({
  args: { threadId: v.id("mailThreads") },
  handler: async (ctx, { threadId }) => {
    const scope = await requireMail(ctx);
    const t = await ownThread(ctx, scope.agencyId, threadId);
    if (t.unreadCount === 0) return null;
    const msgs = await ctx.db.query("mailMessages").withIndex("by_thread", (q) => q.eq("threadId", threadId)).take(200);
    for (const m of msgs) if (!m.read) await ctx.db.patch(m._id, { read: true });
    await ctx.db.patch(threadId, { unreadCount: 0 });
    return null;
  },
});

export const setThreadStatus = mutation({
  args: { threadId: v.id("mailThreads"), status: v.union(v.literal("open"), v.literal("archived")) },
  handler: async (ctx, a) => {
    const scope = await requireMail(ctx);
    await ownThread(ctx, scope.agencyId, a.threadId);
    await ctx.db.patch(a.threadId, { status: a.status });
    return null;
  },
});

/** Move a thread (usually from Unrouted) into a mailbox. */
export const moveThread = mutation({
  args: { threadId: v.id("mailThreads"), mailboxId: v.id("mailboxes") },
  handler: async (ctx, a) => {
    const scope = await requireMail(ctx);
    await ownThread(ctx, scope.agencyId, a.threadId);
    const box = await ctx.db.get(a.mailboxId);
    if (!box || box.agencyId !== scope.agencyId) throw new AccessError("FORBIDDEN", "Mailbox not found");
    await ctx.db.patch(a.threadId, { mailboxId: a.mailboxId });
    const msgs = await ctx.db.query("mailMessages").withIndex("by_thread", (q) => q.eq("threadId", a.threadId)).take(200);
    for (const m of msgs) await ctx.db.patch(m._id, { mailboxId: a.mailboxId });
    await logEvent(ctx, scope.agencyId, scope.actor, "mail.thread_moved", "ok", box.address);
    return null;
  },
});

/* ------------------------------- inbound ------------------------------- */

const inboundV = v.object({
  resendEmailId: v.string(),
  from: v.string(),
  to: v.array(v.string()),
  cc: v.array(v.string()),
  replyTo: v.array(v.string()),
  receivedFor: v.array(v.string()),
  subject: v.string(),
  text: v.optional(v.string()),
  html: v.optional(v.string()),
  htmlTruncated: v.optional(v.boolean()),
  messageId: v.optional(v.string()),
  inReplyTo: v.optional(v.string()),
  references: v.array(v.string()),
  receivedAt: v.number(),
  authentication: v.optional(v.object({ spf: v.optional(v.string()), dkim: v.optional(v.string()), dmarc: v.optional(v.string()) })),
  attachments: v.array(v.object({
    resendId: v.optional(v.string()), filename: v.string(), contentType: v.string(), size: v.optional(v.number()),
    contentId: v.optional(v.string()), inline: v.boolean(),
  })),
  bodyStatus: v.union(v.literal("ok"), v.literal("pending")),
});

export const _byResendId = internalQuery({
  args: { resendEmailId: v.string() },
  handler: async (ctx, a) => {
    const m = await ctx.db.query("mailMessages").withIndex("by_resend_id", (q) => q.eq("resendEmailId", a.resendEmailId)).first();
    return m ? { _id: m._id, bodyStatus: m.bodyStatus ?? "ok" } : null;
  },
});

/** External participants: everyone on the message who is not one of our addresses. */
function externalParticipants(m: { from: string; to: string[]; cc: string[] }): string[] {
  const out: string[] = [];
  for (const raw of [m.from, ...m.to, ...m.cc]) {
    const a = bareAddress(raw);
    if (a && !ownAddress(a) && !out.includes(a)) out.push(a);
  }
  return out;
}

async function findThread(
  ctx: MutationCtx, agencyId: string, mailboxId: Id<"mailboxes"> | undefined,
  m: { inReplyTo?: string; references: string[]; subject: string; from: string }, now: number, excludeThread?: Id<"mailThreads">,
  quarantined = false,
): Promise<Id<"mailThreads"> | null> {
  // Quarantined mail threads only with quarantined mail, so it can never join
  // (or reopen) a thread that is shown in Unrouted, and the reverse.
  const sameShelf = (t: Doc<"mailThreads"> | null) => Boolean(t) && (t!.status === "quarantined") === quarantined;
  for (const id of lookupOrder(m.inReplyTo, m.references)) {
    const hits = await ctx.db.query("mailMessages").withIndex("by_agency_message_id", (q) => q.eq("agencyId", agencyId).eq("messageId", id)).take(5);
    for (const h of hits) {
      if (h.mailboxId !== mailboxId || h.threadId === excludeThread) continue;
      if (sameShelf(await ctx.db.get(h.threadId))) return h.threadId;
    }
  }
  const norm = normalizeSubject(m.subject);
  if (!norm) return null;
  const cands = (await ctx.db.query("mailThreads").withIndex("by_mailbox_subject", (q) => q.eq("mailboxId", mailboxId).eq("normalizedSubject", norm)).take(20))
    .filter((t) => t.agencyId === agencyId && t._id !== excludeThread && sameShelf(t));
  const chosen = chooseBySubject(cands.map((t) => ({ id: t._id, participants: t.participants, lastMessageAt: t.lastMessageAt, status: t.status })), bareAddress(m.from), now);
  return (chosen as Id<"mailThreads"> | null) ?? null;
}

/** Stores one inbound message: dedupe, route, thread. Never drops: an unknown
 *  recipient lands in Unrouted. */
export const _ingest = internalMutation({
  args: { agencyId: v.string(), msg: inboundV },
  handler: async (ctx, { agencyId, msg }) => {
    const dup = await ctx.db.query("mailMessages").withIndex("by_resend_id", (q) => q.eq("resendEmailId", msg.resendEmailId)).first();
    if (dup) return { status: "duplicate" as const, messageId: dup._id, threadId: dup.threadId };
    const now = Date.now();

    const boxes = (await ctx.db.query("mailboxes").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).collect()).filter((b) => b.active);
    const route = routeRecipients(msg, new Set(boxes.map((b) => b.address)));
    const mailbox = route.address ? boxes.find((b) => b.address === route.address) : undefined;
    const mailboxId = mailbox?._id;
    // Unrouted mail to a domain role address (admin@, postmaster@...) can carry
    // domain-control links (certificate, registrar). Kept, but not shown to
    // every admin in Unrouted.
    const quarantinedTo = mailboxId ? null : quarantinedRecipient(route.candidates);
    const quarantined = quarantinedTo !== null;
    const openStatus = quarantined ? ("quarantined" as const) : ("open" as const);

    const fromAddress = bareAddress(msg.from) ?? "";
    const snippet = snippetOf(msg.text, msg.html);
    let threadId = await findThread(ctx, agencyId, mailboxId, msg, now, undefined, quarantined);
    if (threadId) {
      const t = await ctx.db.get(threadId);
      if (t) {
        const participants = [...new Set([...t.participants, ...externalParticipants(msg)])].slice(0, 50);
        const newer = msg.receivedAt >= t.lastMessageAt;
        await ctx.db.patch(threadId, {
          participants, messageCount: t.messageCount + 1, unreadCount: t.unreadCount + 1, status: openStatus,
          ...(newer ? { lastMessageAt: msg.receivedAt, lastSnippet: snippet, lastFrom: msg.from } : {}),
        });
      }
    } else {
      threadId = await ctx.db.insert("mailThreads", {
        agencyId, mailboxId, subject: msg.subject || "(no subject)", normalizedSubject: normalizeSubject(msg.subject),
        participants: externalParticipants(msg), originalRecipients: route.candidates.slice(0, 10),
        lastMessageAt: msg.receivedAt, lastSnippet: snippet, lastFrom: msg.from, messageCount: 1, unreadCount: 1,
        status: openStatus, createdAt: now,
      });
    }

    const messageId = await ctx.db.insert("mailMessages", {
      agencyId, threadId, mailboxId, direction: "in", from: msg.from, fromAddress, to: msg.to, cc: msg.cc,
      replyTo: msg.replyTo, receivedFor: msg.receivedFor, subject: msg.subject, text: msg.text, html: msg.html,
      htmlTruncated: msg.htmlTruncated, snippet, messageId: msg.messageId, inReplyTo: msg.inReplyTo, references: msg.references,
      resendEmailId: msg.resendEmailId, receivedAt: msg.receivedAt, createdAt: now, read: false, bodyStatus: msg.bodyStatus,
      authentication: msg.authentication,
      attachments: msg.attachments.map((x) => ({ ...x, status: "pending" as const })),
    });
    await logEvent(ctx, agencyId, "system", quarantined ? "mail.quarantined" : "mail.received", "ok", mailbox?.address ?? quarantinedTo ?? "unrouted");
    return { status: "stored" as const, messageId, threadId, routed: Boolean(mailboxId), attachments: msg.attachments.length };
  },
});

/** The full body arrived after a metadata-only store (fetch failed at webhook time). */
export const _applyBody = internalMutation({
  args: { messageId: v.id("mailMessages"), msg: inboundV },
  handler: async (ctx, { messageId, msg }) => {
    const m = await ctx.db.get(messageId);
    if (!m || m.bodyStatus === "ok") return null;
    const snippet = snippetOf(msg.text, msg.html);
    const existing = new Map(m.attachments.map((x) => [x.resendId, x]));
    await ctx.db.patch(messageId, {
      text: msg.text, html: msg.html, htmlTruncated: msg.htmlTruncated, snippet, inReplyTo: msg.inReplyTo,
      references: msg.references, messageId: msg.messageId ?? m.messageId, replyTo: msg.replyTo,
      authentication: msg.authentication, bodyStatus: "ok",
      attachments: msg.attachments.map((x) => existing.get(x.resendId) ?? { ...x, status: "pending" as const }),
    });
    const t = await ctx.db.get(m.threadId);
    if (!t) return null;
    // A message that started its own thread may belong to an older one now that
    // its In-Reply-To and References are known.
    if (t.messageCount === 1) {
      const quarantined = t.status === "quarantined";
      const better = await findThread(ctx, m.agencyId, m.mailboxId, msg, Date.now(), t._id, quarantined);
      if (better) {
        const target = await ctx.db.get(better);
        if (target) {
          await ctx.db.patch(messageId, { threadId: better });
          await ctx.db.patch(better, {
            messageCount: target.messageCount + 1, unreadCount: target.unreadCount + (m.read ? 0 : 1), status: quarantined ? "quarantined" : "open",
            participants: [...new Set([...target.participants, ...t.participants])].slice(0, 50),
            ...(msg.receivedAt >= target.lastMessageAt ? { lastMessageAt: msg.receivedAt, lastSnippet: snippet, lastFrom: m.from } : {}),
          });
          await ctx.db.delete(t._id);
          return null;
        }
      }
    }
    if (t.lastMessageAt <= (m.receivedAt ?? 0)) await ctx.db.patch(t._id, { lastSnippet: snippet });
    return null;
  },
});

export const _hydrateFailed = internalMutation({
  args: { messageId: v.id("mailMessages"), final: v.boolean() },
  handler: async (ctx, a) => {
    const m = await ctx.db.get(a.messageId);
    if (!m || m.bodyStatus === "ok") return null;
    await ctx.db.patch(a.messageId, { hydrateAttempts: (m.hydrateAttempts ?? 0) + 1, ...(a.final ? { bodyStatus: "failed" as const } : {}) });
    return null;
  },
});

export const _attachmentJob = internalQuery({
  args: { messageId: v.id("mailMessages") },
  handler: async (ctx, { messageId }) => {
    const m = await ctx.db.get(messageId);
    if (!m || !m.resendEmailId) return null;
    return {
      agencyId: m.agencyId, resendEmailId: m.resendEmailId,
      pending: m.attachments.map((x, i) => ({ index: i, resendId: x.resendId, filename: x.filename, contentType: x.contentType, status: x.status })).filter((x) => x.status === "pending"),
    };
  },
});

export const _setAttachment = internalMutation({
  args: {
    messageId: v.id("mailMessages"), index: v.number(), fileRef: v.optional(v.id("mediaFiles")), size: v.optional(v.number()),
    status: v.union(v.literal("stored"), v.literal("skipped"), v.literal("failed")), note: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const m = await ctx.db.get(a.messageId);
    if (!m || !m.attachments[a.index]) return null;
    if (a.fileRef) await claimFile(ctx, a.fileRef, `agency:${m.agencyId}`);
    const attachments = m.attachments.map((x, i) =>
      i === a.index ? { ...x, status: a.status, fileRef: a.fileRef, note: a.note, size: a.size ?? x.size } : x,
    );
    await ctx.db.patch(a.messageId, { attachments });
    return null;
  },
});

/* ------------------------------- outbound ------------------------------- */

const MAX_RECIPIENTS = 20;
const MAX_BODY = 20_000;

function cleanRecipients(list: string[] | undefined, label: string): string[] {
  const out: string[] = [];
  for (const raw of list ?? []) {
    const a = bareAddress(raw);
    if (!a || !isSendableAddress(a)) throw new ConvexError(`${label}: "${raw.slice(0, 80)}" is not an email address.`);
    if (!out.includes(a)) out.push(a);
  }
  if (out.length > MAX_RECIPIENTS) throw new ConvexError(`${label}: ${MAX_RECIPIENTS} addresses at most.`);
  return out;
}

/** Reply in a thread, or start a new one, from a mailbox. Owner or admin only. */
export const send = mutation({
  args: {
    mailboxId: v.id("mailboxes"),
    threadId: v.optional(v.id("mailThreads")),
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
    body: v.string(),
  },
  handler: async (ctx, a) => {
    const scope = await requireMail(ctx);
    const box = await ctx.db.get(a.mailboxId);
    if (!box || box.agencyId !== scope.agencyId) throw new AccessError("FORBIDDEN", "Mailbox not found");
    if (!box.active) throw new ConvexError("That inbox is turned off.");
    const to = cleanRecipients(a.to, "To");
    const cc = cleanRecipients(a.cc, "Cc");
    if (to.length === 0) throw new ConvexError("Add at least one recipient.");
    const body = a.body.trim();
    if (!body) throw new ConvexError("Write a message first.");
    if (body.length > MAX_BODY) throw new ConvexError("That message is too long.");

    let thread: Doc<"mailThreads"> | null = null;
    let inReplyTo: string | undefined;
    let references: string[] = [];
    if (a.threadId) {
      thread = await ownThread(ctx, scope.agencyId, a.threadId);
      if (thread.mailboxId !== a.mailboxId) throw new ConvexError("Reply from the inbox this conversation belongs to. Move it there first.");
      const msgs = await ctx.db.query("mailMessages").withIndex("by_thread", (q) => q.eq("threadId", a.threadId!)).take(200);
      const last = [...msgs].reverse().find((m) => m.messageId);
      if (last) {
        inReplyTo = last.messageId;
        references = buildReferences(last.references ?? [], last.messageId);
      }
    }
    const subject = a.subject?.trim() ? a.subject : thread ? replySubject(thread.subject) : "";
    if (!subject.trim()) throw new ConvexError("Add a subject.");

    const built = buildOutboundPayload({
      mailbox: { address: box.address, fromName: box.fromName, kind: box.kind, signature: box.signature },
      to, cc, subject, body, inReplyTo, references,
    });
    const now = Date.now();
    const snippet = snippetOf(stripEmDashes(body), undefined);
    const participants = [...to, ...cc].filter((x) => !ownAddress(x));
    let threadId: Id<"mailThreads">;
    if (thread) {
      threadId = thread._id;
      await ctx.db.patch(threadId, {
        lastMessageAt: now, lastSnippet: snippet, lastFrom: built.payload.from, status: "open",
        messageCount: thread.messageCount + 1, participants: [...new Set([...thread.participants, ...participants])].slice(0, 50),
      });
    } else {
      threadId = await ctx.db.insert("mailThreads", {
        agencyId: scope.agencyId, mailboxId: box._id, subject: built.subject, normalizedSubject: normalizeSubject(built.subject),
        participants, lastMessageAt: now, lastSnippet: snippet, lastFrom: built.payload.from, messageCount: 1, unreadCount: 0,
        status: "open", createdAt: now,
      });
    }
    const messageId = await ctx.db.insert("mailMessages", {
      agencyId: scope.agencyId, threadId, mailboxId: box._id, direction: "out", from: built.payload.from, fromAddress: box.address,
      to, cc, subject: built.subject, text: built.text, html: built.html, snippet, inReplyTo,
      references: references.length ? references : undefined, sentAt: now, createdAt: now, read: true,
      attachments: [], sendStatus: "sending", sentBy: scope.actor,
    });
    await logEvent(ctx, scope.agencyId, scope.actor, "mail.send_requested", "ok", box.address);
    await ctx.scheduler.runAfter(0, internal.mail._deliver, { messageId });
    return { threadId, messageId };
  },
});

export const _outbound = internalQuery({
  args: { messageId: v.id("mailMessages") },
  handler: async (ctx, { messageId }) => {
    const m = await ctx.db.get(messageId);
    if (!m || m.direction !== "out" || !m.mailboxId) return null;
    const box = await ctx.db.get(m.mailboxId);
    if (!box) return null;
    return { m, box };
  },
});

export const _finish = internalMutation({
  args: {
    messageId: v.id("mailMessages"),
    status: v.union(v.literal("accepted"), v.literal("rejected"), v.literal("unknown")),
    providerId: v.optional(v.string()), error: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const m = await ctx.db.get(a.messageId);
    if (!m) return null;
    await ctx.db.patch(a.messageId, { sendStatus: a.status, providerId: a.providerId, sendError: redact(a.error) });
    await logEvent(ctx, m.agencyId, "system", "mail.submitted", a.status === "accepted" ? "ok" : a.status === "unknown" ? "unknown" : "denied", a.providerId ?? m.fromAddress, a.status);
    return null;
  },
});

/** One delivery attempt, exactly like outreachSend._deliver: an unclear outcome is
 *  "unknown" and never retried automatically. */
export const _deliver = internalAction({
  args: { messageId: v.id("mailMessages") },
  handler: async (ctx, { messageId }) => {
    const row = await ctx.runQuery(internal.mail._outbound, { messageId });
    if (!row || row.m.sendStatus !== "sending") return null;
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      await ctx.runMutation(internal.mail._finish, { messageId, status: "rejected", error: "No Resend key on the server" });
      return null;
    }
    const { m, box } = row;
    const body = payloadFromStored(box, {
      to: m.to, cc: m.cc, subject: m.subject, html: m.html ?? "", text: m.text ?? "", inReplyTo: m.inReplyTo, references: m.references,
    });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30_000);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: ctl.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `pulse-mail-${messageId}`, "User-Agent": "PulseMail/1.0" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (res.ok) {
        let id: string | undefined;
        try { id = (JSON.parse(text) as { id?: string }).id; } catch { /* accepted but unreadable */ }
        await ctx.runMutation(internal.mail._finish, { messageId, status: id ? "accepted" : "unknown", providerId: id, error: id ? undefined : "Accepted but no message id returned" });
      } else if (res.status >= 400 && res.status < 500) {
        await ctx.runMutation(internal.mail._finish, { messageId, status: "rejected", error: `HTTP ${res.status}: ${text.slice(0, 160)}` });
      } else {
        await ctx.runMutation(internal.mail._finish, { messageId, status: "unknown", error: `Provider error HTTP ${res.status}` });
      }
    } catch {
      await ctx.runMutation(internal.mail._finish, { messageId, status: "unknown", error: "No clear response from the provider" });
    } finally {
      clearTimeout(timer);
    }
    return null;
  },
});
