import type { QueryCtx, MutationCtx } from "../_generated/server";
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
     6. the recipient is an existing client of THIS studio;
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

/** One scan per run, shared by every proposal in it. */
export type ClientIndex = { emails: Set<string>; phones: Set<string>; complete: boolean };

export async function loadClientIndex(ctx: QueryCtx | MutationCtx, orgId: string): Promise<ClientIndex> {
  const idx: ClientIndex = { emails: new Set(), phones: new Set(), complete: true };
  let seen = 0;
  for await (const a of ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId))) {
    if (++seen > CLIENT_SCAN_LIMIT) { idx.complete = false; break; }
    if (a.erasedAt || a.catalogOnly) continue;
    const e = normalizeEmail(a.email);
    if (e) idx.emails.add(e);
    const p = a.phone ? normalizePhone(a.phone) : null;
    if (p) idx.phones.add(p);
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
  actionType: string;
  riskLevel: string;
  proposedPayload: unknown;
};

export type AutoSendDecision = { auto: true } | { auto: false; reason: string };

/** Does the recipient belong to one of this studio's (live) clients? A
 *  studio past the scan limit only matches within what was read: a miss
 *  means "wait for a person", never "send". */
export function isClientIn(idx: ClientIndex, channel: "email" | "sms", to: string): boolean {
  if (channel === "email") {
    const e = normalizeEmail(to);
    return !!e && idx.emails.has(e);
  }
  const p = normalizePhone(to);
  return !!p && idx.phones.has(p);
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
  if (!isClientIn(clients, channel, p.to)) return { auto: false, reason: "recipient is not a client of this studio" };
  if (channel === "sms" && (await isSmsOptedOut(ctx, p.to))) return { auto: false, reason: "number replied STOP" };
  return { auto: true };
}
