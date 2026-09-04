import { query } from "./_generated/server";
import { mutation } from "./functions";
import { v } from "convex/values";
import { requireCapability, resolveViewer } from "./lib/access";
import { normalizeEmail } from "./lib/emailKey";

/* ============================================================
   Agency staff CRUD + scope assignment. All mutations gated by
   agency.staff.* capabilities - see access-policies.
   ============================================================ */

const agencyRoleV = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("staff"),
  v.literal("billing"),
);

export const list = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await resolveViewer(ctx).catch(() => null);
    if (!viewer || viewer.kind !== "agency_member" || !viewer.capabilities.has("agency.viewAll")) {
      return [];
    }
    const rows = await ctx.db
      .query("agencyMembers")
      .withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId))
      .collect();
    return await Promise.all(
      rows.map(async (m) => ({
        ...m,
        title: m.title ?? null,
        phone: m.phone ?? null,
        photoUrl: m.photoStorageId
          ? await ctx.storage.getUrl(m.photoStorageId)
          : (m.clerkImageUrl ?? null),
      })),
    );
  },
});

export const invite = mutation({
  args: {
    email: v.string(),
    name: v.string(),
    role: agencyRoleV,
    title: v.optional(v.string()),
    capabilityOverrides: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const viewer = await requireCapability(ctx, "agency.staff.invite");
    if (viewer.kind !== "agency_member") throw new Error("agency only");
    // Stub clerkUserId until a Clerk invitation lands the real one.
    const stub = `pending_${args.email.replace(/[^a-z0-9]/g, "_")}`;
    const id = await ctx.db.insert("agencyMembers", {
      agencyId: viewer.agencyId,
      clerkUserId: stub,
      email: normalizeEmail(args.email),
      name: args.name,
      role: args.role,
      title: args.title?.trim() || undefined,
      capabilityOverrides: args.capabilityOverrides,
      status: "invited",
      invitedAt: Date.now(),
    });
    return await ctx.db.get(id);
  },
});

export const setRole = mutation({
  args: {
    memberId: v.id("agencyMembers"),
    role: agencyRoleV,
    capabilityOverrides: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { memberId, role, capabilityOverrides }) => {
    const viewer = await requireCapability(ctx, "agency.staff.invite");
    if (viewer.kind !== "agency_member") throw new Error("agency only");
    const m = await ctx.db.get(memberId);
    if (!m || m.agencyId !== viewer.agencyId) throw new Error("not found");
    if (m.role === "owner" && role !== "owner") throw new Error("cannot demote owner");
    await ctx.db.patch(memberId, { role, capabilityOverrides });
  },
});

export const remove = mutation({
  args: { memberId: v.id("agencyMembers") },
  handler: async (ctx, { memberId }) => {
    const viewer = await requireCapability(ctx, "agency.staff.invite");
    if (viewer.kind !== "agency_member") throw new Error("agency only");
    const m = await ctx.db.get(memberId);
    if (!m || m.agencyId !== viewer.agencyId) throw new Error("not found");
    if (m.role === "owner") throw new Error("cannot remove owner");
    // Cascade scopes
    const scopes = await ctx.db
      .query("agencyMemberScopes")
      .withIndex("by_member", (q) => q.eq("agencyMemberId", memberId))
      .collect();
    for (const s of scopes) await ctx.db.delete(s._id);
    await ctx.db.delete(memberId);
  },
});

export const scopes = query({
  args: { memberId: v.id("agencyMembers") },
  handler: async (ctx, { memberId }) => {
    const viewer = await resolveViewer(ctx).catch(() => null);
    if (!viewer || viewer.kind !== "agency_member" || !viewer.capabilities.has("agency.viewAll")) {
      return [];
    }
    return await ctx.db
      .query("agencyMemberScopes")
      .withIndex("by_member", (q) => q.eq("agencyMemberId", memberId))
      .collect();
  },
});

export const setScopes = mutation({
  args: {
    memberId: v.id("agencyMembers"),
    subAccountOrgIds: v.array(v.string()),
  },
  handler: async (ctx, { memberId, subAccountOrgIds }) => {
    const viewer = await requireCapability(ctx, "agency.staff.scope");
    if (viewer.kind !== "agency_member") throw new Error("agency only");
    const m = await ctx.db.get(memberId);
    if (!m || m.agencyId !== viewer.agencyId) throw new Error("not found");
    // Replace all scopes
    const existing = await ctx.db
      .query("agencyMemberScopes")
      .withIndex("by_member", (q) => q.eq("agencyMemberId", memberId))
      .collect();
    for (const s of existing) await ctx.db.delete(s._id);
    for (const subAccountOrgId of subAccountOrgIds) {
      await ctx.db.insert("agencyMemberScopes", {
        agencyId: viewer.agencyId,
        agencyMemberId: memberId,
        subAccountOrgId,
      });
    }
  },
});
