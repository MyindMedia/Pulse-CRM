import { mutation, internalMutation } from "./functions";
import { v } from "convex/values";
import { AccessError } from "./lib/access";
import { requireAgencyScope, logEvent } from "./outreach/scope";
import type { Doc } from "./_generated/dataModel";
import { TEMPLATES, templateForStep } from "./outreach/templates";
import { renderAndHash, studioName, type DraftContent } from "./outreach/drafting";
import { DAY_MS, LAST_STEP, detectReplies, sequenceFor, stopSequence, suppressionStopReason, type StopReason } from "./outreach/sequence";

/* ============================================================
   Follow-up sequences. Lawrence's first email starts one when the provider
   accepts it (outreachSend._finish). MaxB's follow-ups are due 3, 7 and 14 days
   later, each a reply in the same thread.

   The cron below ONLY creates drafts in the Review queue. It never approves and
   never sends: each follow-up still needs Approve this email and a person's
   Send now. It stops a sequence when the studio replied, booked a demo, bounced
   or complained, opted out or is suppressed; a person can stop one too.
   ============================================================ */

const MAX_PER_TICK = 200;
const RECENT_ROWS = 500;
const OPEN = new Set(["draft", "hold", "approved", "sending"]);

/** Owner/admin: stop this studio's follow-ups now. */
export const stop = mutation({
  args: { prospectId: v.id("outreachProspects") },
  handler: async (ctx, { prospectId }) => {
    const scope = await requireAgencyScope(ctx);
    if (!scope.canManage) throw new AccessError("FORBIDDEN", "Only an owner or admin can stop a sequence");
    const seq = await sequenceFor(ctx, prospectId);
    if (!seq || seq.agencyId !== scope.agencyId) throw new AccessError("FORBIDDEN", "Sequence not found");
    if (!(await stopSequence(ctx, seq, "manual", scope.actor))) throw new Error("This sequence is not running");
    return null;
  },
});

/** The cron entry. Drafts only. */
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const active = await ctx.db.query("outreachSequences").withIndex("by_status_due", (q) => q.eq("status", "active")).take(MAX_PER_TICK);
    const byAgency = new Map<string, Doc<"outreachSequences">[]>();
    for (const s of active) byAgency.set(s.agencyId, [...(byAgency.get(s.agencyId) ?? []), s]);
    let stopped = 0, drafted = 0;

    for (const [agencyId, seqs] of byAgency) {
      const since = Math.min(...seqs.map((s) => s.startedAt));
      const settings = await ctx.db.query("outreachSettings").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).unique();
      const suppressed = new Map((await ctx.db.query("outreachSuppressions").withIndex("by_agency_email", (q) => q.eq("agencyId", agencyId)).collect()).map((r) => [r.email, r.reason]));
      const booked = new Set(
        (await ctx.db.query("outreachBookings").withIndex("by_agency_start", (q) => q.eq("agencyId", agencyId)).order("desc").take(RECENT_ROWS))
          .filter((b) => (b.status === "confirmed" || b.status === "completed") && b.contactEmail)
          .map((b) => (b.contactEmail as string).toLowerCase()),
      );
      const bounced = new Set(
        (await ctx.db.query("outreachCommunications").withIndex("by_agency", (q) => q.eq("agencyId", agencyId).gte("createdAt", since)).order("desc").take(RECENT_ROWS))
          .filter((c) => c.status === "bounced").map((c) => c.recipient),
      );
      const replies = await detectReplies(ctx, agencyId, seqs);

      for (const seq of seqs) {
        const prospect = await ctx.db.get(seq.prospectId);
        let reason: StopReason | null = null;
        if (!prospect) reason = "manual";
        else if (prospect.status === "replied") reason = "replied";
        else if (replies.has(seq._id)) {
          reason = "replied";
          if (prospect.status === "queued") await ctx.db.patch(prospect._id, { status: "replied", repliedAt: now, updatedAt: now });
          await logEvent(ctx, agencyId, "system", "outreach.reply_detected", "ok", seq.recipient);
        } else if (prospect.bookedAt || booked.has(seq.recipient)) reason = "demo_booked";
        else if (bounced.has(seq.recipient)) reason = "bounced";
        else if (suppressed.has(seq.recipient)) reason = suppressionStopReason(suppressed.get(seq.recipient) as string);
        else if (prospect.status === "suppressed") reason = "suppressed";
        if (reason) {
          if (await stopSequence(ctx, seq, reason, "system")) stopped++;
          continue;
        }
        if (seq.step >= LAST_STEP) continue;

        if (seq.pendingDraftId) {
          const pending = await ctx.db.get(seq.pendingDraftId);
          if (pending && OPEN.has(pending.status)) continue;
          // Superseded (its override changed) or gone: draft it again below.
          await ctx.db.patch(seq._id, { pendingDraftId: undefined, updatedAt: now });
        }
        if (seq.nextDueAt === undefined || seq.nextDueAt > now) continue;
        if (!settings || settings.paused) continue;

        const step = seq.step + 1;
        const key = templateForStep(step);
        const t = TEMPLATES[key];
        const content: DraftContent = {
          recipient: seq.recipient, persona: t.persona, templateKey: key, studio: studioName(prospect!), signatureMode: "image",
          bodyOverride: prospect!.followups?.[`step${step}` as "step1" | "step2" | "step3"]?.trim() || undefined,
          threadSubject: seq.threadSubject, inReplyTo: seq.threadMessageId, references: seq.threadMessageId,
        };
        let rendered: Awaited<ReturnType<typeof renderAndHash>>;
        try {
          rendered = await renderAndHash(content, settings);
        } catch (e) {
          // Bad override copy (an em dash, an accolade claim...): say so and try again tomorrow.
          await ctx.db.patch(seq._id, { nextDueAt: now + DAY_MS, updatedAt: now });
          await logEvent(ctx, agencyId, "system", "outreach.sequence_draft_failed", "denied", seq.recipient, e instanceof Error ? e.message : "render failed");
          continue;
        }
        const id = await ctx.db.insert("outreachDrafts", {
          agencyId, prospectId: seq.prospectId, ...content, sequenceStep: step,
          subject: rendered.r.subject, html: rendered.r.html, text: rendered.r.text, contentHash: rendered.hash, blockers: rendered.r.blockers,
          status: "draft", createdAt: now,
        });
        await ctx.db.patch(seq._id, { pendingDraftId: id, updatedAt: now });
        await logEvent(ctx, agencyId, "system", "outreach.sequence_draft_created", "ok", seq.recipient, `step ${step}/${key}`);
        drafted++;
      }
    }
    return { stopped, drafted };
  },
});
