import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { currentOrgWithCapability } from "./lib/tenant";
import { resolveViewer } from "./lib/access";
import { notify } from "./lib/notify";
import { normalizePhone } from "./lib/phone";
import { renderSms, MANUAL_CLIENT } from "./lib/smsTemplates";
import { ensurePortalLink } from "./lib/portalLink";
import { alertStudioOfClientMessage } from "./lib/messageAlerts";

/* Answering clients, wherever they wrote from.
 *
 * Texts arrive on one shared number and are routed (lib/smsRouting.ts); portal
 * messages belong to one client and one studio already. From here a studio
 * replies in the portal, marks a message dealt with, and an agency sends on a
 * text whose studio was not clear. Nothing here passes a message to an AI
 * (docs/compliance/messages.md). */

const MAX_BODY = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Waiting clears without a reply: every unanswered inbound message from this
 *  client is marked dealt with, until the client writes again. */
export const markHandled = mutation({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => {
    const orgId = await currentOrgWithCapability(ctx, "artists.edit");
    const artist = await ctx.db.get(artistId);
    if (!artist || artist.orgId !== orgId) throw new ConvexError("Client not found.");
    const identity = await ctx.auth.getUserIdentity();
    const now = Date.now();
    let marked = 0;
    const rows = await ctx.db.query("clientMessages").withIndex("by_artist", (q) => q.eq("artistId", artistId)).collect();
    for (const m of rows) {
      if (m.direction !== "in" || m.handledAt) continue;
      await ctx.db.patch(m._id, { handledAt: now, handledBy: identity?.subject });
      marked++;
    }
    return { marked };
  },
});

/** Reply in the client's portal thread. The client is told by text (or email
 *  when they have no reachable phone) with the portal link and no message
 *  text, so what was said stays in the portal. A mutation, so it queues from a
 *  phone with no signal like every other write. */
export const sendPortal = mutation({
  args: { artistId: v.id("artists"), body: v.string() },
  handler: async (ctx, { artistId, body }): Promise<{ notified: "text" | "email" | "none" }> => {
    const orgId = await currentOrgWithCapability(ctx, "artists.edit");
    const artist = await ctx.db.get(artistId);
    if (!artist || artist.orgId !== orgId || artist.erasedAt) throw new ConvexError("Client not found.");
    const text = body.trim();
    if (!text) throw new ConvexError("Write a message first.");
    if (text.length > MAX_BODY) throw new ConvexError(`Keep it under ${MAX_BODY} characters.`);

    const identity = await ctx.auth.getUserIdentity();
    await ctx.db.insert("clientMessages", {
      orgId,
      artistId,
      direction: "out",
      subject: "Portal message",
      body: text,
      channel: "portal",
      status: "sent",
      sentBy: identity?.subject,
    });

    const link = await ensurePortalLink(ctx, orgId, artist);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    const studio = org?.name ?? "The studio";
    const phone = artist.phone ? normalizePhone(artist.phone) : null;
    const optedOut = phone
      ? (await ctx.db.query("smsOptOuts").withIndex("by_phone", (q) => q.eq("phone", phone)).first())?.optedOut === true
      : true;
    if (phone && !optedOut) {
      await notify(ctx, {
        orgId,
        channel: "sms",
        recipient: phone,
        subject: "New message",
        body: renderSms(MANUAL_CLIENT, { studio, body: `you have a new message. Read and reply here: ${link}` }),
        kind: "portal.message",
      });
      return { notified: "text" };
    }
    if (artist.email) {
      await notify(ctx, {
        orgId,
        channel: "email",
        recipient: artist.email,
        subject: `New message from ${studio}`,
        body: `You have a new message from ${studio}.\n\nRead it and reply here: ${link}`,
        kind: "portal.message",
      });
      return { notified: "email" };
    }
    return { notified: "none" };
  },
});

/** For sms.sendClientSms: the portal link every studio text carries. */
export const _portalLinkFor = internalMutation({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }): Promise<string | null> => {
    const artist = await ctx.db.get(artistId);
    if (!artist || artist.erasedAt) return null;
    return await ensurePortalLink(ctx, artist.orgId, artist);
  },
});

// ── The Unrouted list ────────────────────────────────────────────────────

/** Agency owners and admins only: the texts held for them are from clients of
 *  several of their studios, and nobody below that level may see one before
 *  the studio it belongs to does. */
async function agencyLead(ctx: QueryCtx) {
  const viewer = await resolveViewer(ctx);
  if (viewer.kind !== "agency_member" || (viewer.role !== "owner" && viewer.role !== "admin")) {
    throw new ConvexError("Only agency owners and admins can route texts.");
  }
  return viewer;
}

export const listUnrouted = query({
  args: {},
  handler: async (ctx) => {
    let viewer;
    try {
      viewer = await agencyLead(ctx);
    } catch {
      return [];
    }
    const rows = await ctx.db
      .query("unroutedMessages")
      .withIndex("by_agency_status", (q) => q.eq("agencyId", viewer.agencyId).eq("status", "open"))
      .collect();
    const out = [];
    for (const r of rows.sort((a, b) => b.receivedAt - a.receivedAt)) {
      const candidates = [];
      for (const orgId of r.candidateOrgIds) {
        const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
        const artists = await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
        const client = artists.find((a) => !a.erasedAt && !!a.phone && normalizePhone(a.phone) === r.phone);
        candidates.push({ orgId, studioName: org?.name ?? orgId, clientName: client?.name ?? null });
      }
      // The last four digits are enough to recognise a client; the full number
      // is already on file in each candidate studio.
      out.push({ _id: r._id, phoneEnding: r.phone.slice(-4), body: r.body, receivedAt: r.receivedAt, candidates });
    }
    return out;
  },
});

/** Send a held text on to the studio it belongs to. */
export const assignUnrouted = mutation({
  args: { id: v.id("unroutedMessages"), orgId: v.string() },
  handler: async (ctx, { id, orgId }) => {
    const viewer = await agencyLead(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.agencyId !== viewer.agencyId) throw new ConvexError("That text is not on your list.");
    if (row.status !== "open") throw new ConvexError("That text has already been dealt with.");
    if (!row.candidateOrgIds.includes(orgId)) throw new ConvexError("That studio does not have this client.");
    const artists = await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const artist = artists.find((a) => !a.erasedAt && !!a.phone && normalizePhone(a.phone) === row.phone);
    if (!artist) throw new ConvexError("That studio no longer has this client.");
    await ctx.db.insert("clientMessages", {
      orgId,
      artistId: artist._id,
      direction: "in",
      subject: "Text message",
      body: row.body,
      channel: "sms",
      status: "received",
      routedBy: "assigned",
    });
    await ctx.db.patch(id, { status: "assigned", assignedOrgId: orgId, resolvedBy: viewer.clerkUserId, resolvedAt: Date.now() });
    await alertStudioOfClientMessage(ctx, artist);
    return null;
  },
});

/** Take a held text off the list without sending it anywhere. */
export const dismissUnrouted = mutation({
  args: { id: v.id("unroutedMessages") },
  handler: async (ctx, { id }) => {
    const viewer = await agencyLead(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.agencyId !== viewer.agencyId) throw new ConvexError("That text is not on your list.");
    if (row.status !== "open") return null;
    await ctx.db.patch(id, { status: "dismissed", resolvedBy: viewer.clerkUserId, resolvedAt: Date.now() });
    return null;
  },
});

/** Storage limitation: held texts go after 30 days, texted-contact records after 90. */
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const held = await ctx.db
      .query("unroutedMessages")
      .withIndex("by_received", (q) => q.lt("receivedAt", now - 30 * DAY_MS))
      .take(500);
    for (const r of held) await ctx.db.delete(r._id);
    const contacts = await ctx.db
      .query("smsContacts")
      .withIndex("by_last_sent", (q) => q.lt("lastSentAt", now - 90 * DAY_MS))
      .take(500);
    for (const c of contacts) await ctx.db.delete(c._id);
    return { held: held.length, contacts: contacts.length };
  },
});
