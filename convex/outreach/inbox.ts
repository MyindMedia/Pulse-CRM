import type { Id } from "../_generated/dataModel";

/* The Outreach inbox (Prospects tab): pure rules shared by the server queries
   in convex/outreachInbox.ts and the browser. No database, no network, and no
   import that would pull server code into the client bundle. */

export const INBOX_FILTERS = ["all", "needs_action", "replied", "booked", "opted_out"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export const FILTER_LABEL: Record<InboxFilter, string> = {
  all: "All",
  needs_action: "Needs action",
  replied: "Replied",
  booked: "Booked",
  opted_out: "Opted out",
};

/** What the row's preview line shows. */
export type LastKind =
  | "email"      // an outreach email Pulse sent (subject only)
  | "mail"       // a message in a matched mail thread (snippet)
  | "dm"         // an Instagram DM approved or marked sent
  | "reply"      // the studio replied, but the viewer cannot read mail (or none is stored)
  | "status";    // nothing sent or received yet: the status explains what comes next

export type InboxRow = {
  id: Id<"outreachProspects">;
  name: string;
  handle: string | null;
  host: string | null;
  websiteUrl: string | null;
  primaryEmail: string | null;
  emails: string[];
  status: string;
  note: string | null;
  createdAt: number;
  lastActivityAt: number;
  lastKind: LastKind;
  lastDirection: "in" | "out" | null;
  lastSnippet: string | null;
  hasUnreadReply: boolean;
  replied: boolean;
  replyIntent: { label: string; optedOut: boolean } | null;
  bookedAt: number | null;
  optedOut: boolean;
  routingConfirmed: boolean;
  sequence: { step: number; status: "active" | "stopped" | "done" } | null;
};

/** The address part of a URL ("https://www.mix.com/la" -> "mix.com"). */
export function hostName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The name a person reads: the studio name, else its handle, else its website. */
export function displayName(p: { name?: string | null; handle?: string | null; websiteUrl?: string | null }): string {
  const name = p.name?.trim();
  if (name) return name;
  if (p.handle?.trim()) return `@${p.handle.trim()}`;
  if (p.websiteUrl?.trim()) return hostName(p.websiteUrl.trim());
  return "Unnamed studio";
}

/** Two letters for the avatar: "Ice Cream Sound" -> "IC", "@mixstudio" -> "MI", "unionsound.com" -> "UN". */
export function initialsOf(name: string): string {
  const words = name
    .replace(/^@/, "")
    .replace(/\.[a-z]{2,}(\/.*)?$/i, "")
    .split(/[\s._-]+/)
    .map((w) => w.replace(/[^A-Za-z0-9À-ɏ]/g, ""))
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Statuses where the next step is the owner's to take. */
const ACTION_STATUSES = new Set(["needs_website", "ready_to_scrape", "scraped", "unreachable"]);

/** True when the owner has something to do for this studio: read or answer a
 *  reply, confirm a website, read the site, queue it, or prepare and send the
 *  first email. Opted-out studios never need action. */
export function needsAction(r: Pick<InboxRow, "optedOut" | "hasUnreadReply" | "lastDirection" | "status" | "sequence">): boolean {
  if (r.optedOut) return false;
  if (r.hasUnreadReply || r.lastDirection === "in") return true;
  if (ACTION_STATUSES.has(r.status)) return true;
  return r.status === "queued" && r.sequence === null;
}

export function matchesFilter(r: InboxRow, f: InboxFilter): boolean {
  switch (f) {
    case "all": return true;
    case "needs_action": return needsAction(r);
    case "replied": return r.replied;
    case "booked": return r.bookedAt !== null;
    case "opted_out": return r.optedOut;
  }
}

/** Case-insensitive match on name, handle, website and published addresses. */
export function matchesSearch(r: Pick<InboxRow, "name" | "handle" | "host" | "emails">, q: string): boolean {
  const needle = q.trim().toLowerCase().replace(/^@/, "");
  if (!needle) return true;
  return [r.name, r.handle ?? "", r.host ?? "", ...r.emails].some((s) => s.toLowerCase().includes(needle));
}

/** One candidate for "latest activity". Messages outrank a bare status. */
export type Activity = { at: number; kind: LastKind; direction: "in" | "out" | null; snippet: string | null };

/** The newest message, or, when nothing was ever sent or received, the
 *  status at the time the studio was added (so working through the list does
 *  not reshuffle it under the cursor). Ties go to the received message. */
export function latestActivity(messages: readonly Activity[], createdAt: number): Activity {
  let best: Activity | null = null;
  for (const a of messages) {
    if (!best || a.at > best.at || (a.at === best.at && a.direction === "in" && best.direction !== "in")) best = a;
  }
  return best ?? { at: createdAt, kind: "status", direction: null, snippet: null };
}

/** A body collapsed to one line, for a preview. */
export function previewLine(text: string | null | undefined, max = 160): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/* ------------------------------ the timeline ------------------------------ */

type Base = { id: string; at: number; direction: "in" | "out" | null };

export type MailAttachmentView = {
  index: number; filename: string; contentType: string; size: number | null; inline: boolean;
  status: "pending" | "stored" | "skipped" | "failed"; note: string | null;
};

/** An email, sent or received. `source` says where it came from:
 *  outreach = a draft Pulse sent (Review queue), mail = a stored message in a
 *  matched Email-tab thread, log = a send recorded without a draft. */
export type EmailItem = Base & {
  kind: "email";
  source: "outreach" | "mail" | "log";
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  snippet: string;
  text: string | null;
  html: string | null;
  htmlTruncated: boolean;
  /** The body was left out to keep the result small (older than the newest
   *  messages that fit). It is still in the Email tab. */
  bodyOmitted: boolean;
  bodyPending: boolean;
  label: string | null;
  draftId: Id<"outreachDrafts"> | null;
  messageId: Id<"mailMessages"> | null;
  threadId: Id<"mailThreads"> | null;
  unread: boolean;
  /** Outbound only: what the provider said (outreach) or the send state (mail). */
  delivery: { status: string; meaning: string; error: string | null } | null;
  /** Jev's label, on the reply it read. */
  intent: { label: string; probability: number | null; optedOut: boolean } | null;
  attachments: MailAttachmentView[];
  authFailed: boolean;
};

/** A prepared email that has not gone out: it waits in the Review queue. */
export type DraftItem = Base & {
  kind: "draft";
  draftId: Id<"outreachDrafts">;
  status: "draft" | "hold" | "approved" | "expired";
  holdReason: string | null;
  label: string;
  from: string;
  to: string[];
  subject: string;
  snippet: string;
  text: string;
};

export type DmItem = Base & { kind: "dm"; status: "approved" | "sent"; handle: string; text: string; snippet: string };

export type BookingItem = Base & {
  kind: "booking";
  status: string;
  title: string;
  startsAt: number;
  endsAt: number;
  timezone: string | null;
  location: string | null;
  meetingUrl: string | null;
  contactName: string | null;
  contactEmail: string | null;
};

export type CallItem = Base & {
  kind: "call";
  status: string;
  skipReason: string | null;
  summary: string | null;
  disposition: string | null;
  error: string | null;
  answeredBy: string | null;
};

export type EventItem = Base & { kind: "event"; text: string };

export type TimelineItem = EmailItem | DraftItem | DmItem | BookingItem | CallItem | EventItem;

/** Same instant: the event that explains a message reads before it. */
const KIND_ORDER: Record<TimelineItem["kind"], number> = { event: 0, booking: 1, call: 2, dm: 3, email: 4, draft: 5 };

/** Oldest first, newest last (the newest opens by default), at most `max`
 *  items, keeping the newest. Duplicate ids keep their first occurrence. */
export function mergeTimeline(items: readonly TimelineItem[], max = 150): { items: TimelineItem[]; truncated: boolean } {
  const seen = new Set<string>();
  const unique = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  const sorted = unique.sort((a, b) => a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id));
  return sorted.length > max ? { items: sorted.slice(sorted.length - max), truncated: true } : { items: sorted, truncated: false };
}

/** What opens when a conversation is shown: the newest message; the newest
 *  email too when the newest message is a draft still waiting, so the last real
 *  exchange is readable; and every received message that is unread. */
export function defaultOpen(items: readonly TimelineItem[]): Set<string> {
  const open = new Set<string>();
  const latest = latestOpenable(items);
  if (latest) open.add(latest);
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "email") {
      open.add(items[i].id);
      break;
    }
  }
  for (const it of items) if (it.kind === "email" && it.unread) open.add(it.id);
  return open;
}

/** The item a reader should see open: the newest message, else the newest item. */
export function latestOpenable(items: readonly TimelineItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const k = items[i].kind;
    if (k === "email" || k === "draft" || k === "dm") return items[i].id;
  }
  return items.length ? items[items.length - 1].id : null;
}
