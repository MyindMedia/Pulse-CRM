import { query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/* ============================================================
   Beta studio-owner invitations. A token-backed row maps to an
   org + invited email; the branded email links to /invite/<token>.
   ============================================================ */

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function makeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Internal - insert an invite row. Returns the token. */
export const record = internalMutation({
  args: {
    orgId: v.string(),
    clerkOrgId: v.optional(v.string()),
    agencyId: v.optional(v.string()),
    email: v.string(),
    ownerName: v.string(),
    studioName: v.string(),
    invitedBy: v.string(),
    emailStatus: v.union(v.literal("sent"), v.literal("failed"), v.literal("simulated")),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const token = makeToken();
    await ctx.db.insert("invites", {
      orgId: args.orgId,
      clerkOrgId: args.clerkOrgId,
      agencyId: args.agencyId,
      email: args.email.toLowerCase(),
      ownerName: args.ownerName,
      studioName: args.studioName,
      role: "owner",
      token,
      status: "pending",
      expiresAt: Date.now() + (args.ttlMs ?? DEFAULT_TTL_MS),
      invitedBy: args.invitedBy,
      emailStatus: args.emailStatus,
    });
    return token;
  },
});

/** Internal - full row by token (used by the accept action). */
export const _byToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) =>
    await ctx.db.query("invites").withIndex("by_token", (q) => q.eq("token", token)).first(),
});

/** Public - sanitized lookup for the invite screen. No auth. */
export const lookupByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const inv = await ctx.db.query("invites").withIndex("by_token", (q) => q.eq("token", token)).first();
    if (!inv) return { state: "invalid" as const };
    if (inv.status === "revoked") return { state: "invalid" as const };
    if (inv.status === "accepted") return { state: "accepted" as const, email: inv.email };
    if (inv.expiresAt < Date.now()) return { state: "expired" as const };
    return {
      state: "valid" as const,
      email: inv.email,
      ownerName: inv.ownerName,
      studioName: inv.studioName,
    };
  },
});
