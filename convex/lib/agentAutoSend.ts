import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { orgHasFeature } from "./entitlements";
import { normalizePhone } from "./phone";
import { isSmsOptedOut } from "./smsOptOut";

/* ============================================================
   What the assistant may send without a person reading it first.

   The Max plan sells "Let simple reminders run themselves": plain
   reminders to the studio's own clients, switched on by the owner.
   So a proposal is auto-approved only when ALL of these hold, checked
   at the moment the run finishes (not when the switch was flipped):

     1. the studio's autonomy setting is "auto_trusted";
     2. the studio's plan includes aiAutonomy right now (a downgrade
        stops auto-send at once) and the operator has not switched it off;
     3. it is a send_email or send_sms;
     4. the model rated it low risk (a missing rating is medium);
     5. it names one of the reminder kinds below;
     6. the recipient is an existing client of THIS studio (not a lead)
        whose exact address or number was on file BEFORE the conversation
        the assistant read began (the run's message window). "On file"
        means staff entered it, or the client completed a booking made
        with it. A contact typed into a public form never counts by
        itself, however old it is, and one changed since waits too;
     7. for a text, the number has not replied STOP.

   Anything else waits in the approval inbox. Every check fails closed.
   ============================================================ */

/** The reminder kinds the price list means by "plain reminders". */
export const AUTO_REMINDER_KINDS = ["session_reminder", "balance_reminder", "files_ready"] as const;
export type AutoReminderKind = (typeof AUTO_REMINDER_KINDS)[number];

/** How many of a studio's clients we look through for a recipient match
 *  before giving up (and leaving the message for a person). Bounded so a
 *  run never reads an unbounded table; a miss only means "wait". */
export const CLIENT_SCAN_LIMIT = 3000;

/** When each address or number went on file. Stored on the client row
 *  (artists.contactOnFile) by the staff paths that write a contact, and by
 *  the completion of a booking made with it (stampCompletedBooking). Public
 *  forms (QR check-in, booking page, membership sign-up) never stamp: they
 *  write an empty object, which also keeps the row out of the legacy report. A stamp only
 *  counts while it still names the address on the row, so a write path that
 *  forgot to stamp fails closed (the contact looks new), never open. */
export type ContactOnFile = { email?: string; emailAt?: number; phone?: string; phoneAt?: number };

/** The stamp to store after a write that leaves the row with `next` contact
 *  details. An unchanged address keeps its old time; a new one starts now. */
export function stampContact(
  prev: ContactOnFile | undefined,
  next: { email?: string | null; phone?: string | null },
  now: number,
): ContactOnFile {
  const out: ContactOnFile = {};
  const e = normalizeEmail(next.email);
  if (e) { out.email = e; out.emailAt = prev?.email === e && prev.emailAt !== undefined ? prev.emailAt : now; }
  const p = next.phone ? normalizePhone(next.phone) : null;
  if (p) { out.phone = p; out.phoneAt = prev?.phone === p && prev.phoneAt !== undefined ? prev.phoneAt : now; }
  return out;
}

/** After a booking made with `booked` completes: the row's current email
 *  and phone that equal the booked ones go on file now, unless already on
 *  file (an older stamp is kept). Anything else on the row is left exactly as
 *  it was stamped, or unstamped. */
export function stampCompletedBooking(
  row: { email?: string; phone?: string; contactOnFile?: ContactOnFile },
  booked: { email?: string; phone?: string },
  now: number,
): ContactOnFile | null {
  const cur = contactSince(row);
  const out: ContactOnFile = { ...(row.contactOnFile ?? {}) };
  let changed = false;
  const bEmail = normalizeEmail(booked.email);
  if (cur.email && cur.email === bEmail && cur.emailAt === null) { out.email = cur.email; out.emailAt = now; changed = true; }
  const bPhone = booked.phone ? normalizePhone(booked.phone) : null;
  if (cur.phone && cur.phone === bPhone && cur.phoneAt === null) { out.phone = cur.phone; out.phoneAt = now; changed = true; }
  return changed ? out : null;
}

/** Called by every path that completes a session (sessions.applyStatus,
 *  automation.tick). Only a public booking carries `bookedContact`. */
export async function stampBookedContactOnCompletion(
  ctx: MutationCtx,
  s: { artistId: Id<"artists">; bookedContact?: { email?: string; phone?: string } },
) {
  if (!s.bookedContact) return;
  const a = await ctx.db.get(s.artistId);
  if (!a || a.erasedAt || a.catalogOnly) return;
  const next = stampCompletedBooking(a, s.bookedContact, Date.now());
  if (next) await ctx.db.patch(a._id, { contactOnFile: next });
}

/** Since when each current contact of this row has been on file, or null when
 *  that cannot be shown (no stamp, or the stamp names a different address). */
export function contactSince(a: { email?: string; phone?: string; contactOnFile?: ContactOnFile }) {
  const e = normalizeEmail(a.email);
  const p = a.phone ? normalizePhone(a.phone) : null;
  const s = a.contactOnFile;
  return {
    email: e, emailAt: e && s?.email === e && s.emailAt !== undefined ? s.emailAt : null,
    phone: p, phoneAt: p && s?.phone === p && s.phoneAt !== undefined ? s.phoneAt : null,
  };
}

/** One scan per run, shared by every proposal in it. Maps a contact to the
 *  time it went on file, or null when any client row holding it cannot show
 *  one (so a doubtful match never sends). */
export type ClientIndex = { emails: Map<string, number | null>; phones: Map<string, number | null>; complete: boolean };

function note(m: Map<string, number | null>, key: string, at: number | null) {
  if (!m.has(key)) { m.set(key, at); return; }
  const cur = m.get(key)!;
  m.set(key, cur === null || at === null ? null : Math.max(cur, at));
}

export async function loadClientIndex(ctx: QueryCtx | MutationCtx, orgId: string): Promise<ClientIndex> {
  const idx: ClientIndex = { emails: new Map(), phones: new Map(), complete: true };
  let seen = 0;
  for await (const a of ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId))) {
    if (++seen > CLIENT_SCAN_LIMIT) { idx.complete = false; break; }
    if (a.erasedAt || a.catalogOnly) continue;
    const c = contactSince(a);
    // A lead (anyone who typed details into a public form) is not a client:
    // its contact can never auto-send, and it poisons a shared address.
    const lead = a.status === "lead";
    if (c.email) note(idx.emails, c.email, lead ? null : c.emailAt);
    if (c.phone) note(idx.phones, c.phone, lead ? null : c.phoneAt);
  }
  return idx;
}

export function normalizeEmail(raw: string | undefined | null): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  if (!e || !e.includes("@") || /\s/.test(e)) return null;
  return e;
}

export type AutoSendInput = {
  autonomy: string | undefined;
  /** When the conversation the assistant read began: the start of the
   *  run's message window. The contact must be on file before this. */
  conversationStart: number;
  actionType: string;
  riskLevel: string;
  proposedPayload: unknown;
};

export type AutoSendDecision = { auto: true } | { auto: false; reason: string };

/** Was the recipient on file for one of this studio's (live, non-lead)
 *  clients before `before`? A studio past the scan limit only matches within
 *  what was read: a miss means "wait for a person", never "send". */
export function isClientIn(idx: ClientIndex, channel: "email" | "sms", to: string, before: number): boolean {
  const key = channel === "email" ? normalizeEmail(to) : normalizePhone(to);
  if (!key) return false;
  const at = (channel === "email" ? idx.emails : idx.phones).get(key);
  return typeof at === "number" && at < before;
}

export async function autoSendDecision(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  input: AutoSendInput,
  cache?: { clients?: ClientIndex },
): Promise<AutoSendDecision> {
  if (input.autonomy !== "auto_trusted") return { auto: false, reason: "autonomy is not auto_trusted" };
  if (input.actionType !== "send_email" && input.actionType !== "send_sms") return { auto: false, reason: "not a message" };
  if (input.riskLevel !== "low") return { auto: false, reason: "not low risk" };
  if (!(await orgHasFeature(ctx, orgId, "aiAutonomy"))) return { auto: false, reason: "plan does not include auto-send" };
  const p = (input.proposedPayload ?? {}) as { to?: unknown; reminderKind?: unknown };
  if (typeof p.reminderKind !== "string" || !(AUTO_REMINDER_KINDS as readonly string[]).includes(p.reminderKind)) {
    return { auto: false, reason: "not a named reminder" };
  }
  if (typeof p.to !== "string" || !p.to.trim()) return { auto: false, reason: "no recipient" };
  const channel = input.actionType === "send_email" ? "email" : "sms";
  const clients = cache?.clients ?? (await loadClientIndex(ctx, orgId));
  if (cache) cache.clients = clients;
  if (!Number.isFinite(input.conversationStart)) return { auto: false, reason: "no conversation start" };
  if (!isClientIn(clients, channel, p.to, input.conversationStart)) {
    return { auto: false, reason: "recipient was not on file for a client of this studio before the conversation" };
  }
  if (channel === "sms" && (await isSmsOptedOut(ctx, p.to))) return { auto: false, reason: "number replied STOP" };
  return { auto: true };
}
