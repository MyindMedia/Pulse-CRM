/* ============================================================
   Jev (TypeSafe System One) safety check on agent-drafted messages. Pure:
   no SDK, no I/O, so the exact questions, the state Jev sees and the badge
   thresholds are unit-testable, and the same objects go to Jev from every
   caller (convex/jevDraftCheck.ts).
   Docs: https://docs.typesafe.ai/primitives/noul.md and
   https://docs.typesafe.ai/cookbooks/llm_guardrails.md

   A label for the owner, never a gate. Nothing reads these numbers to send,
   approve, or change an approval rule: the approval inbox shows a badge and
   the owner still decides every message.
   ============================================================ */
import type { NoulQuestion } from "@typesafe-ai/sdk";

/** One yes/no per judgment, combined in code (draftCheckBadge), as the Noul
 *  docs advise. Each value is the probability the answer is yes. */
export const DRAFT_CHECK_QUESTIONS = {
  safeToSend: {
    type: "noul",
    instructions: "Is this message ready to send to the recipient without the owner reviewing it?",
    criteria: {
      true: "It is accurate, polite, on-topic, and makes no new promises.",
      false:
        "It promises money, refunds, discounts or dates not already agreed, sounds rude or off, contains placeholders like [Name] or TODO, or mentions sensitive personal or legal matters.",
    },
  },
  mentionsMoney: {
    type: "noul",
    instructions: "Does the message mention amounts, refunds, discounts, prices or payment terms?",
  },
  hasPlaceholder: {
    type: "noul",
    instructions: "Does the message contain unfilled placeholders such as [Name], {{...}}, TODO or XXX?",
  },
} satisfies Record<string, NoulQuestion>;

/** What each agent's email is for, in words Jev can judge "on-topic" against. */
const ACTION_TYPE_LABEL: Record<string, string> = {
  convert_lead: "reply to a new booking inquiry",
  reengage_quiet_artist: "check-in with a client who has not booked in a while",
  payment_reminder: "reminder about a past-due invoice",
  deposit_unpaid_nudge: "nudge to pay the deposit that holds a booking",
  post_session_recap: "recap after a recording session",
  no_show_risk: "request to confirm an upcoming session",
  waitlist_fill: "offer of an open session slot to a client on the waitlist",
};

export function actionTypeLabel(actionType: string): string {
  return ACTION_TYPE_LABEL[actionType] ?? actionType.replace(/_/g, " ");
}

/** Who reads the message. Every email the agents draft today goes to the
 *  studio's own client or lead; an email type written to anyone else (a
 *  vendor, an engineer) names its role here. */
export function recipientRoleFor(actionType: string): string {
  return actionType === "convert_lead" ? "prospective client (a new lead)" : "client";
}

/** The state Jev evaluates: the draft's subject and body as data, plus its
 *  channel, the recipient's role and the action type. Nothing else: no
 *  address, no studio records, and never any bank data. */
export function draftCheckState(draft: { actionType: string; subject: string; body: string }) {
  return {
    channel: "email from a recording studio",
    recipientRole: recipientRoleFor(draft.actionType),
    actionType: actionTypeLabel(draft.actionType),
    message: { subject: draft.subject, body: draft.body },
  };
}

/** Jev's three probabilities as stored on an opsActions row (draftCheck). */
export type DraftCheckScores = { safeToSend: number; mentionsMoney: number; hasPlaceholder: number };

/** Starting thresholds; the stored probabilities are what tunes them. */
export const DRAFT_BADGE_THRESHOLDS = {
  readySafeToSend: 0.85,
  readyMaxPlaceholder: 0.3,
  money: 0.7,
  placeholder: 0.5,
} as const;

export type DraftBadgeKind = "placeholder" | "money" | "ready" | "review";

/** The approval-inbox badge for one draft, or null when Jev has not checked
 *  it (no key, Jev down, not an email): then the card looks as it always has.
 *  A warning outranks "Looks ready": an unfilled placeholder first, then money
 *  (Jev never sees the invoice or the price list, so every amount or payment
 *  term is the owner's to confirm). */
export function draftCheckBadge(
  check: DraftCheckScores | null | undefined,
): { kind: DraftBadgeKind; label: string } | null {
  if (!check) return null;
  const t = DRAFT_BADGE_THRESHOLDS;
  if (check.hasPlaceholder >= t.placeholder) return { kind: "placeholder", label: "Has placeholders" };
  if (check.mentionsMoney >= t.money) return { kind: "money", label: "Check money details" };
  if (check.safeToSend >= t.readySafeToSend && check.hasPlaceholder < t.readyMaxPlaceholder) {
    return { kind: "ready", label: "Looks ready" };
  }
  return { kind: "review", label: "Review" };
}
