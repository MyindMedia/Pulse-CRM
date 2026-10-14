import { action, query, internalQuery } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { currentOrg } from "./lib/tenant";
import { SETUP_ACCESS } from "./lib/access";
import { googleConfigured, googleAuthUrl, RECONNECT_REQUIRED } from "./lib/google";

/* Google account connect (P4). Studios link their Google account so client
   email sends as their real Gmail. OAuth callback is handled in http.ts. */

export const status = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return {
      configured: googleConfigured(),
      connected: Boolean(org?.googleRefreshToken),
      email: org?.googleEmail ?? null,
      needsReconnect: !org?.googleRefreshToken && org?.googleCalendarSyncError === RECONNECT_REQUIRED,
    };
  },
});

/** Internal - caller's orgId (auth propagates into runQuery). */
export const _myOrgId = internalQuery({
  args: {},
  handler: async (ctx) => await currentOrg(ctx),
});

/** Internal - caller's orgId for the connect flow, which is also a step of the
 *  setup wizard (SETUP_ACCESS, lib/access.ts). */
export const _mySetupOrgId = internalQuery({
  args: {},
  handler: async (ctx) => await currentOrg(ctx, SETUP_ACCESS),
});

/** Internal - mint a single-use OAuth state nonce bound to an org (CSRF guard).
 *  10-minute TTL; old nonces for the org are cleared so they don't accumulate. */
export const _createOAuthState = internalMutation({
  args: { orgId: v.string(), nonce: v.string() },
  handler: async (ctx, { orgId, nonce }) => {
    await ctx.db.insert("oauthStates", { nonce, orgId, expiresAt: Date.now() + 10 * 60_000 });
  },
});

/** Internal - validate + consume an OAuth state nonce, returning its org or null
 *  (when missing, expired, or already used). Single-use: deleted on read. */
export const _consumeOAuthState = internalMutation({
  args: { nonce: v.string() },
  handler: async (ctx, { nonce }): Promise<string | null> => {
    const row = await ctx.db.query("oauthStates").withIndex("by_nonce", (q) => q.eq("nonce", nonce)).first();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (row.expiresAt < Date.now()) return null;
    return row.orgId;
  },
});

/* The state row carries the level without a schema change: a team member's
   connect stores `<orgId>::member::<memberId>` in the org column. */
const MEMBER_MARK = "::member::";

export function encodeMemberState(orgId: string, memberId: string): string {
  return `${orgId}${MEMBER_MARK}${memberId}`;
}

export function decodeState(raw: string): { orgId: string; memberId: string | null } {
  const i = raw.indexOf(MEMBER_MARK);
  if (i < 0) return { orgId: raw, memberId: null };
  return { orgId: raw.slice(0, i), memberId: raw.slice(i + MEMBER_MARK.length) };
}

/** Internal - mint a single-use state nonce for a team member's own connect. */
export const _createMemberOAuthState = internalMutation({
  args: { orgId: v.string(), memberId: v.string(), nonce: v.string() },
  handler: async (ctx, { orgId, memberId, nonce }) => {
    await ctx.db.insert("oauthStates", {
      nonce,
      orgId: encodeMemberState(orgId, memberId),
      expiresAt: Date.now() + 10 * 60_000,
    });
  },
});

/** Internal - consume a nonce of either level. Null when missing, expired or
 *  already used; otherwise the org and, for a member connect, the member. */
export const _consumeState = internalMutation({
  args: { nonce: v.string() },
  handler: async (ctx, { nonce }): Promise<{ orgId: string; memberId: string | null } | null> => {
    const row = await ctx.db.query("oauthStates").withIndex("by_nonce", (q) => q.eq("nonce", nonce)).first();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (row.expiresAt < Date.now()) return null;
    return decodeState(row.orgId);
  },
});

/** Internal - store the refresh token + connected email after OAuth callback. */
export const _storeTokens = internalMutation({
  args: { orgId: v.string(), refreshToken: v.string(), email: v.optional(v.string()) },
  handler: async (ctx, { orgId, refreshToken, email }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (org) {
      // A different Google account has different calendars: forget the old pick.
      const sameAccount = !org.googleEmail || !email || org.googleEmail === email;
      await ctx.db.patch(org._id, {
        googleRefreshToken: refreshToken,
        googleEmail: email ?? org.googleEmail,
        googleConnectedAt: Date.now(),
        emailProvider: "google",
        googleCalendarSyncToken: undefined,
        googleCalendarSyncError: undefined,
        googleCalendarPushError: undefined,
        googleCalendarPushErrorAt: undefined,
        ...(sameAccount ? {} : { googleCalendarId: undefined, googleCalendarName: undefined }),
      });
    }
  },
});

/** Internal - Google refused the stored token (invalid_grant). Clear it so
 *  nothing keeps retrying, fall email back to the internal channel, and leave
 *  a marker the settings card turns into "Reconnect Google". */
export const _markReconnect = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org?.googleRefreshToken) return;
    await ctx.db.patch(org._id, {
      googleRefreshToken: undefined,
      googleCalendarSyncToken: undefined,
      googleCalendarSyncError: RECONNECT_REQUIRED,
      googleCalendarPushError: undefined,
      googleCalendarPushErrorAt: undefined,
      ...(org.emailProvider === "google" ? { emailProvider: "internal" as const } : {}),
    });
  },
});

/** Build the Google consent URL to redirect the studio owner to. */
export const authUrl = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    if (!googleConfigured()) {
      throw new ConvexError("Google connect isn’t configured yet. Ask your admin to set it up.");
    }
    const orgId = await ctx.runQuery(internal.googleAuth._mySetupOrgId, {});
    // CSRF: use a random single-use nonce as the OAuth `state` (not the raw
    // orgId), bound server-side to this org, so the callback can't be forged to
    // attach a different Google account to this (or another) org.
    const nonce = crypto.randomUUID();
    await ctx.runMutation(internal.googleAuth._createOAuthState, { orgId, nonce });
    return { url: googleAuthUrl(nonce) };
  },
});

/** Disconnect Google; fall back to the internal email channel. */
export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx, SETUP_ACCESS);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (org) {
      await ctx.db.patch(org._id, {
        googleRefreshToken: undefined,
        googleEmail: undefined,
        googleConnectedAt: undefined,
        emailProvider: "internal",
        googleCalendarSyncToken: undefined,
        googleCalendarSyncError: undefined,
        googleCalendarPushError: undefined,
        googleCalendarPushErrorAt: undefined,
      });
    }
  },
});
