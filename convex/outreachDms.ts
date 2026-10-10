import { query } from "./_generated/server";
import { mutation } from "./functions";
import { v } from "convex/values";
import { AccessError } from "./lib/access";
import { agencyScope, requireAgencyScope, logEvent } from "./outreach/scope";
import type { Id } from "./_generated/dataModel";
import { contentHash } from "./outreach/templates";
import { draftDm, dmBlockers, dmLink, dmSuppressionKey, DM_APPROVAL_TTL_MS } from "./outreach/dm";

/* ============================================================
   Instagram DM outreach. Pulse drafts; a person approves each message and sends
   it from Instagram (Instagram does not allow automated cold DMs, and sending
   through a logged-in robot risks the studio's account). Pulse then records
   that it was sent. Approval binds to the exact text and expires in 24 hours.
   One DM per studio per 30 days; an opt-out is remembered.
   ============================================================ */

async function requireManager(ctx: Parameters<typeof requireAgencyScope>[0]) {
  const scope = await requireAgencyScope(ctx);
  if (!scope.canManage) throw new AccessError("FORBIDDEN", "Only an owner or admin can manage DMs");
  return scope;
}

async function ownedDm(ctx: Parameters<typeof requireAgencyScope>[0], agencyId: string, id: Id<"outreachDms">) {
  const d = await ctx.db.get(id);
  if (!d || d.agencyId !== agencyId) throw new AccessError("FORBIDDEN", "DM not found");
  return d;
}

const hashOf = (handle: string, text: string) => contentHash([handle.toLowerCase(), text]);

async function optedOut(ctx: Parameters<typeof requireAgencyScope>[0], agencyId: string, handle: string) {
  const row = await ctx.db
    .query("outreachSuppressions")
    .withIndex("by_agency_email", (q) => q.eq("agencyId", agencyId).eq("email", dmSuppressionKey(handle)))
    .unique();
  return row !== null;
}

async function lastSentAt(ctx: Parameters<typeof requireAgencyScope>[0], prospectId: Id<"outreachProspects">) {
  const rows = await ctx.db.query("outreachDms").withIndex("by_prospect", (q) => q.eq("prospectId", prospectId)).collect();
  return rows.reduce<number | null>((m, r) => (r.status === "sent" && r.sentAt && (m === null || r.sentAt > m) ? r.sentAt : m), null);
}

/* ------------------------------- queries ------------------------------- */

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    const now = Date.now();
    const dms = await ctx.db.query("outreachDms").withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId)).order("desc").take(200);
    const prospects = await ctx.db.query("outreachProspects").withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId)).order("desc").take(300);
    const withDm = new Set(dms.filter((d) => d.status === "draft" || d.status === "approved").map((d) => String(d.prospectId)));
    return {
      canManage: scope.canManage,
      dms: dms.map((d) => ({
        id: d._id, handle: d.handle, studio: d.studio, text: d.text, status: d.status,
        expired: d.status === "approved" && d.approvedAt !== undefined && now - d.approvedAt > DM_APPROVAL_TTL_MS,
        link: dmLink(d.handle), sentAt: d.sentAt ?? null, createdAt: d.createdAt,
      })),
      candidates: prospects
        .filter((p) => p.handle && p.status !== "suppressed" && !withDm.has(String(p._id)))
        .map((p) => ({
          id: p._id, handle: p.handle as string, name: p.name ?? null, category: p.category ?? null,
          followers: p.followers ?? null, hasEmail: (p.contacts?.emails.length ?? 0) > 0, status: p.status,
        })),
    };
  },
});

/* ------------------------------ mutations ------------------------------ */

export const prepare = mutation({
  args: { prospectId: v.id("outreachProspects") },
  handler: async (ctx, { prospectId }) => {
    const scope = await requireManager(ctx);
    const p = await ctx.db.get(prospectId);
    if (!p || p.agencyId !== scope.agencyId) throw new AccessError("FORBIDDEN", "Prospect not found");
    if (!p.handle) throw new Error("This prospect has no Instagram handle");
    if (p.status === "suppressed") throw new Error("This prospect opted out");
    // The outreach CSV's ig_dm, when imported, is the draft; otherwise it is written from the bio.
    const { text, observation } = p.igDmDraft?.trim()
      ? { text: p.igDmDraft.replace(/\r\n/g, "\n").trim(), observation: undefined }
      : draftDm({ handle: p.handle, studio: p.name, bio: p.bio, category: p.category });
    const now = Date.now();
    const blockers = dmBlockers({ text, handle: p.handle, optedOut: await optedOut(ctx, scope.agencyId, p.handle), lastSentAt: await lastSentAt(ctx, prospectId), now });
    if (blockers.length) throw new Error(blockers[0]);
    const open = await ctx.db.query("outreachDms").withIndex("by_prospect", (q) => q.eq("prospectId", prospectId)).collect();
    for (const d of open) if (d.status === "draft" || d.status === "approved") await ctx.db.patch(d._id, { status: "cancelled" });
    const id = await ctx.db.insert("outreachDms", {
      agencyId: scope.agencyId, prospectId, handle: p.handle, studio: p.name ?? p.handle, text, observation,
      contentHash: await hashOf(p.handle, text), status: "draft", createdAt: now,
    });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.dm_prepared", "ok", p.handle);
    return { id };
  },
});

/** Changing the text resets approval: it is a new message. */
export const edit = mutation({
  args: { id: v.id("outreachDms"), text: v.string() },
  handler: async (ctx, { id, text }) => {
    const scope = await requireManager(ctx);
    const d = await ownedDm(ctx, scope.agencyId, id);
    if (d.status !== "draft" && d.status !== "approved") throw new Error("This DM can no longer be edited");
    const clean = text.replace(/\r\n/g, "\n").trim();
    const blockers = dmBlockers({ text: clean, handle: d.handle, optedOut: false, now: Date.now() });
    if (blockers.length) throw new Error(blockers[0]);
    await ctx.db.patch(id, {
      text: clean, contentHash: await hashOf(d.handle, clean), status: "draft",
      approvedBy: undefined, approvedAt: undefined, approvedHash: undefined,
    });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.dm_edited", "ok", d.handle);
    return null;
  },
});

export const approve = mutation({
  args: { id: v.id("outreachDms") },
  handler: async (ctx, { id }) => {
    const scope = await requireManager(ctx);
    const d = await ownedDm(ctx, scope.agencyId, id);
    if (d.status !== "draft") throw new Error("This DM is not awaiting approval");
    const now = Date.now();
    const blockers = dmBlockers({
      text: d.text, handle: d.handle, optedOut: await optedOut(ctx, scope.agencyId, d.handle),
      lastSentAt: await lastSentAt(ctx, d.prospectId), now,
    });
    if (blockers.length) throw new Error(blockers[0]);
    const hash = await hashOf(d.handle, d.text);
    if (hash !== d.contentHash) throw new Error("The message changed. Prepare it again.");
    await ctx.db.patch(id, { status: "approved", approvedBy: scope.actor, approvedAt: now, approvedHash: hash });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.dm_approved", "ok", d.handle, hash.slice(0, 12));
    return null;
  },
});

export const cancel = mutation({
  args: { id: v.id("outreachDms") },
  handler: async (ctx, { id }) => {
    const scope = await requireManager(ctx);
    const d = await ownedDm(ctx, scope.agencyId, id);
    if (d.status === "sent" || d.status === "cancelled") throw new Error("This DM is already closed");
    await ctx.db.patch(id, { status: "cancelled" });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.dm_cancelled", "ok", d.handle);
    return null;
  },
});

/** The person sent it from Instagram; record that, once, against the approved text. */
export const markSent = mutation({
  args: { id: v.id("outreachDms") },
  handler: async (ctx, { id }) => {
    const scope = await requireManager(ctx);
    const d = await ownedDm(ctx, scope.agencyId, id);
    if (d.status !== "approved" || !d.approvedAt) throw new Error("Approve the DM before marking it sent");
    const now = Date.now();
    if (now - d.approvedAt > DM_APPROVAL_TTL_MS) throw new Error("The approval expired. Approve it again.");
    if ((await hashOf(d.handle, d.text)) !== d.approvedHash) throw new Error("The message changed after approval.");
    await ctx.db.patch(id, { status: "sent", sentBy: scope.actor, sentAt: now });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.dm_sent", "ok", d.handle);
    return null;
  },
});

/** The studio said stop: remember it and close any open DM. */
export const optOut = mutation({
  args: { id: v.id("outreachDms") },
  handler: async (ctx, { id }) => {
    const scope = await requireManager(ctx);
    const d = await ownedDm(ctx, scope.agencyId, id);
    const key = dmSuppressionKey(d.handle);
    const existing = await ctx.db.query("outreachSuppressions").withIndex("by_agency_email", (q) => q.eq("agencyId", scope.agencyId).eq("email", key)).unique();
    if (!existing) await ctx.db.insert("outreachSuppressions", { agencyId: scope.agencyId, email: key, reason: "Asked not to be messaged on Instagram", at: Date.now() });
    const open = await ctx.db.query("outreachDms").withIndex("by_prospect", (q) => q.eq("prospectId", d.prospectId)).collect();
    for (const r of open) if (r.status === "draft" || r.status === "approved") await ctx.db.patch(r._id, { status: "cancelled" });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.dm_opt_out", "ok", d.handle);
    return null;
  },
});
