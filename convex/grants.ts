import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./lib/access";
import { GUEST_SCOPE_CAPABILITIES, GUEST_SCOPE_DEFAULT_TTL_MS } from "./lib/accessPolicies";
import { assertWithinLimit, recordUsage } from "./usage";

/* ============================================================
   Magic-link guest grants. The studio issues a token-backed
   pass for a non-account collaborator (session bassist, sync
   supervisor, external mix engineer, artist on the portal).
   ============================================================ */

const scopeV = v.union(
  v.literal("session"),
  v.literal("song"),
  v.literal("deliverable"),
  v.literal("splitsheet"),
  v.literal("artist_portal"),
);

/** Generate a URL-safe random token. */
function makeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireCapability(ctx, "grants.issue");
    const orgId = "orgId" in viewer ? viewer.orgId : undefined;
    if (!orgId) return [];
    return await ctx.db
      .query("collaboratorGrants")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(50);
  },
});

export const issue = mutation({
  args: {
    scope: scopeV,
    entityId: v.string(),
    email: v.string(),
    name: v.string(),
    ttlMs: v.optional(v.number()),
    extraCapabilities: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const viewer = await requireCapability(ctx, "grants.issue");
    const orgId = "orgId" in viewer ? viewer.orgId : undefined;
    if (!orgId) throw new Error("issuing requires an active org");
    // Enforce the plan's monthly magic-link grant cap.
    await assertWithinLimit(ctx, orgId, "magic_links", 1);
    const ttl = args.ttlMs ?? GUEST_SCOPE_DEFAULT_TTL_MS[args.scope];
    const caps = [...GUEST_SCOPE_CAPABILITIES[args.scope], ...(args.extraCapabilities ?? [])];
    const id = await ctx.db.insert("collaboratorGrants", {
      orgId,
      agencyId: "agencyId" in viewer ? viewer.agencyId : undefined,
      email: args.email,
      name: args.name,
      scope: args.scope,
      entityId: args.entityId,
      capabilities: caps,
      token: makeToken(),
      expiresAt: Date.now() + ttl,
      invitedBy: "clerkUserId" in viewer ? viewer.clerkUserId : "system",
      useCount: 0,
    });
    await recordUsage(ctx, orgId, "magic_links", 1);
    return await ctx.db.get(id);
  },
});

export const revoke = mutation({
  args: { grantId: v.id("collaboratorGrants") },
  handler: async (ctx, { grantId }) => {
    await requireCapability(ctx, "grants.revoke");
    const g = await ctx.db.get(grantId);
    if (!g) throw new Error("grant not found");
    await ctx.db.patch(grantId, { revoked: true });
  },
});

/** Public lookup by token. Called by HTTP action that stamps a guest session. */
export const lookupByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const g = await ctx.db
      .query("collaboratorGrants")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!g || g.revoked || g.expiresAt < Date.now()) return null;
    return { _id: g._id, orgId: g.orgId, scope: g.scope, entityId: g.entityId, expiresAt: g.expiresAt };
  },
});

/** Internal - bumped on every successful guest-token use. */
export const markUsed = internalMutation({
  args: { grantId: v.id("collaboratorGrants") },
  handler: async (ctx, { grantId }) => {
    const g = await ctx.db.get(grantId);
    if (!g) return;
    await ctx.db.patch(grantId, {
      lastUsedAt: Date.now(),
      firstUsedAt: g.firstUsedAt ?? Date.now(),
      useCount: g.useCount + 1,
    });
  },
});
