import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { logEvent } from "./scope";
import { FOLLOWUP_DAYS } from "./templates";
import { normalizeSubject } from "../mail/threading";

/* Follow-up sequence rules and the database helpers that stop a sequence.
   Nothing here sends: the cron (outreachSequences.tick) only creates drafts. */

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Never two outreach emails to the same studio less than this far apart. */
export const MIN_GAP_MS = 2 * DAY_MS;
export const LAST_STEP = FOLLOWUP_DAYS.length - 1;

export type StopReason = "replied" | "demo_booked" | "bounced" | "complained" | "opted_out" | "suppressed" | "manual";

export const STOP_MEANING: Record<StopReason, string> = {
  replied: "The studio replied.",
  demo_booked: "The studio booked a demo.",
  bounced: "An email to this address bounced.",
  complained: "The recipient marked an email as spam.",
  opted_out: "The studio opted out.",
  suppressed: "The address is on the suppression list.",
  manual: "Stopped by a person.",
};

/** When the step after `step` is due: N days after step 0, and never sooner than
 *  MIN_GAP_MS after the last send. Undefined once the last step was sent. */
export function nextDueAt(step: number, startedAt: number, lastSentAt: number): number | undefined {
  if (step >= LAST_STEP) return undefined;
  return Math.max(startedAt + FOLLOWUP_DAYS[step + 1] * DAY_MS, lastSentAt + MIN_GAP_MS);
}

/** A suppression row's reason, as a stop reason. */
export const suppressionStopReason = (reason: string): StopReason =>
  /opt.?out|unsubscrib|stop/i.test(reason) ? "opted_out" : "suppressed";

const OPEN = new Set(["draft", "hold", "approved"]);

/** Stops one active sequence and cancels its open follow-up drafts (a MaxB reply
 *  draft and anything already sending are left alone). Returns false if it was not active. */
export async function stopSequence(ctx: MutationCtx, seq: Doc<"outreachSequences">, reason: StopReason, actor: string): Promise<boolean> {
  if (seq.status !== "active") return false;
  const now = Date.now();
  await ctx.db.patch(seq._id, { status: "stopped", stoppedReason: reason, stoppedAt: now, stoppedBy: actor, nextDueAt: undefined, pendingDraftId: undefined, updatedAt: now });
  const drafts = await ctx.db.query("outreachDrafts").withIndex("by_prospect", (q) => q.eq("prospectId", seq.prospectId)).collect();
  for (const d of drafts) {
    if ((d.sequenceStep ?? 0) >= 1 && OPEN.has(d.status)) await ctx.db.patch(d._id, { status: "cancelled" });
  }
  await logEvent(ctx, seq.agencyId, actor, "outreach.sequence_stopped", "ok", seq.recipient, reason);
  return true;
}

/** Stops every active sequence for a prospect and/or a recipient address in one agency. */
export async function stopSequencesFor(
  ctx: MutationCtx, agencyId: string, who: { prospectId?: Id<"outreachProspects">; email?: string }, reason: StopReason, actor: string,
): Promise<number> {
  const rows = new Map<string, Doc<"outreachSequences">>();
  if (who.prospectId) {
    for (const s of await ctx.db.query("outreachSequences").withIndex("by_prospect", (q) => q.eq("prospectId", who.prospectId!)).collect()) {
      if (s.agencyId === agencyId) rows.set(s._id, s);
    }
  }
  if (who.email) {
    const email = who.email.trim().toLowerCase();
    for (const s of await ctx.db.query("outreachSequences").withIndex("by_agency_recipient", (q) => q.eq("agencyId", agencyId).eq("recipient", email)).collect()) rows.set(s._id, s);
  }
  let n = 0;
  for (const s of rows.values()) if (await stopSequence(ctx, s, reason, actor)) n++;
  return n;
}

/** Why nobody may write in this thread any more, or null. A bounce or a spam
 *  complaint ends all contact with that address, MaxB replies included. */
export function threadClosed(seq: Doc<"outreachSequences"> | null): string | null {
  if (seq?.stoppedReason === "bounced") return "Email to this address bounced. Nothing more can be sent to it.";
  if (seq?.stoppedReason === "complained") return "This recipient marked an email as spam. Nothing more can be sent to them.";
  return null;
}

export async function sequenceFor(ctx: QueryCtx | MutationCtx, prospectId: Id<"outreachProspects">) {
  return await ctx.db.query("outreachSequences").withIndex("by_prospect", (q) => q.eq("prospectId", prospectId)).first();
}

/** Why a threaded draft (a MaxB follow-up or reply) can no longer go out, or null. */
export async function followupProblem(ctx: QueryCtx | MutationCtx, d: Doc<"outreachDrafts">): Promise<string | null> {
  if (!d.inReplyTo && (d.sequenceStep ?? 0) < 1) return null;
  const seq = await sequenceFor(ctx, d.prospectId);
  const closed = threadClosed(seq);
  if (closed) return closed;
  if ((d.sequenceStep ?? 0) < 1) return null;
  if (!seq || seq.status !== "active") return "The follow-up sequence for this studio has stopped";
  if (seq.step !== (d.sequenceStep as number) - 1) return "This follow-up is out of order";
  return null;
}

/* ---------------------- reply detection (read-only over mail) ----------------------

   Resend Receiving already stores inbound mail (convex/mailInbound.ts -> mail._ingest).
   This does not touch that receiver: it only READS the stored rows. A sequence
   counts as replied when, after step 0 was sent, an inbound message arrived from
   the recipient, or threads under step 0's Message-ID (In-Reply-To or References),
   on a thread that names the recipient or carries step 0's subject. */

const MAX_THREADS_PER_MAILBOX = 200;
const MAX_MESSAGES_PER_THREAD = 50;

export async function detectReplies(ctx: QueryCtx | MutationCtx, agencyId: string, seqs: Doc<"outreachSequences">[]): Promise<Set<Id<"outreachSequences">>> {
  const replied = new Set<Id<"outreachSequences">>();
  if (seqs.length === 0) return replied;
  const since = Math.min(...seqs.map((s) => s.startedAt));
  const byRecipient = new Map<string, Doc<"outreachSequences">[]>();
  const bySubject = new Map<string, Doc<"outreachSequences">[]>();
  for (const s of seqs) {
    byRecipient.set(s.recipient, [...(byRecipient.get(s.recipient) ?? []), s]);
    const ns = normalizeSubject(s.threadSubject);
    bySubject.set(ns, [...(bySubject.get(ns) ?? []), s]);
  }
  const boxes = await ctx.db.query("mailboxes").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).collect();
  const mailboxIds: Array<Id<"mailboxes"> | undefined> = [...boxes.map((b) => b._id), undefined];
  for (const mailboxId of mailboxIds) {
    const threads = await ctx.db.query("mailThreads")
      .withIndex("by_agency_mailbox_last", (q) => q.eq("agencyId", agencyId).eq("mailboxId", mailboxId).gte("lastMessageAt", since))
      .order("desc").take(MAX_THREADS_PER_MAILBOX);
    for (const th of threads) {
      const candidates = new Set<Doc<"outreachSequences">>();
      for (const p of th.participants) for (const s of byRecipient.get(p) ?? []) candidates.add(s);
      for (const s of bySubject.get(th.normalizedSubject) ?? []) candidates.add(s);
      const open = [...candidates].filter((s) => !replied.has(s._id));
      if (open.length === 0) continue;
      const msgs = await ctx.db.query("mailMessages").withIndex("by_thread", (q) => q.eq("threadId", th._id)).order("desc").take(MAX_MESSAGES_PER_THREAD);
      for (const m of msgs) {
        if (m.direction !== "in") continue;
        const at = m.receivedAt ?? m.createdAt;
        for (const s of open) {
          if (at <= s.startedAt) continue;
          const threaded = m.inReplyTo === s.threadMessageId || (m.references ?? []).includes(s.threadMessageId);
          if (threaded || m.fromAddress === s.recipient) replied.add(s._id);
        }
      }
    }
  }
  return replied;
}
