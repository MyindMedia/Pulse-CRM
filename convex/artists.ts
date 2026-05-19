import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { currentOrg } from "./lib/tenant";

const artistTypeV = v.union(
  v.literal("artist"),
  v.literal("producer"),
  v.literal("band"),
  v.literal("label"),
  v.literal("songwriter"),
  v.literal("other"),
);
const statusV = v.union(v.literal("lead"), v.literal("active"), v.literal("dormant"), v.literal("vip"));

export const list = query({
  args: { status: v.optional(statusV), search: v.optional(v.string()) },
  handler: async (ctx, { status, search }) => {
    const orgId = await currentOrg(ctx);
    let rows;
    if (search && search.trim()) {
      rows = await ctx.db
        .query("artists")
        .withSearchIndex("search_name", (q) => q.search("name", search).eq("orgId", orgId))
        .take(60);
    } else if (status) {
      rows = await ctx.db
        .query("artists")
        .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", status))
        .collect();
    } else {
      rows = await ctx.db
        .query("artists")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();
    }
    return rows.sort((a, b) => b.lifetimeValueCents - a.lifetimeValueCents);
  },
});

export const roster = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("artists")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows
      .map((r) => ({ _id: r._id, name: r.name, type: r.type, avatarColor: r.avatarColor }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const get = query({
  args: { id: v.id("artists") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const artist = await ctx.db.get(id);
    if (!artist || artist.orgId !== orgId) return null;

    const [songs, sessions, invoices] = await Promise.all([
      ctx.db.query("songs").withIndex("by_org_artist", (q) => q.eq("orgId", orgId).eq("artistId", id)).collect(),
      ctx.db.query("sessions").withIndex("by_artist", (q) => q.eq("artistId", id)).collect(),
      ctx.db.query("invoices").withIndex("by_artist", (q) => q.eq("artistId", id)).collect(),
    ]);

    const outstanding = invoices
      .filter((i) => i.status === "sent" || i.status === "viewed" || i.status === "overdue")
      .reduce((s, i) => s + i.amountCents, 0);

    return { ...artist, songs, sessions, invoices, outstandingCents: outstanding };
  },
});

export const counts = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    return {
      total: rows.length,
      lead: rows.filter((r) => r.status === "lead").length,
      active: rows.filter((r) => r.status === "active").length,
      vip: rows.filter((r) => r.status === "vip").length,
      dormant: rows.filter((r) => r.status === "dormant").length,
    };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    type: artistTypeV,
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    location: v.optional(v.string()),
    genres: v.optional(v.array(v.string())),
    status: v.optional(statusV),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);
    const id = await ctx.db.insert("artists", {
      orgId,
      name: args.name,
      type: args.type,
      email: args.email,
      phone: args.phone,
      location: args.location,
      genres: args.genres ?? [],
      tags: [],
      status: args.status ?? "lead",
      lifetimeValueCents: 0,
      sessionCount: 0,
      reliability: "solid",
      lastContactAt: Date.now(),
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "artist.created",
      summary: `${args.name} added to the roster`,
      entityType: "artist",
      entityId: id,
      accent: "gold",
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("artists"),
    name: v.optional(v.string()),
    status: v.optional(statusV),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    reliability: v.optional(v.union(v.literal("solid"), v.literal("watch"), v.literal("flagged"))),
    instagram: v.optional(v.string()),
    spotify: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrg(ctx);
    const artist = await ctx.db.get(id);
    if (!artist || artist.orgId !== orgId) throw new Error("Not found");
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    await ctx.db.patch(id, clean);
  },
});

export const remove = mutation({
  args: { id: v.id("artists") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const artist = await ctx.db.get(id);
    if (!artist || artist.orgId !== orgId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
