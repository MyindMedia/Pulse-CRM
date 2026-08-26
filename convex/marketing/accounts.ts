import { action, mutation, query, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { currentOrgWithCapability, currentActor } from "../lib/tenant";
import { assertWithinLimit, recordUsage } from "../usage";
import { ghlFromEnv, startOAuth, listOAuthAccounts, attachOAuthAccount, PLATFORMS, type Platform } from "../lib/ghl";

const platformArg = v.union(...PLATFORMS.map((p) => v.literal(p)));

/** Org doc + GHL override for actions (they have no ctx.db). */
export const orgContext = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return org ? { orgId: org.orgId, slug: org.slug, name: org.name, ghl: org.ghl ?? undefined } : null;
  },
});

export const startConnect = action({
  args: { platform: platformArg, reconnect: v.optional(v.boolean()) },
  handler: async (ctx, { platform, reconnect }): Promise<{ url: string } | { simulated: true }> => {
    const orgId = await ctx.runQuery(api.marketing.accounts.myOrgForConnect, {});
    // A fresh connect needs a new slot; a reconnect of an account the org
    // already owns does not, so only gate the fresh-connect path here.
    if (!reconnect) {
      await ctx.runQuery(internal.usage.checkLimit, { orgId, metric: "social_accounts", add: 1 });
    }
    const org = await ctx.runQuery(internal.marketing.accounts.orgContext, { orgId });
    const g = ghlFromEnv(org);
    if (!g) return { simulated: true };
    const r = await startOAuth(g, platform as Platform, reconnect ?? false);
    if (!r) throw new ConvexError({ code: "GHL_UNAVAILABLE", message: "Could not start the connection. Try again in a minute." });
    return r;
  },
});

/** Capability check for the connect flow, callable from an action. Cap
 *  enforcement is NOT here: a reconnect of an already-owned account needs no
 *  new slot, so the cap check lives in startConnect (fresh connects only)
 *  and insertInternal (fresh inserts only). */
export const myOrgForConnect = query({
  args: {},
  handler: async (ctx) => {
    return await currentOrgWithCapability(ctx, "marketing.approve");
  },
});

export const choices = action({
  args: { platform: platformArg, ghlAccountId: v.string() },
  handler: async (ctx, { platform, ghlAccountId }) => {
    const orgId = await ctx.runQuery(api.marketing.accounts.myOrgForConnect, {});
    const org = await ctx.runQuery(internal.marketing.accounts.orgContext, { orgId });
    const g = ghlFromEnv(org);
    if (!g) return [{ id: ghlAccountId, name: "Simulated account" }];
    try {
      return await listOAuthAccounts(g, platform as Platform, ghlAccountId);
    } catch {
      throw new ConvexError({ code: "GHL_UNAVAILABLE", message: "Could not read the connected account. Reconnect and try again." });
    }
  },
});

export const attach = action({
  args: { platform: platformArg, ghlAccountId: v.string(), choice: v.object({ id: v.string(), name: v.string(), type: v.optional(v.string()) }) },
  handler: async (ctx, { platform, ghlAccountId, choice }): Promise<Id<"socialAccounts">> => {
    const orgId = await ctx.runQuery(api.marketing.accounts.myOrgForConnect, {});
    const org = await ctx.runQuery(internal.marketing.accounts.orgContext, { orgId });
    const g = ghlFromEnv(org);
    let attached: { id: string; name: string; avatar?: string } = { id: ghlAccountId, name: choice.name };
    if (g) {
      const r = await attachOAuthAccount(g, platform as Platform, ghlAccountId, choice);
      if (!r) throw new ConvexError({ code: "GHL_ATTACH_FAILED", message: "The account could not be attached. Reconnect and try again." });
      attached = r;
    }
    const actor = await ctx.runQuery(api.marketing.accounts.whoAmI, {});
    return await ctx.runMutation(internal.marketing.accounts.insertInternal, {
      orgId, platform, ghlAccountId: attached.id, ghlLocationId: g?.locationId ?? "simulated",
      name: attached.name, avatarUrl: attached.avatar, connectedBy: actor,
    });
  },
});

export const whoAmI = query({ args: {}, handler: async (ctx) => currentActor(ctx) });

export const insertInternal = internalMutation({
  args: {
    orgId: v.string(), platform: platformArg, ghlAccountId: v.string(), ghlLocationId: v.string(),
    name: v.string(), avatarUrl: v.optional(v.string()), connectedBy: v.string(),
  },
  handler: async (ctx, args) => {
    // Invariant: one GHL account belongs to exactly one org, forever.
    const owned = await ctx.db.query("socialAccounts").withIndex("by_ghl_account", (q) => q.eq("ghlAccountId", args.ghlAccountId)).first();
    if (owned && owned.orgId !== args.orgId) {
      throw new ConvexError({ code: "ACCOUNT_TAKEN", message: "That profile is already connected to another studio." });
    }
    if (owned) {
      // Only a row that was actually removed freed its slot; reviving a
      // needs_reconnect or already-connected row must not touch usage, and
      // reviving a removed row must re-claim a slot under the cap (a
      // remove-then-reattach loop must never bypass the cap).
      const wasRemoved = owned.status === "removed";
      if (wasRemoved) {
        await assertWithinLimit(ctx, args.orgId, "social_accounts", 1);
      }
      await ctx.db.patch(owned._id, { status: "connected", name: args.name, avatarUrl: args.avatarUrl, lastCheckedAt: Date.now() });
      if (wasRemoved) {
        await recordUsage(ctx, args.orgId, "social_accounts", 1);
      }
      return owned._id;
    }
    await assertWithinLimit(ctx, args.orgId, "social_accounts", 1);
    const id = await ctx.db.insert("socialAccounts", { ...args, status: "connected", connectedAt: Date.now() });
    await recordUsage(ctx, args.orgId, "social_accounts", 1);
    return id;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.read");
    const rows = await ctx.db.query("socialAccounts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    return rows.filter((r) => r.status !== "removed").map((r) => ({
      _id: r._id, platform: r.platform, name: r.name, avatarUrl: r.avatarUrl, status: r.status, stats: r.stats, connectedAt: r.connectedAt,
    }));
  },
});

export const remove = mutation({
  args: { id: v.id("socialAccounts") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.approve");
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { status: "removed" });
    await recordUsage(ctx, orgId, "social_accounts", -1);
  },
});

/** GHL account ids currently connected for an org, for the status-sync
 *  action (which has no ctx.db and cannot filter by org itself). */
export const ghlAccountIdsForOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db.query("socialAccounts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    return rows.filter((r) => r.status !== "removed").map((r) => r.ghlAccountId);
  },
});
