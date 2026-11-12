/* Pure Inbox logic, unit tested in inbox-logic.test.ts: list filters and query,
   thread ordering and labeling, email HTML to plain text, safe media links, which
   channels a lead can receive, schedule time checks, and the composer draft with
   its idempotency key. No React, no Convex. */

import type { ConfirmGrant } from "./crm-ui";
import type { Lead } from "./zu-types";
import { INBOX_OP } from "./inbox-ops";
import type { Channel, Conversation, ConversationCounts, ThreadEvent } from "./inbox-types";

/* ---------- list filters ---------- */

export type InboxFilter = "inbox" | "unread" | "unassigned" | "scheduled" | "suggested" | "archived";

export const INBOX_FILTERS: ReadonlyArray<{ id: InboxFilter; label: string }> = [
  { id: "inbox", label: "Inbox" },
  { id: "unread", label: "Unread" },
  { id: "unassigned", label: "Unassigned" },
  { id: "scheduled", label: "Scheduled" },
  { id: "suggested", label: "AI suggested" },
  { id: "archived", label: "Archived" },
];

export const CONVERSATION_PAGE = 25;

/** The search sent to Zuops: trimmed, and only when 2 to 80 characters. */
export function searchTerm(raw: string): string | undefined {
  const t = raw.trim();
  return t.length >= 2 && t.length <= 80 ? t : undefined;
}

/** Query for GET /v1/conversations. Scheduled and AI suggested read other lists. */
export function conversationsQuery(
  filter: InboxFilter,
  search: string,
  cursor?: string | null,
): Record<string, string | number | boolean | undefined> {
  return {
    limit: CONVERSATION_PAGE,
    archived: filter === "archived" ? true : undefined,
    unread: filter === "unread" ? true : undefined,
    assigned_to: filter === "unassigned" ? "unassigned" : undefined,
    search: searchTerm(search),
    cursor: cursor || undefined,
  };
}

/** The count shown next to a filter, or null when Zuops gives none. */
export function filterCount(
  filter: InboxFilter,
  counts: ConversationCounts | null | undefined,
  scheduled: { n: number; more: boolean } | null,
  suggested: { n: number; more: boolean } | null,
): string | null {
  const num = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? String(n) : null);
  const listed = (x: { n: number; more: boolean } | null) => (x ? `${x.n}${x.more ? "+" : ""}` : null);
  switch (filter) {
    case "inbox": return num(counts?.open);
    case "unread": return num(counts?.unread);
    case "archived": return num(counts?.archived);
    case "scheduled": return listed(scheduled);
    case "suggested": return listed(suggested);
    default: return null;
  }
}

/** Page one wins: later pages only add conversations it does not already hold. */
export function mergeConversations(first: Conversation[], more: Conversation[]): Conversation[] {
  const seen = new Set(first.map((c) => c.lead_id));
  const out = [...first];
  for (const c of more) {
    if (seen.has(c.lead_id)) continue;
    seen.add(c.lead_id);
    out.push(c);
  }
  return out;
}

/* ---------- channels and labels ---------- */

export function channelWord(ch: string | null | undefined): string {
  switch (ch) {
    case "sms": case "text": return "Text";
    case "email": return "Email";
    case "instagram": return "Instagram";
    case "messenger": return "Messenger";
    case "chat": case "webchat": case "site_widget": case "widget": return "Website chat";
    case "call": return "Call";
    case "voicemail": return "Voicemail";
    case "note": return "Note";
    default: return ch ? ch[0].toUpperCase() + ch.slice(1).replace(/_/g, " ") : "Message";
  }
}

export type EventKind = "sms" | "email" | "instagram" | "messenger" | "chat" | "call" | "voicemail" | "note" | "other";
export type Direction = "inbound" | "outbound" | "internal";

/** What a conversation event is, from its event_type (e.g. "instagram_inbound",
 *  "sms_outbound", "note", "call_completed"). Unknown types read as activity. */
export function classifyEvent(ev: Pick<ThreadEvent, "event_type" | "metadata">): { kind: EventKind; direction: Direction; word: string } {
  const t = (ev.event_type ?? "").toLowerCase();
  const meta = ev.metadata ?? {};
  const kind: EventKind =
    t.includes("instagram") ? "instagram"
      : t.includes("messenger") || t.includes("facebook") ? "messenger"
        : t.includes("email") ? "email"
          : t.includes("voicemail") ? "voicemail"
            : t.includes("call") ? "call"
              : t.includes("chat") || t.includes("widget") ? "chat"
                : t.includes("note") ? "note"
                  : t.includes("sms") || t.includes("mms") || t.includes("text") || t.includes("imessage") ? "sms"
                    : "other";
  const metaDir = typeof meta.direction === "string" ? meta.direction.toLowerCase() : "";
  let direction: Direction = "internal";
  if (kind !== "note" && kind !== "other") {
    if (/inbound|_in$|received|missed/.test(t) || metaDir === "inbound") direction = "inbound";
    else if (/outbound|_out$|sent/.test(t) || metaDir === "outbound") direction = "outbound";
    else if (kind === "voicemail") direction = "inbound";
    else direction = "internal";
  }
  const word = kind === "other" ? channelWord(t || "activity") : channelWord(kind);
  return { kind, direction, word };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Email HTML to plain text. Nothing is ever injected as HTML: scripts, styles and
 *  tags are dropped, block ends become line breaks, entities are decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|title)[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
      const c = code.toLowerCase();
      if (c.startsWith("#x")) return safeChar(parseInt(c.slice(2), 16)) ?? m;
      if (c.startsWith("#")) return safeChar(parseInt(c.slice(1), 10)) ?? m;
      return ENTITIES[c] ?? m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeChar(n: number): string | null {
  return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : null;
}

export type MediaLink = { url: string; label: string };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** http(s) links only; anything else (javascript:, data:) is dropped. */
export function safeUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Attachments, MMS pictures and recordings of one event, as links. */
export function mediaLinks(meta: Record<string, unknown> | null | undefined, extra?: unknown[] | null): MediaLink[] {
  const out: MediaLink[] = [];
  const seen = new Set<string>();
  const add = (url: string | null, kind?: unknown) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    const k = str(kind)?.replace(/_/g, " ");
    out.push({ url, label: k ? `Attachment (${k})` : "Attachment" });
  };
  const m = meta ?? {};
  if (Array.isArray(m.attachments)) {
    for (const a of m.attachments) {
      if (typeof a === "string") add(safeUrl(a));
      else if (a && typeof a === "object") add(safeUrl((a as Record<string, unknown>).url), (a as Record<string, unknown>).type);
    }
  }
  for (const list of [m.media_urls, extra]) if (Array.isArray(list)) for (const u of list) add(safeUrl(u));
  for (const key of ["recording_url", "voicemail_url"]) {
    const url = safeUrl(m[key]);
    if (url && !seen.has(url)) { seen.add(url); out.push({ url, label: "Recording" }); }
  }
  return out;
}

export type ThreadItem = {
  id: string;
  kind: EventKind;
  direction: Direction;
  word: string;
  /** "Text · Lawrence", "Instagram · Maya Okafor", "Note · Sam". */
  label: string;
  text: string;
  subject: string | null;
  media: MediaLink[];
  at: string | null;
  ms: number;
};

/** The thread oldest first (Zuops answers newest first), each event labeled. */
export function threadItems(events: ThreadEvent[] | null | undefined): ThreadItem[] {
  return (events ?? [])
    .map((ev, i) => {
      const { kind, direction, word } = classifyEvent(ev);
      const meta = ev.metadata ?? {};
      const html = str(meta.html) ?? str(meta.body_html);
      const text = str(ev.body) ?? str(meta.text) ?? (html ? htmlToText(html) : null) ?? str(meta.summary) ?? "";
      const plain = /<[a-z][\s\S]*>/i.test(text) && kind === "email" ? htmlToText(text) : text;
      const who = str(ev.actor_label);
      const ms = ev.created_at ? Date.parse(ev.created_at) : NaN;
      const item: ThreadItem = {
        id: ev.id ?? `ev-${i}`,
        kind, direction, word,
        label: [word, direction === "inbound" ? "Received" : direction === "outbound" ? "Sent" : null, who].filter(Boolean).join(" · "),
        text: plain,
        subject: str(meta.subject),
        media: mediaLinks(meta),
        at: ev.created_at ?? null,
        ms: Number.isFinite(ms) ? ms : 0,
      };
      return { item, order: i };
    })
    // Oldest first; equal times keep the reverse of Zuops's newest-first order.
    .sort((a, b) => a.item.ms - b.item.ms || b.order - a.order)
    .map((x) => x.item);
}

/* ---------- what the lead can receive ---------- */

export type ChannelOption = { channel: Channel; label: string; available: boolean; reason: string | null };

export const SOCIAL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Shown under the Text composer and in the Text confirm dialog (F-U2). */
export const TEXT_OPT_OUT_NOTE = "Pulse cannot see text opt-outs. Zuops blocks a text to anyone who replied STOP or is marked do not contact.";

function flag(lead: Lead | null | undefined, ...keys: string[]): boolean {
  const rec = (lead ?? {}) as Record<string, unknown>;
  return keys.some((k) => rec[k] === true);
}

/** When the 24 hour Instagram or Messenger reply window ends, from the person's
 *  last message there; null when they never wrote on that channel. */
export function socialWindowEnds(items: ThreadItem[], channel: "instagram" | "messenger"): number | null {
  let last = 0;
  for (const it of items) if (it.kind === channel && it.direction === "inbound" && it.ms > last) last = it.ms;
  return last ? last + SOCIAL_WINDOW_MS : null;
}

/** Text needs a phone Zuops has not marked invalid; email needs an address that
 *  is not opted out, invalid or paused (eval X-05). A Zuops lead has no text
 *  opt-out or do-not-contact field, so Pulse cannot see those: Zuops itself
 *  refuses a text to anyone who replied STOP (see TEXT_OPT_OUT_NOTE). Instagram
 *  and Messenger show only when the person wrote there, and only inside the 24
 *  hour reply window. */
export function channelOptions(
  lead: Lead | null | undefined,
  conversationChannel: string | null | undefined,
  items: ThreadItem[],
  now: number,
): ChannelOption[] {
  const sms: ChannelOption = { channel: "sms", label: "Text", available: false, reason: null };
  if (!lead?.phone) sms.reason = "No phone number on this lead.";
  else if (lead.phone_invalid) sms.reason = "Zuops marked this phone number invalid.";
  else sms.available = true;

  const email: ChannelOption = { channel: "email", label: "Email", available: false, reason: null };
  if (!lead?.email) email.reason = "No email address on this lead.";
  else if (lead.email_opt_out) email.reason = "This lead opted out of email.";
  else if (lead.email_invalid) email.reason = "Zuops marked this email address invalid.";
  else if (flag(lead, "email_paused")) email.reason = "Email to this lead is paused in Zuops.";
  else email.available = true;

  const out = [sms, email];
  for (const ch of ["instagram", "messenger"] as const) {
    const wrote = conversationChannel === ch || items.some((it) => it.kind === ch);
    if (!wrote) continue;
    const ends = socialWindowEnds(items, ch);
    const label = ch === "instagram" ? "Instagram" : "Messenger";
    const opt: ChannelOption = { channel: ch, label, available: false, reason: null };
    if (ends === null) opt.reason = `${label} replies only go to someone who wrote to you there.`;
    else if (ends <= now) opt.reason = `The 24 hour reply window closed. ${label} only allows a reply within 24 hours of the person's last message.`;
    else opt.available = true;
    out.push(opt);
  }
  return out;
}

/** The channel the composer starts on: the conversation's own when it can be
 *  used, else the first one that can. */
export function defaultChannel(options: ChannelOption[], conversationChannel: string | null | undefined): Channel {
  const own = options.find((o) => o.channel === conversationChannel && o.available);
  return (own ?? options.find((o) => o.available) ?? options[0]).channel;
}

/* ---------- schedule ---------- */

export const MAX_SCHEDULE_DAYS = 365;

/** A datetime-local value ("2026-11-13T09:00", the browser's time) to an ISO time,
 *  or why it cannot be used: it must be in the future and at most 365 days ahead. */
export function validateSchedule(local: string, now: number): { ok: true; iso: string; ms: number } | { ok: false; reason: string } {
  if (!local) return { ok: false, reason: "Pick a date and time." };
  const ms = new Date(local).getTime();
  if (!Number.isFinite(ms)) return { ok: false, reason: "That date and time could not be read." };
  if (ms <= now + 60_000) return { ok: false, reason: "Pick a time in the future." };
  if (ms > now + MAX_SCHEDULE_DAYS * 86_400_000) return { ok: false, reason: "Pick a time within the next 365 days." };
  return { ok: true, iso: new Date(ms).toISOString(), ms };
}

/** A Date as a datetime-local value in the browser's time. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------- composer draft ---------- */

export type ComposerDraft = {
  channel: Channel;
  text: string;
  subject: string;
  /** datetime-local value; "" sends now. */
  sendAt: string;
  /** Set when "Edit first" loaded an AI suggestion: sending approves it, edited. */
  suggestionId: string | null;
  /** One Idempotency-Key per composed message (eval X-02). */
  idem: string;
};

export function emptyDraft(channel: Channel, makeIdem: () => string): ComposerDraft {
  return { channel, text: "", subject: "", sendAt: "", suggestionId: null, idem: makeIdem() };
}

/** Apply an edit. The key stays while only retrying; it changes when what would be
 *  sent changes (text, subject, channel, time), because Zuops answers 409 to the
 *  same key with a different body. */
export function applyDraftChange(draft: ComposerDraft, patch: Partial<Omit<ComposerDraft, "idem">>, makeIdem: () => string): ComposerDraft {
  const next = { ...draft, ...patch };
  const changed = next.text !== draft.text || next.subject !== draft.subject || next.channel !== draft.channel
    || next.sendAt !== draft.sendAt || next.suggestionId !== draft.suggestionId;
  return changed ? { ...next, idem: makeIdem() } : draft;
}

export const CHANNEL_MAX: Record<Channel, number> = { sms: 1600, email: 5000, instagram: 1000, messenger: 2000 };

/** Why the draft cannot go yet, or null when it can. */
export function draftProblem(draft: ComposerDraft, option: ChannelOption | undefined, now: number): string | null {
  if (!option) return "Pick a channel.";
  if (!option.available) return option.reason ?? "This channel is not available for this lead.";
  if (!draft.text.trim()) return "Write a message first.";
  if (draft.text.length > CHANNEL_MAX[draft.channel]) return `${option.label} messages can be at most ${CHANNEL_MAX[draft.channel].toLocaleString("en-US")} characters.`;
  if (draft.channel === "email" && !draft.suggestionId && !draft.subject.trim()) return "An email needs a subject.";
  if (draft.sendAt) {
    if (draft.channel === "instagram" || draft.channel === "messenger") return "Instagram and Messenger replies go out now. They cannot be scheduled.";
    if (draft.suggestionId) return "An AI suggestion is sent now. Clear the time to send it.";
    const s = validateSchedule(draft.sendAt, now);
    if (!s.ok) return s.reason;
  }
  return null;
}

export type SendRequest = {
  op: string;
  args: { path?: Record<string, string>; body: Record<string, unknown>; idem: string } & ConfirmGrant;
};

export const SCHEDULE_PASSED = "That time has passed. Pick a new time.";

/** Thrown by sendRequest when a scheduled draft's time no longer validates. */
export class ScheduleExpiredError extends Error {
  constructor(readonly detail: string) {
    super(SCHEDULE_PASSED);
    this.name = "ScheduleExpiredError";
  }
}

/** The write for a confirmed send. It needs the grant ConfirmDialog hands to its
 *  onConfirm, so a send cannot be built anywhere else. */
export function sendRequest(draft: ComposerDraft, leadId: string, grant: ConfirmGrant, now: number): SendRequest {
  if (grant?.confirm !== true) throw new Error("A send needs a confirm grant.");
  const text = draft.text.trim();
  if (draft.suggestionId) {
    if (draft.sendAt) throw new ScheduleExpiredError("An AI suggestion is sent now. Clear the time to send it.");
    return { op: INBOX_OP.approveSuggestion, args: { path: { suggestion_id: draft.suggestionId }, body: { body: text }, idem: draft.idem, ...grant } };
  }
  const body: Record<string, unknown> = { lead_id: leadId, channel: draft.channel, body: text };
  if (draft.channel === "email") body.subject = draft.subject.trim();
  if (draft.sendAt) {
    // A scheduled draft never becomes an immediate send (F-U1): a time that no
    // longer validates refuses the whole send instead of dropping send_at.
    const s = validateSchedule(draft.sendAt, now);
    if (!s.ok) throw new ScheduleExpiredError(s.reason);
    body.send_at = s.iso;
  }
  return { op: INBOX_OP.send, args: { body, idem: draft.idem, ...grant } };
}

/* ---------- small display helpers ---------- */

export function conversationName(c: Pick<Conversation, "name" | "email" | "phone">): string {
  return c.name || c.email || c.phone || "Unnamed lead";
}

export function previewText(c: Conversation): string {
  const m = c.last_message;
  if (!m) return "No messages yet";
  const raw = m.body || m.subject || "";
  const text = /<[a-z][\s\S]*>/i.test(raw) ? htmlToText(raw) : raw;
  const prefix = m.direction === "outbound" ? "You: " : "";
  return text ? `${prefix}${text.replace(/\s+/g, " ").trim()}` : `${channelWord(m.channel)} ${m.direction === "outbound" ? "sent" : "received"}`;
}

/** Remaining contact slots: the newest write answer wins over the limits read. */
export function contactSlots(
  read: { daily_unique_contact_cap?: number | null; unique_contacts_remaining?: number | null } | null | undefined,
  fromWrite: { contactsLimit?: number; contactsRemaining?: number } | null,
): { remaining: number; cap: number | null } | null {
  if (fromWrite && typeof fromWrite.contactsRemaining === "number") {
    return { remaining: fromWrite.contactsRemaining, cap: fromWrite.contactsLimit ?? read?.daily_unique_contact_cap ?? null };
  }
  if (read && typeof read.unique_contacts_remaining === "number") {
    return { remaining: read.unique_contacts_remaining, cap: read.daily_unique_contact_cap ?? null };
  }
  return null;
}
