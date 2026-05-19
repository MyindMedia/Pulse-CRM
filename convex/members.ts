import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { currentOrg } from "./lib/tenant";

const roleV = v.union(v.literal("owner"), v.literal("manager"), v.literal("engineer"));

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
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
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);
    return await ctx.db.insert("members", {
      orgId,
      name: args.name,
      email: args.email,
      role: args.role,
      skills: args.skills ?? [],
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("members"),
    name: v.optional(v.string()),
    role: v.optional(roleV),
    skills: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrg(ctx);
    const member = await ctx.db.get(id);
    if (!member || member.orgId !== orgId) throw new Error("Not found");
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(id, clean);
  },
});

export const remove = mutation({
  args: { id: v.id("members") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const member = await ctx.db.get(id);
    if (!member || member.orgId !== orgId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
