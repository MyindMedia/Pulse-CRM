import { action, query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { currentOrg } from "./lib/tenant";
import { requireCapability } from "./lib/access";
import { sendEmail } from "./lib/email";
import { studioEmailHtml } from "./lib/emailTemplates/layout";
import { googleConfigured, gmailSend } from "./lib/google";

/* Client communications email (P4). A studio sends client email either through
   its connected Google account (sends as their real Gmail) or the internal
   Pulse channel (Resend-backed, from "<Studio> via Pulse"). */

export const emailStatus = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return {
      provider: org?.emailProvider ?? "internal",
      googleConnected: Boolean(org?.googleRefreshToken),
      googleEmail: org?.googleEmail ?? null,
      googleConfigured: googleConfigured(),
      internalReady: Boolean(process.env.RESEND_API_KEY),
    };
  },
});

/** Choose the client-comms channel for this studio. */
export const setProvider = mutation({
  args: { provider: v.union(v.literal("google"), v.literal("internal")) },
  handler: async (ctx, { provider }) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) throw new ConvexError("No studio.");
    if (provider === "google" && !org.googleRefreshToken) {
      throw new ConvexError("Connect your Google account first.");
    }
    await ctx.db.patch(org._id, { emailProvider: provider });
  },
});

/** Internal - context to route + send a client email. */
export const _sendContext = internalQuery({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => {
    const orgId = await currentOrg(ctx);
    const artist = await ctx.db.get(artistId);
    if (!artist || artist.orgId !== orgId) return null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return {
      to: artist.email ?? null,
      studioName: org?.name ?? "Studio",
      provider: org?.emailProvider ?? "internal",
      googleRefreshToken: org?.googleRefreshToken ?? null,
      googleEmail: org?.googleEmail ?? null,
    };
  },
});

/**
 * Send an email to a client (artist) on the studio's chosen channel. Falls back
 * to the internal channel if Google isn't actually connected.
 */
export const sendToClient = action({
  args: { artistId: v.id("artists"), subject: v.string(), body: v.string() },
  handler: async (ctx, { artistId, subject, body }): Promise<{ ok: boolean; channel: string }> => {
    // Gate: only studio members who manage artists can email clients.
    await ctx.runQuery(internal.clientEmail._assertCanEmail, { artistId });
    const c = await ctx.runQuery(internal.clientEmail._sendContext, { artistId });
    if (!c) throw new ConvexError("Client not found.");
    if (!c.to) throw new ConvexError("This client has no email on file.");

    // Branded, studio-framed layout (white-label: the client sees the
    // STUDIO's name; Pulse only appears in the footer).
    const html = studioEmailHtml({ studioName: c.studioName, bodyText: body });

    let channel: "google" | "internal";
    let status: "sent" | "failed" | "simulated";
    if (c.provider === "google" && c.googleRefreshToken && googleConfigured()) {
      channel = "google";
      try {
        await gmailSend(c.googleRefreshToken, { from: c.googleEmail ?? "me", to: c.to, subject, html });
        status = "sent";
      } catch {
        status = "failed";
      }
    } else {
      channel = "internal";
      status = await sendEmail({
        to: c.to,
        subject,
        html,
        from: `${c.studioName} via Pulse <support@myindsound.com>`,
      });
    }

    const identity = await ctx.auth.getUserIdentity();
    await ctx.runMutation(internal.clientEmail._logMessage, {
      artistId, subject, body, channel, status, sentBy: identity?.subject,
    });
    return { ok: status !== "failed", channel };
  },
});

/** Internal - persist a sent message to the per-client thread. */
export const _logMessage = internalMutation({
  args: {
    artistId: v.id("artists"),
    subject: v.string(),
    body: v.string(),
    channel: v.union(v.literal("google"), v.literal("internal")),
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("simulated")),
    sentBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const artist = await ctx.db.get(args.artistId);
    if (!artist) return;
    await ctx.db.insert("clientMessages", {
      orgId: artist.orgId,
      artistId: args.artistId,
      direction: "out",
      subject: args.subject,
      body: args.body,
      channel: args.channel,
      status: args.status,
      sentBy: args.sentBy,
    });
    // Surface the email on the client's unified Timeline too (not just the
    // Messages thread), so the record shows every touch in one place.
    await ctx.db.insert("activity", {
      orgId: artist.orgId,
      kind: "client.email",
      summary: `Emailed: ${args.subject}`,
      entityType: "artist",
      entityId: args.artistId,
      accent: args.status === "failed" ? "critical" : "info",
    });
  },
});

/** Per-client message history (newest first). */
export const thread = query({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => {
    const orgId = await currentOrg(ctx);
    const artist = await ctx.db.get(artistId);
    if (!artist || artist.orgId !== orgId) return [];
    return (
      await ctx.db.query("clientMessages").withIndex("by_artist", (q) => q.eq("artistId", artistId)).collect()
    ).sort((a, b) => b._creationTime - a._creationTime);
  },
});

/** Internal - capability gate for client email (reuses artist edit rights). */
export const _assertCanEmail = internalQuery({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => {
    const orgId = await currentOrg(ctx);
    const artist = await ctx.db.get(artistId);
    if (!artist || artist.orgId !== orgId) throw new ConvexError("Client not found.");
    await requireCapability(ctx, "artists.edit", { orgId });
    return null;
  },
});
