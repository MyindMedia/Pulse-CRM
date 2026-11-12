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
export const CLIENT_SCAN_LIMIT = 5000;

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

/** Does the recipient belong to one of this studio's (live) clients? */
export async function isClientOfOrg(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  channel: "email" | "sms",
  to: string,
): Promise<boolean> {
  const wantEmail = channel === "email" ? normalizeEmail(to) : null;
  const wantPhone = channel === "sms" ? normalizePhone(to) : null;
  if (!wantEmail && !wantPhone) return false;
  let seen = 0;
  for await (const a of ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId))) {
    if (++seen > CLIENT_SCAN_LIMIT) return false;
    if (a.erasedAt || a.catalogOnly) continue;
    if (wantEmail && normalizeEmail(a.email) === wantEmail) return true;
    if (wantPhone && a.phone && normalizePhone(a.phone) === wantPhone) return true;
  }
  return false;
}

export async function autoSendDecision(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  input: AutoSendInput,
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
  if (!(await isClientOfOrg(ctx, orgId, channel, p.to))) return { auto: false, reason: "recipient is not a client of this studio" };
  if (channel === "sms" && (await isSmsOptedOut(ctx, p.to))) return { auto: false, reason: "number replied STOP" };
  return { auto: true };
}
