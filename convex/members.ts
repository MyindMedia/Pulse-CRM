import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { currentOrg } from "./lib/tenant";
import { requireCapability } from "./lib/access";

const roleV = v.union(
  v.literal("owner"),
  v.literal("manager"),
  v.literal("engineer"),
  v.literal("assistant_engineer"),
  v.literal("artist_relations"),
  v.literal("producer"),
  v.literal("intern"),
  v.literal("accountant"),
);

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const withPhotos = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        photoUrl: r.photoId ? await ctx.storage.getUrl(r.photoId) : null,
      })),
    );
    return withPhotos.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Lightweight roster for engineer pickers. */
export const engineers = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows
      .map((r) => ({ _id: r._id, name: r.name, role: r.role, avatarColor: r.avatarColor }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    email: v.optional(v.string()),
    role: roleV,
    skills: v.optional(v.array(v.string())),
    capabilityOverrides: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const viewer = await requireCapability(ctx, "members.invite");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    return await ctx.db.insert("members", {
      orgId,
      name: args.name,
      email: args.email,
      role: args.role,
      skills: args.skills ?? [],
      capabilityOverrides: args.capabilityOverrides,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("members"),
    name: v.optional(v.string()),
    role: v.optional(roleV),
    skills: v.optional(v.array(v.string())),
    capabilityOverrides: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, ...patch }) => {
    const viewer = await requireCapability(ctx, "members.invite");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    const member = await ctx.db.get(id);
    if (!member || member.orgId !== orgId) throw new Error("Not found");
    if (member.role === "owner" && patch.role && patch.role !== "owner") {
      throw new Error("cannot demote owner");
    }
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(id, clean);
  },
});

export const remove = mutation({
  args: { id: v.id("members") },
  handler: async (ctx, { id }) => {
    const viewer = await requireCapability(ctx, "members.remove");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    const member = await ctx.db.get(id);
    if (!member || member.orgId !== orgId) throw new Error("Not found");
    if (member.role === "owner") throw new Error("cannot remove owner");
    await ctx.db.delete(id);
  },
});

/** Signed URL for uploading a team member's profile photo (org-gated). */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await currentOrg(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Attach an uploaded profile photo to a team member (same org only). */
export const setPhoto = mutation({
  args: { id: v.id("members"), storageId: v.id("_storage") },
  handler: async (ctx, { id, storageId }) => {
    const viewer = await requireCapability(ctx, "members.invite");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    const member = await ctx.db.get(id);
    if (!member || member.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { photoId: storageId });
  },
});

/** Remove a team member's uploaded photo. */
export const clearPhoto = mutation({
  args: { id: v.id("members") },
  handler: async (ctx, { id }) => {
    const viewer = await requireCapability(ctx, "members.invite");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    const member = await ctx.db.get(id);
    if (!member || member.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { photoId: undefined });
  },
});
