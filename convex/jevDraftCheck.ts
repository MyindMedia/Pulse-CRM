import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { askJev, jevEnabled } from "./lib/jevClient";
import { DRAFT_CHECK_QUESTIONS, draftCheckState } from "./lib/jev/draftCheck";
import { isAccountingType } from "./lib/agentScope";

/* ============================================================
   Jev (TypeSafe System One) safety check on agent-drafted messages.

   Every email an agent drafts for the owner's approval (an opsActions row
   with an email payload) gets three yes/no reads from Jev: ready to send as
   written, mentions money, has an unfilled placeholder. The probabilities
   and the model are stored on the row (draftCheck) and the approval inbox
   turns them into a badge (lib/jev/draftCheck.ts, draftCheckBadge).

   A label only. Nothing here sends, approves, snoozes or changes an approval
   rule; the owner still decides every message. When Jev is unavailable (no
   TYPESAFE_API_KEY, a timeout, an API error) nothing is written and the
   inbox looks exactly as it did before.

   Scheduled by opsBrain.upsertProposed for drafts no model rewrites, and by
   aiActions.enrichOpsActions for drafts Claude rewrites, once the wording is
   final. Privacy: Jev sees only the text the recipient would read, plus its
   channel, the recipient's role and the action type. Accounting items are
   never sent: they carry no outbound message.
   ============================================================ */

/** A draft is checked only while it waits for the owner. */
const AWAITING_OWNER = new Set(["proposed", "snoozed"]);

/** Drafts asked about at once. */
const BATCH = 5;

/** The words Jev may read for one action: an email draft still waiting for
 *  the owner. Null for anything else (decided, not an email, accounting). */
export const _draft = internalQuery({
  args: { id: v.id("opsActions") },
  handler: async (ctx, { id }): Promise<{ actionType: string; subject: string; body: string } | null> => {
    const a = await ctx.db.get(id);
    if (!a || !AWAITING_OWNER.has(a.status) || isAccountingType(a.type)) return null;
    if (a.payload.kind !== "email" || !a.payload.body.trim()) return null;
    return { actionType: a.type, subject: a.payload.subject, body: a.payload.body };
  },
});

/** Store Jev's read, only while the draft still waits for the owner and still
 *  says exactly what Jev read: a label never describes other words. */
export const _record = internalMutation({
  args: {
    id: v.id("opsActions"),
    subject: v.string(),
    body: v.string(),
    safeToSend: v.number(),
    mentionsMoney: v.number(),
    hasPlaceholder: v.number(),
    model: v.string(),
  },
  handler: async (ctx, { id, subject, body, safeToSend, mentionsMoney, hasPlaceholder, model }): Promise<boolean> => {
    const a = await ctx.db.get(id);
    if (!a || !AWAITING_OWNER.has(a.status) || a.payload.kind !== "email") return false;
    if (a.payload.subject !== subject || a.payload.body !== body) return false;
    await ctx.db.patch(id, {
      draftCheck: { safeToSend, mentionsMoney, hasPlaceholder, model, checkedAt: Date.now() },
    });
    return true;
  },
});

async function checkOne(ctx: ActionCtx, id: Id<"opsActions">): Promise<boolean> {
  const draft = await ctx.runQuery(internal.jevDraftCheck._draft, { id });
  if (!draft) return false;
  const asked = await askJev(draftCheckState(draft), DRAFT_CHECK_QUESTIONS);
  if (!asked) return false;
  const { answers, model } = asked.result;
  return await ctx.runMutation(internal.jevDraftCheck._record, {
    id,
    subject: draft.subject,
    body: draft.body,
    safeToSend: answers.safeToSend.noul,
    mentionsMoney: answers.mentionsMoney.noul,
    hasPlaceholder: answers.hasPlaceholder.noul,
    model,
  });
}

/** Ask Jev about each draft and store its read. A draft Jev cannot answer
 *  for keeps no label, exactly as before this check existed. */
export const checkDrafts = internalAction({
  args: { ids: v.array(v.id("opsActions")) },
  handler: async (ctx, { ids }): Promise<{ checked: number; reason?: "no_key" }> => {
    if (!jevEnabled()) return { checked: 0, reason: "no_key" };
    let checked = 0;
    for (let i = 0; i < ids.length; i += BATCH) {
      const stored = await Promise.all(ids.slice(i, i + BATCH).map((id) => checkOne(ctx, id)));
      checked += stored.filter(Boolean).length;
    }
    return { checked };
  },
});
