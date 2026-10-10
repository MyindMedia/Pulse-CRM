import { query, internalQuery } from "./_generated/server";
import { mutation } from "./functions";
import { v } from "convex/values";
import { AccessError } from "./lib/access";
import { agencyScope, requireAgencyScope, logEvent } from "./outreach/scope";
import type { Doc, Id } from "./_generated/dataModel";
import { PERSONAS, TEMPLATES, isTemplateKey, type PersonaKey } from "./outreach/templates";
import { inlineImagesFor, withDataUris } from "./outreach/signatures";
import { APPROVAL_TTL_MS, GENERIC_HOLD, renderAndHash, cleanText, studioName, sendableStatuses, type DraftContent } from "./outreach/drafting";
import { sequenceFor, stopSequence, threadClosed, followupProblem } from "./outreach/sequence";

/* ============================================================
   Outreach drafts: the email prepared for one queued prospect, and its
   approval. Approval is bound to the exact content and expires in 24 hours.
   Nothing in this file sends an email.

   The first email to a studio is Lawrence's (lawrence_first, step 0). MaxB's
   day 3/7/14 follow-ups are drafted by the sequence cron (outreachSequences),
   and MaxB can reply in the thread by hand (maxb_reply). Every one of them
   still needs Approve this email and a person's Send now.
   ============================================================ */

const personaV = v.union(v.literal("maxb"), v.literal("lawrence"));
const modeV = v.union(v.literal("image"), v.literal("animated"), v.literal("original"), v.literal("static"));
const OPEN = new Set(["draft", "hold", "approved"]);

async function requireManager(ctx: Parameters<typeof requireAgencyScope>[0]) {
  const scope = await requireAgencyScope(ctx);
  if (!scope.canManage) throw new AccessError("FORBIDDEN", "Only an owner or admin can manage drafts");
  return scope;
}

async function settingsFor(ctx: Parameters<typeof requireAgencyScope>[0], agencyId: string) {
  return await ctx.db.query("outreachSettings").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).unique();
}

async function isSuppressed(ctx: Parameters<typeof requireAgencyScope>[0], agencyId: string, email: string) {
  return (await ctx.db.query("outreachSuppressions").withIndex("by_agency_email", (q) => q.eq("agencyId", agencyId).eq("email", email)).unique()) !== null;
}

const contentOf = (d: Doc<"outreachDrafts">): DraftContent => ({
  recipient: d.recipient, persona: d.persona, templateKey: d.templateKey, studio: d.studio, signatureMode: d.signatureMode,
  observation: d.observation, subjectOverride: d.subjectOverride, bodyOverride: d.bodyOverride,
  threadSubject: d.threadSubject, inReplyTo: d.inReplyTo, references: d.references,
});

const stepLabel = (d: Doc<"outreachDrafts">) => {
  const name = isTemplateKey(d.templateKey) ? TEMPLATES[d.templateKey].name : d.templateKey;
  return d.sequenceStep === undefined ? name : `Step ${d.sequenceStep}: ${name}`;
};

export const options = query({
  args: {},
  handler: async (ctx) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    return {
      personas: (Object.keys(PERSONAS) as PersonaKey[]).map((k) => ({
        key: k, label: PERSONAS[k].label, from: `${PERSONAS[k].fromName} <${PERSONAS[k].fromEmail}>`,
        templates: PERSONAS[k].templates.map((t) => ({ key: t, name: TEMPLATES[t].name, step: TEMPLATES[t].step })),
      })),
    };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    const settings = await settingsFor(ctx, scope.agencyId);
    const rows = await ctx.db.query("outreachDrafts").withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId)).order("desc").take(50);
    const now = Date.now();
    return {
      canManage: scope.canManage,
      gates: { postalAddress: !!settings?.postalAddress, ownerTestConfirmed: !!settings?.testConfirmedAt, live: settings?.mode === "live" && settings.paused === false },
      rows: rows
        .filter((d) => d.status !== "superseded")
        .map((d) => {
          const p = PERSONAS[d.persona];
          const expired = d.status === "approved" && d.approvedAt !== undefined && now - d.approvedAt > APPROVAL_TTL_MS;
          const t = isTemplateKey(d.templateKey) ? TEMPLATES[d.templateKey] : null;
          return {
            id: d._id, studio: d.studio || d.recipient, recipient: d.recipient, persona: p.label,
            from: `${p.fromName} <${p.fromEmail}>`, subject: d.subject, signatureMode: d.signatureMode,
            status: expired ? ("expired" as const) : d.status, holdReason: d.holdReason ?? null,
            approvedAt: d.approvedAt ?? null, createdAt: d.createdAt,
            step: d.sequenceStep ?? null, label: stepLabel(d), threaded: !!d.inReplyTo,
            observation: d.observation ?? null, subjectOverride: d.subjectOverride ?? null, bodyOverride: d.bodyOverride ?? null,
            editable: { observation: !!t?.requiresObservation, subject: !!t && !t.threaded, body: !!t },
          };
        }),
    };
  },
});

/** The exact rendered email, for a sandboxed preview. Scoped to the agency. */
export const preview = query({
  args: { id: v.id("outreachDrafts") },
  handler: async (ctx, { id }) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    const d = await ctx.db.get(id);
    if (!d || d.agencyId !== scope.agencyId) return null;
    const p = PERSONAS[d.persona];
    const links = [...new Set([...d.html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]))];
    const inline = inlineImagesFor(d.html).map((i) => i.filename);
    return {
      html: withDataUris(d.html), text: d.text, subject: d.subject, from: `${p.fromName} <${p.fromEmail}>`, to: d.recipient, links, inline,
      signatureMode: d.signatureMode, inReplyTo: d.inReplyTo ?? null,
    };
  },
});

export const prepare = mutation({
  args: {
    prospectId: v.id("outreachProspects"),
    email: v.string(),
    persona: personaV,
    templateKey: v.string(),
    observation: v.optional(v.string()),
    subjectOverride: v.optional(v.string()),
    bodyOverride: v.optional(v.string()),
    signatureMode: v.optional(modeV),
    routingConfirmed: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const scope = await requireManager(ctx);
    const prospect = await ctx.db.get(a.prospectId);
    if (!prospect || prospect.agencyId !== scope.agencyId) throw new AccessError("FORBIDDEN", "Prospect not found");
    const key = a.templateKey;
    if (!isTemplateKey(key) || !PERSONAS[a.persona].templates.includes(key) || TEMPLATES[key].persona !== a.persona) {
      throw new Error("No approved template exists for that sender");
    }
    const t = TEMPLATES[key];
    if (t.step !== null && t.step >= 1) throw new Error("MaxB's follow-ups are drafted automatically on day 3, 7 and 14");
    if (!prospect.contacts) throw new Error("Queue the prospect for review first");

    const seq = await sequenceFor(ctx, prospect._id);
    const older = await ctx.db.query("outreachDrafts").withIndex("by_prospect", (q) => q.eq("prospectId", a.prospectId)).collect();
    const email = a.email.trim().toLowerCase();
    if (key === "lawrence_first") {
      if (prospect.status !== "queued") throw new Error("Queue the prospect for review first");
      if (seq) throw new Error("Lawrence already emailed this studio. Follow-ups and replies come from MaxB.");
      // An email whose outcome is still unknown (no sequence yet) counts as sent: never a second cold email.
      if (older.some((o) => o.status === "sending" || o.status === "sent")) {
        throw new Error("This studio was already emailed, or a send is still being checked at the provider");
      }
    } else {
      if (!seq) throw new Error("The first email to a studio comes from Lawrence. Prepare his email first.");
      if (!sendableStatuses(key).includes(prospect.status)) throw new Error("This prospect can no longer be emailed");
      if (email !== seq.recipient) throw new Error("A reply goes to the address Lawrence wrote to");
      const closed = threadClosed(seq);
      if (closed) throw new Error(closed);
    }
    const found = prospect.contacts.emails.find((e) => e.address === email);
    if (!found) throw new Error("That address was not found on the studio's site");
    if (await isSuppressed(ctx, scope.agencyId, email)) throw new Error("That address has opted out");

    const settings = await settingsFor(ctx, scope.agencyId);
    const content: DraftContent = {
      recipient: email, persona: a.persona, templateKey: key, studio: studioName(prospect), signatureMode: a.signatureMode ?? "image",
      observation: t.requiresObservation ? cleanText(a.observation) : undefined,
      subjectOverride: t.threaded ? undefined : cleanText(a.subjectOverride),
      bodyOverride: cleanText(a.bodyOverride),
      threadSubject: t.threaded ? seq?.threadSubject : undefined,
      inReplyTo: t.threaded ? seq?.threadMessageId : undefined,
      references: t.threaded ? seq?.threadMessageId : undefined,
    };
    const { r, hash } = await renderAndHash(content, settings);

    const hold = found.generic && !a.routingConfirmed && !prospect.routingConfirmed ? GENERIC_HOLD : undefined;
    const sequenceStep = t.step ?? undefined;

    // A new draft replaces the open one for the same message (Lawrence's email, or a MaxB reply), nothing else.
    for (const o of older) {
      if (OPEN.has(o.status) && o.templateKey === key && o.sequenceStep === sequenceStep) await ctx.db.patch(o._id, { status: "superseded" });
    }

    const id = await ctx.db.insert("outreachDrafts", {
      agencyId: scope.agencyId, prospectId: a.prospectId, ...content, sequenceStep,
      subject: r.subject, html: r.html, text: r.text, contentHash: hash, blockers: r.blockers,
      status: hold ? "hold" : "draft", holdReason: hold, createdAt: Date.now(),
    });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.draft_prepared", "ok", email, `${a.persona}/${key}`);
    return id;
  },
});

/** Edits the opening line, subject or body of an open draft. Any edit is a new
 *  message: the approval is cleared and it must be approved again. */
export const edit = mutation({
  args: {
    id: v.id("outreachDrafts"),
    observation: v.optional(v.string()),
    subjectOverride: v.optional(v.string()),
    bodyOverride: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const scope = await requireManager(ctx);
    const d = await ctx.db.get(a.id);
    if (!d || d.agencyId !== scope.agencyId) throw new AccessError("FORBIDDEN", "Draft not found");
    if (!OPEN.has(d.status)) throw new Error("This draft can no longer be edited");
    if (!isTemplateKey(d.templateKey)) throw new Error("This template is no longer available. Prepare the email again.");
    const t = TEMPLATES[d.templateKey];
    const next: DraftContent = {
      ...contentOf(d),
      observation: a.observation !== undefined && t.requiresObservation ? cleanText(a.observation) : d.observation,
      subjectOverride: a.subjectOverride !== undefined && !t.threaded ? cleanText(a.subjectOverride) : d.subjectOverride,
      bodyOverride: a.bodyOverride !== undefined ? cleanText(a.bodyOverride) : d.bodyOverride,
    };
    const settings = await settingsFor(ctx, scope.agencyId);
    const { r, hash } = await renderAndHash(next, settings);
    await ctx.db.patch(a.id, {
      observation: next.observation, subjectOverride: next.subjectOverride, bodyOverride: next.bodyOverride,
      subject: r.subject, html: r.html, text: r.text, contentHash: hash, blockers: r.blockers,
      status: d.status === "hold" ? "hold" : "draft", approvedBy: undefined, approvedAt: undefined, approvedHash: undefined,
    });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.draft_edited", "ok", d.recipient, d.status === "approved" ? "approval cleared" : undefined);
    return null;
  },
});

/** Approves the exact payload. It does not send. Re-renders from current
 *  settings and refuses if anything has changed since the draft was prepared. */
export const approve = mutation({
  args: { id: v.id("outreachDrafts") },
  handler: async (ctx, { id }) => {
    const scope = await requireManager(ctx);
    const d = await ctx.db.get(id);
    if (!d || d.agencyId !== scope.agencyId) throw new AccessError("FORBIDDEN", "Draft not found");
    if (d.status !== "draft") throw new Error(d.status === "hold" ? "Resolve the hold first" : "This draft is not awaiting approval");
    const settings = await settingsFor(ctx, scope.agencyId);
    if (!settings?.postalAddress) throw new Error("A business mailing address is required in the footer before approval");
    if (!settings.testConfirmedAt) throw new Error("Confirm an owner test email landed and looked right before approving prospect emails");
    if (await isSuppressed(ctx, scope.agencyId, d.recipient)) throw new Error("That address has opted out");
    const problem = await followupProblem(ctx, d);
    if (problem) throw new Error(problem);

    const prospect = await ctx.db.get(d.prospectId);
    const { r, hash } = await renderAndHash(contentOf(d), settings);
    if (hash !== d.contentHash || !prospect || !sendableStatuses(d.templateKey).includes(prospect.status)) {
      await ctx.db.patch(id, { status: "superseded" });
      throw new Error("The content or settings changed since this draft was prepared. Prepare it again.");
    }
    await ctx.db.patch(id, { status: "approved", approvedBy: scope.actor, approvedAt: Date.now(), approvedHash: hash, blockers: r.blockers });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.draft_approved", "ok", d.recipient, hash.slice(0, 12));
    return null;
  },
});

/** Cancels a draft. Cancelling a MaxB follow-up stops that studio's sequence:
 *  the only reason to cancel one is not to send it. */
export const cancel = mutation({
  args: { id: v.id("outreachDrafts") },
  handler: async (ctx, { id }) => {
    const scope = await requireManager(ctx);
    const d = await ctx.db.get(id as Id<"outreachDrafts">);
    if (!d || d.agencyId !== scope.agencyId) throw new AccessError("FORBIDDEN", "Draft not found");
    if (d.status === "cancelled") return null;
    await ctx.db.patch(id, { status: "cancelled" });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.draft_cancelled", "ok", d.recipient);
    if ((d.sequenceStep ?? 0) >= 1) {
      const seq = await sequenceFor(ctx, d.prospectId);
      if (seq) await stopSequence(ctx, seq, "manual", scope.actor);
    }
    return null;
  },
});

export const _get = internalQuery({ args: { id: v.id("outreachDrafts") }, handler: async (ctx, { id }) => await ctx.db.get(id) });
