import { action, query, internalQuery } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { currentOrg } from "./lib/tenant";
import { googleConfigured, googleAuthUrl } from "./lib/google";

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
    };
  },
});

/** Internal - caller's orgId (auth propagates into runQuery). */
export const _myOrgId = internalQuery({
  args: {},
  handler: async (ctx) => await currentOrg(ctx),
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

/** Internal - store the refresh token + connected email after OAuth callback. */
export const _storeTokens = internalMutation({
  args: { orgId: v.string(), refreshToken: v.string(), email: v.optional(v.string()) },
  handler: async (ctx, { orgId, refreshToken, email }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (org) {
      await ctx.db.patch(org._id, {
        googleRefreshToken: refreshToken,
        googleEmail: email,
        googleConnectedAt: Date.now(),
        emailProvider: "google",
      });
    }
  },
});

/** Build the Google consent URL to redirect the studio owner to. */
export const authUrl = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    if (!googleConfigured()) {
      throw new ConvexError("Google connect isn’t configured yet. Ask your admin to set it up.");
    }
    const orgId = await ctx.runQuery(internal.googleAuth._myOrgId, {});
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
    const orgId = await currentOrg(ctx);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (org) {
      await ctx.db.patch(org._id, {
        googleRefreshToken: undefined,
        googleEmail: undefined,
        googleConnectedAt: undefined,
        emailProvider: "internal",
      });
    }
  },
});
