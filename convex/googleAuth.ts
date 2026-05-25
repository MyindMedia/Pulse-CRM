import { action, query, mutation, internalQuery, internalMutation } from "./_generated/server";
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

/** Internal — caller's orgId (auth propagates into runQuery). Used as OAuth state. */
export const _myOrgId = internalQuery({
  args: {},
  handler: async (ctx) => await currentOrg(ctx),
});

/** Internal — store the refresh token + connected email after OAuth callback. */
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
    return { url: googleAuthUrl(orgId) };
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
