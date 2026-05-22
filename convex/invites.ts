import { mutation, query, action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireCapability } from "./lib/access";

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

/** Internal - attach the new Clerk user to the seeded owner member + flip status. */
export const markAccepted = internalMutation({
  args: { inviteId: v.id("invites"), clerkUserId: v.string() },
  handler: async (ctx, { inviteId, clerkUserId }) => {
    const inv = await ctx.db.get(inviteId);
    if (!inv) throw new Error("invite not found");
    if (inv.status === "accepted") throw new Error("invite already accepted");

    const member = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", inv.orgId))
      .filter((q) => q.eq(q.field("email"), inv.email))
      .first();
    if (member) await ctx.db.patch(member._id, { clerkUserId });

    await ctx.db.patch(inviteId, { status: "accepted", acceptedAt: Date.now() });
  },
});

/** Public action - create the Clerk user, add to the org, attach the member.
 *  Called by the invite screen with the password the user chose. */
type AcceptResult =
  | { ok: true; email: string }
  | {
      ok: false;
      reason: "invalid" | "accepted" | "expired" | "not_configured" | "exists" | "clerk_error";
      detail?: string;
    };

export const accept = action({
  args: { token: v.string(), name: v.string(), password: v.string() },
  handler: async (ctx, args): Promise<AcceptResult> => {
    const inv = await ctx.runQuery(internal.invites._byToken, { token: args.token });
    if (!inv || inv.status === "revoked") return { ok: false as const, reason: "invalid" as const };
    if (inv.status === "accepted") return { ok: false as const, reason: "accepted" as const };
    if (inv.expiresAt < Date.now()) return { ok: false as const, reason: "expired" as const };

    const secret = process.env.CLERK_SECRET_KEY;
    if (!secret) return { ok: false as const, reason: "not_configured" as const };

    const [firstName, ...rest] = args.name.trim().split(" ");
    const lastName = rest.join(" ");

    // 1. Create the user (backend-created emails are verified - no code step).
    const userRes = await fetch("https://api.clerk.com/v1/users", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email_address: [inv.email],
        password: args.password,
        first_name: firstName || undefined,
        last_name: lastName || undefined,
      }),
    });
    if (!userRes.ok) {
      // Parse Clerk's structured error; never return the raw body (it can echo
      // the email / internal codes back to an unauthenticated caller).
      const body = await userRes.text();
      let code = "";
      let safeMsg = "Account creation failed.";
      try {
        const parsed = JSON.parse(body) as { errors?: { code?: string; message?: string }[] };
        code = parsed.errors?.[0]?.code ?? "";
        safeMsg = parsed.errors?.[0]?.message ?? safeMsg;
      } catch {
        // non-JSON body; keep the generic message
      }
      if (code === "form_identifier_exists" || /already exists|taken|duplicate/i.test(body)) {
        return { ok: false as const, reason: "exists" as const };
      }
      return { ok: false as const, reason: "clerk_error" as const, detail: safeMsg };
    }
    const user = (await userRes.json()) as { id: string };

    // 2. Add to the Clerk org as admin (non-fatal if no clerk org).
    if (inv.clerkOrgId) {
      await fetch(`https://api.clerk.com/v1/organizations/${inv.clerkOrgId}/memberships`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id, role: "org:admin" }),
      }).catch(() => undefined);
    }

    // 3. Attach to the Convex member row + flip status.
    await ctx.runMutation(internal.invites.markAccepted, { inviteId: inv._id, clerkUserId: user.id });

    return { ok: true as const, email: inv.email };
  },
});

/** Internal - update the emailStatus field after a send attempt. */
export const setEmailStatus = internalMutation({
  args: {
    token: v.string(),
    emailStatus: v.union(v.literal("sent"), v.literal("failed"), v.literal("simulated")),
  },
  handler: async (ctx, { token, emailStatus }) => {
    const inv = await ctx.db.query("invites").withIndex("by_token", (q) => q.eq("token", token)).first();
    if (inv) await ctx.db.patch(inv._id, { emailStatus });
  },
});

/** Agency console - list invites for a sub-account. */
export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireCapability(ctx, "agency.subaccount.pause", { orgId });
    return await ctx.db.query("invites").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(20);
  },
});

/** Agency console - revoke a pending invite. */
export const revoke = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, { inviteId }) => {
    const inv = await ctx.db.get(inviteId);
    if (!inv) throw new Error("invite not found");
    await requireCapability(ctx, "agency.subaccount.pause", { orgId: inv.orgId });
    await ctx.db.patch(inviteId, { status: "revoked" });
  },
});
