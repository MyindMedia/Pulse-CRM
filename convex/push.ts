import { query, internalQuery } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { v } from "convex/values";
import { currentOrg } from "./lib/tenant";

/* ============================================================
   Web-push subscriptions - team devices (installed PWA or
   browser) register here; the T-10 sweep (pushAlerts.ts) fans
   alerts out through pushSend.ts. One row per device endpoint.
   ============================================================ */

/** The VAPID public key the browser needs to subscribe. Public by design. */
export const publicKey = query({
  args: {},
  handler: async () => process.env.VAPID_PUBLIC_KEY ?? null,
});

/** Register (or refresh) this device's push subscription. */
export const subscribe = mutation({
  args: {
    endpoint: v.string(),
    keys: v.object({ p256dh: v.string(), auth: v.string() }),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, { endpoint, keys, userAgent }) => {
    const orgId = await currentOrg(ctx);
    const identity = await ctx.auth.getUserIdentity();
    const clerkUserId = identity?.subject ?? "demo";
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { orgId, clerkUserId, keys, userAgent });
      return { updated: true };
    }
    await ctx.db.insert("pushSubscriptions", { orgId, clerkUserId, endpoint, keys, userAgent });
    return { updated: false };
  },
});

/** Remove this device's subscription (alerts toggled off). */
export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    await currentOrg(ctx);
    const row = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .first();
    if (row) await ctx.db.delete(row._id);
  },
});

/** Is this device endpoint registered? Drives the enable-alerts chip. */
export const isSubscribed = query({
  args: { endpoint: v.optional(v.string()) },
  handler: async (ctx, { endpoint }) => {
    if (!endpoint) return false;
    await currentOrg(ctx);
    const row = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .first();
    return Boolean(row);
  },
});

/** All device subscriptions for an org - the sender's fan-out list. */
export const _forOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) =>
    ctx.db
      .query("pushSubscriptions")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect(),
});

/** Prune a dead endpoint (push service said 404/410). */
export const _prune = internalMutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const row = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .first();
    if (row) await ctx.db.delete(row._id);
  },
});
