import { query, internalQuery } from "./_generated/server";
import { mutation } from "./functions";
import { v } from "convex/values";
import { AccessError } from "./lib/access";
import { agencyScope, requireAgencyScope, logEvent } from "./outreach/scope";
import type { Id } from "./_generated/dataModel";
import { PERSONAS, TEMPLATES, renderEmail, contentHash, type PersonaKey, type TemplateKey } from "./outreach/templates";
import { inlineImagesFor, withDataUris } from "./outreach/signatures";

/* ============================================================
   Outreach drafts: the email prepared for one queued prospect, and its
   approval. Approval is bound to the exact content and expires in 24 hours.
   Nothing in this file sends an email.
   ============================================================ */

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
const personaV = v.union(v.literal("maxb"), v.literal("lawrence"));
const modeV = v.union(v.literal("image"), v.literal("animated"), v.literal("original"), v.literal("static"));

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

/** What defines the message: anything here changing invalidates an approval. */
function hashParts(d: { recipient: string; persona: PersonaKey; subject: string; html: string; text: string }) {
  const p = PERSONAS[d.persona];
  return [d.recipient, d.subject, d.html, d.text, `${p.fromName} <${p.fromEmail}>`, p.replyTo, ...inlineImagesFor(d.html).map((i) => i.base64)];
}

export const options = query({
  args: {},
  handler: async (ctx) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    return {
      personas: (Object.keys(PERSONAS) as PersonaKey[]).map((k) => ({
        key: k, label: PERSONAS[k].label, from: `${PERSONAS[k].fromName} <${PERSONAS[k].fromEmail}>`,
        templates: PERSONAS[k].templates.map((t) => ({ key: t, name: TEMPLATES[t as TemplateKey].name })),
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
      gates: { postalAddress: !!settings?.postalAddress, ownerTestConfirmed: !!settings?.testConfirmedAt },
      rows: rows
        .filter((d) => d.status !== "superseded")
        .map((d) => {
          const p = PERSONAS[d.persona];
          const expired = d.status === "approved" && d.approvedAt !== undefined && now - d.approvedAt > APPROVAL_TTL_MS;
          return {
            id: d._id, studio: d.studio, recipient: d.recipient, persona: p.label,
            from: `${p.fromName} <${p.fromEmail}>`, subject: d.subject, signatureMode: d.signatureMode,
            status: expired ? ("expired" as const) : d.status, holdReason: d.holdReason ?? null,
            approvedAt: d.approvedAt ?? null, createdAt: d.createdAt,
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
    return { html: withDataUris(d.html), text: d.text, subject: d.subject, from: `${p.fromName} <${p.fromEmail}>`, to: d.recipient, links, inline, signatureMode: d.signatureMode };
  },
});

export const prepare = mutation({
  args: {
    prospectId: v.id("outreachProspects"),
    email: v.string(),
    persona: personaV,
    templateKey: v.string(),
    observation: v.optional(v.string()),
    signatureMode: v.optional(modeV),
    routingConfirmed: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const scope = await requireManager(ctx);
    const prospect = await ctx.db.get(a.prospectId);
    if (!prospect || prospect.agencyId !== scope.agencyId) throw new AccessError("FORBIDDEN", "Prospect not found");
    if (prospect.status !== "queued" || !prospect.contacts) throw new Error("Queue the prospect for review first");
    const email = a.email.trim().toLowerCase();
    const found = prospect.contacts.emails.find((e) => e.address === email);
    if (!found) throw new Error("That address was not found on the studio's site");
    if (await isSuppressed(ctx, scope.agencyId, email)) throw new Error("That address has opted out");
    const persona = PERSONAS[a.persona];
    if (!persona.templates.includes(a.templateKey)) throw new Error("No approved template exists for that sender yet");

    const settings = await settingsFor(ctx, scope.agencyId);
    const studio = prospect.name ?? (prospect.handle ? prospect.handle : prospect.websiteUrl ?? "your");
    const mode = a.signatureMode ?? "image";
    const r = renderEmail({
      template: a.templateKey as TemplateKey, studio, observation: a.observation,
      bookingUrl: settings?.bookingUrl, postalAddress: settings?.postalAddress, signatureMode: mode,
    });
    const hash = await contentHash(hashParts({ recipient: email, persona: a.persona, subject: r.subject, html: r.html, text: r.text }));

    const hold = found.generic && !a.routingConfirmed
      ? "Generic inbox: confirm who handles studio operations before pitching."
      : undefined;

    const older = await ctx.db.query("outreachDrafts").withIndex("by_prospect", (q) => q.eq("prospectId", a.prospectId)).collect();
    for (const o of older) if (o.status === "draft" || o.status === "hold" || o.status === "approved") await ctx.db.patch(o._id, { status: "superseded" });

    const id = await ctx.db.insert("outreachDrafts", {
      agencyId: scope.agencyId, prospectId: a.prospectId, studio, recipient: email, persona: a.persona,
      templateKey: a.templateKey, signatureMode: mode, observation: a.observation?.trim() || undefined,
      subject: r.subject, html: r.html, text: r.text, contentHash: hash, blockers: r.blockers,
      status: hold ? "hold" : "draft", holdReason: hold, createdAt: Date.now(),
    });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.draft_prepared", "ok", email, `${a.persona}/${a.templateKey}`);
    return id;
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

    const prospect = await ctx.db.get(d.prospectId);
    const r = renderEmail({
      template: d.templateKey as TemplateKey, studio: d.studio, observation: d.observation,
      bookingUrl: settings.bookingUrl, postalAddress: settings.postalAddress, signatureMode: d.signatureMode,
    });
    const hash = await contentHash(hashParts({ recipient: d.recipient, persona: d.persona, subject: r.subject, html: r.html, text: r.text }));
    if (hash !== d.contentHash || !prospect || prospect.status !== "queued") {
      await ctx.db.patch(id, { status: "superseded" });
      throw new Error("The content or settings changed since this draft was prepared. Prepare it again.");
    }
    await ctx.db.patch(id, { status: "approved", approvedBy: scope.actor, approvedAt: Date.now(), approvedHash: hash, blockers: r.blockers });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.draft_approved", "ok", d.recipient, hash.slice(0, 12));
    return null;
  },
});

export const cancel = mutation({
  args: { id: v.id("outreachDrafts") },
  handler: async (ctx, { id }) => {
    const scope = await requireManager(ctx);
    const d = await ctx.db.get(id as Id<"outreachDrafts">);
    if (!d || d.agencyId !== scope.agencyId) throw new AccessError("FORBIDDEN", "Draft not found");
    if (d.status === "cancelled") return null;
    await ctx.db.patch(id, { status: "cancelled" });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.draft_cancelled", "ok", d.recipient);
    return null;
  },
});

export const _get = internalQuery({ args: { id: v.id("outreachDrafts") }, handler: async (ctx, { id }) => await ctx.db.get(id) });
