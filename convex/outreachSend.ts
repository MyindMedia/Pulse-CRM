import { internalQuery, internalAction } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { AccessError } from "./lib/access";
import { requireAgencyScope, logEvent } from "./outreach/scope";
import { redact, canTransition, type CommStatus } from "./outreach/policy";
import { PERSONAS, renderEmail, contentHash, type TemplateKey, type PersonaKey } from "./outreach/templates";
import { inlineImagesFor } from "./outreach/signatures";

/* ============================================================
   Sending one approved email. Nothing here runs unless: live sending is on,
   Outreach is not paused, the draft was approved in the last 24 hours, the
   content still matches what was approved, the address has not opted out, and
   an owner or admin clicks Send for that exact draft. One draft, one send,
   exactly once: an unclear outcome is recorded as "unknown" and is never
   retried automatically.
   ============================================================ */

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

function hashParts(d: { recipient: string; persona: PersonaKey; subject: string; html: string; text: string }) {
  const p = PERSONAS[d.persona];
  return [d.recipient, d.subject, d.html, d.text, `${p.fromName} <${p.fromEmail}>`, p.replyTo, ...inlineImagesFor(d.html).map((i) => i.base64)];
}

/** Validates everything, records the attempt, and hands off to the delivery action. */
export const send = mutation({
  args: { id: v.id("outreachDrafts") },
  handler: async (ctx, { id }) => {
    const scope = await requireAgencyScope(ctx);
    if (!scope.canManage) throw new AccessError("FORBIDDEN", "Only an owner or admin can send");
    const d = await ctx.db.get(id);
    if (!d || d.agencyId !== scope.agencyId) throw new AccessError("FORBIDDEN", "Draft not found");
    const settings = await ctx.db.query("outreachSettings").withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId)).unique();
    if (settings?.mode !== "live") throw new Error("Live sending is off. An owner must turn it on in Settings.");
    if (settings.paused) throw new Error("Outreach is paused");
    if (d.status !== "approved" || d.approvedAt === undefined || !d.approvedHash) throw new Error("Only an approved draft can be sent");
    if (Date.now() - d.approvedAt > APPROVAL_TTL_MS) throw new Error("The approval expired. Prepare and approve it again.");
    const persona = PERSONAS[d.persona];
    if (!settings.senders.some((s) => s.verified && s.address === persona.fromEmail)) throw new Error("The sending identity is not verified");
    if (!settings.postalAddress) throw new Error("A business mailing address is required");
    if ((await ctx.db.query("outreachSuppressions").withIndex("by_agency_email", (q) => q.eq("agencyId", scope.agencyId).eq("email", d.recipient)).unique()) !== null) {
      throw new Error("That address has opted out");
    }
    const prospect = await ctx.db.get(d.prospectId);
    if (!prospect || prospect.status !== "queued") throw new Error("The prospect is no longer queued");

    // The approved content must be exactly what is about to go out.
    const r = renderEmail({
      template: d.templateKey as TemplateKey, studio: d.studio, observation: d.observation,
      bookingUrl: settings.bookingUrl, postalAddress: settings.postalAddress, signatureMode: d.signatureMode,
    });
    const hash = await contentHash(hashParts({ recipient: d.recipient, persona: d.persona, subject: r.subject, html: r.html, text: r.text }));
    if (hash !== d.approvedHash) {
      await ctx.db.patch(id, { status: "superseded" });
      throw new Error("The content or settings changed since approval. Prepare and approve it again.");
    }

    const key = `draft:${id}`;
    const dup = await ctx.db.query("outreachCommunications").withIndex("by_agency_key", (q) => q.eq("agencyId", scope.agencyId).eq("idempotencyKey", key)).unique();
    if (dup) throw new Error("This email was already sent or is being sent");
    const commId = await ctx.db.insert("outreachCommunications", {
      agencyId: scope.agencyId, channel: "email", templateKey: d.templateKey, recipient: d.recipient,
      sender: `${persona.fromName} <${persona.fromEmail}>`, subject: d.subject, isTest: false, status: "submitting",
      idempotencyKey: key, createdAt: Date.now(),
    });
    await ctx.db.patch(id, { status: "sending" });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.email_send_requested", "ok", d.recipient);
    await ctx.scheduler.runAfter(0, internal.outreachSend._deliver, { draftId: id, commId });
    return null;
  },
});

export const _draft = internalQuery({ args: { id: v.id("outreachDrafts") }, handler: async (ctx, { id }) => await ctx.db.get(id) });

export const _finish = internalMutation({
  args: {
    draftId: v.id("outreachDrafts"), commId: v.id("outreachCommunications"),
    status: v.union(v.literal("accepted"), v.literal("rejected"), v.literal("unknown")),
    providerId: v.optional(v.string()), error: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const comm = await ctx.db.get(a.commId);
    const draft = await ctx.db.get(a.draftId);
    if (!comm || !draft) return null;
    await ctx.db.patch(a.commId, { status: a.status, providerId: a.providerId, lastError: redact(a.error) });
    if (a.status === "accepted") await ctx.db.patch(a.draftId, { status: "sent" });
    else if (a.status === "rejected") await ctx.db.patch(a.draftId, { status: "hold", holdReason: `Provider rejected the send: ${redact(a.error, 120) ?? "no reason given"}. Nothing was sent.` });
    // "unknown" leaves the draft in "sending": it must be checked at the provider, never auto-retried.
    await logEvent(ctx, comm.agencyId, "system", "outreach.email_submitted", a.status === "accepted" ? "ok" : a.status === "unknown" ? "unknown" : "denied", a.providerId ?? comm.recipient, a.status);
    return null;
  },
});

export const _deliver = internalAction({
  args: { draftId: v.id("outreachDrafts"), commId: v.id("outreachCommunications") },
  handler: async (ctx, { draftId, commId }) => {
    const d = await ctx.runQuery(internal.outreachSend._draft, { id: draftId });
    if (!d || d.status !== "sending") return null;
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      await ctx.runMutation(internal.outreachSend._finish, { draftId, commId, status: "rejected", error: "No Resend key on the server" });
      return null;
    }
    const p = PERSONAS[d.persona];
    const images = inlineImagesFor(d.html);
    const body = {
      from: `${p.fromName} <${p.fromEmail}>`, to: [d.recipient], subject: d.subject, html: d.html, text: d.text, reply_to: p.replyTo,
      headers: { "List-Unsubscribe": `<mailto:${p.replyTo}?subject=unsubscribe>` },
      ...(images.length ? { attachments: images.map((i) => ({ filename: i.filename, content: i.base64, content_type: i.contentType, content_id: i.contentId })) } : {}),
    };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30_000);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: ctl.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `pulse-outreach-${draftId}`, "User-Agent": "PulseOutreach/1.0" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (res.ok) {
        let id: string | undefined;
        try { id = (JSON.parse(text) as { id?: string }).id; } catch { /* accepted but unreadable */ }
        await ctx.runMutation(internal.outreachSend._finish, { draftId, commId, status: id ? "accepted" : "unknown", providerId: id, error: id ? undefined : "Accepted but no message id returned" });
      } else if (res.status >= 400 && res.status < 500) {
        await ctx.runMutation(internal.outreachSend._finish, { draftId, commId, status: "rejected", error: `HTTP ${res.status}: ${text.slice(0, 160)}` });
      } else {
        await ctx.runMutation(internal.outreachSend._finish, { draftId, commId, status: "unknown", error: `Provider error HTTP ${res.status}` });
      }
    } catch {
      // The request may or may not have reached the provider: never assume, never retry.
      await ctx.runMutation(internal.outreachSend._finish, { draftId, commId, status: "unknown", error: "No clear response from the provider" });
    } finally {
      clearTimeout(timer);
    }
    return null;
  },
});

/* ------------------------- delivery status from the provider ------------------------- */

const EVENT_TO_STATUS: Record<string, CommStatus> = {
  delivered: "delivered", bounced: "bounced", complained: "bounced", suppressed: "suppressed", failed: "rejected",
};

export const _pending = internalQuery({
  args: { agencyId: v.string() },
  handler: async (ctx, { agencyId }) => {
    const rows = await ctx.db.query("outreachCommunications").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).order("desc").take(50);
    return rows.filter((r) => r.providerId && (r.status === "accepted" || r.status === "unknown")).slice(0, 20)
      .map((r) => ({ id: r._id, providerId: r.providerId as string, status: r.status }));
  },
});

export const _apply = internalMutation({
  args: { id: v.id("outreachCommunications"), status: v.string() },
  handler: async (ctx, a) => {
    const row = await ctx.db.get(a.id);
    const next = EVENT_TO_STATUS[a.status];
    if (!row || !next || !canTransition(row.status, next)) return false;
    await ctx.db.patch(a.id, { status: next });
    await logEvent(ctx, row.agencyId, "system", "outreach.email_status", "ok", row.providerId, `${row.status} -> ${next}`);
    return true;
  },
});

export const _checkStatuses = internalAction({
  args: { agencyId: v.string() },
  handler: async (ctx, { agencyId }) => {
    const key = process.env.RESEND_API_KEY;
    if (!key) return null;
    for (const m of await ctx.runQuery(internal.outreachSend._pending, { agencyId })) {
      try {
        const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(m.providerId)}`, { headers: { Authorization: `Bearer ${key}`, "User-Agent": "PulseOutreach/1.0" } });
        if (!res.ok) continue;
        const ev = ((await res.json()) as { last_event?: string }).last_event;
        if (ev) await ctx.runMutation(internal.outreachSend._apply, { id: m.id, status: ev });
      } catch { /* leave it; the next check retries the READ, never the send */ }
    }
    return null;
  },
});

/** Asks the provider what happened to recent sends. Read-only at the provider. */
export const checkStatuses = mutation({
  args: {},
  handler: async (ctx) => {
    const scope = await requireAgencyScope(ctx);
    if (!scope.canManage) throw new AccessError("FORBIDDEN", "Only an owner or admin can check delivery");
    await ctx.scheduler.runAfter(0, internal.outreachSend._checkStatuses, { agencyId: scope.agencyId });
    return null;
  },
});
