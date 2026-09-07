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

/* ============================================================
   Apple push - the native apps.

   Same idea as the web subscriptions above and a separate table, because the
   two transports have nothing in common but the word "push": web push is an
   endpoint URL and two encryption keys, APNs is an opaque device token and a
   topic.

   The token is the key. iOS issues a new one when the app is reinstalled or
   restored onto another device, so registering the same token twice is an
   update and never a duplicate row.
   ============================================================ */

export const registerApns = mutation({
  args: {
    token: v.string(),
    bundleId: v.string(),
    environment: v.union(v.literal("sandbox"), v.literal("production")),
    deviceName: v.optional(v.string()),
    localClock: v.optional(v.boolean()),
  },
  handler: async (ctx, { token, bundleId, environment, deviceName, localClock }) => {
    const orgId = await currentOrg(ctx);
    const identity = await ctx.auth.getUserIdentity();
    const clerkUserId = identity?.subject ?? "demo";
    const now = Date.now();

    const existing = await ctx.db
      .query("apnsDevices")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        orgId, clerkUserId, bundleId, environment, deviceName, localClock, lastSeenAt: now,
      });
      return { updated: true };
    }
    await ctx.db.insert("apnsDevices", {
      orgId, clerkUserId, token, bundleId, environment, deviceName, localClock, lastSeenAt: now,
    });
    return { updated: false };
  },
});

/** Stop pushing to this device - alerts turned off, or signing out. */
export const unregisterApns = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const row = await ctx.db
      .query("apnsDevices")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (row) await ctx.db.delete(row._id);
    return { removed: row !== null };
  },
});

export const _apnsForOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) =>
    await ctx.db
      .query("apnsDevices")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect(),
});

/** Drop a token Apple has told us is dead (410 Unregistered). */
export const _pruneApns = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const row = await ctx.db
      .query("apnsDevices")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (row) await ctx.db.delete(row._id);
  },
});
