import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { currentOrg } from "./lib/tenant";

const statusV = v.union(
  v.literal("draft"),
  v.literal("sent"),
  v.literal("viewed"),
  v.literal("paid"),
  v.literal("overdue"),
  v.literal("void"),
);

/** Flip "sent"/"viewed" rows to "overdue" when read past their due date. */
function effectiveStatus(inv: { status: string; dueDate: number }): string {
  if ((inv.status === "sent" || inv.status === "viewed") && inv.dueDate < Date.now()) {
    return "overdue";
  }
  return inv.status;
}

export const list = query({
  args: { status: v.optional(statusV) },
  handler: async (ctx, { status }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("invoices")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const artistIds = [...new Set(rows.map((r) => r.artistId))];
    const artists = new Map(
      (await Promise.all(artistIds.map((id) => ctx.db.get(id))))
        .filter(Boolean)
        .map((a) => [a!._id, a!]),
    );
    const hydrated = rows.map((r) => ({
      ...r,
      status: effectiveStatus(r),
      artistName: artists.get(r.artistId)?.name ?? "Unknown",
    }));
    const filtered = status ? hydrated.filter((r) => r.status === status) : hydrated;
    return filtered.sort((a, b) => b._creationTime - a._creationTime);
  },
});

export const get = query({
  args: { id: v.id("invoices") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const inv = await ctx.db.get(id);
    if (!inv || inv.orgId !== orgId) return null;
    const [artist, song, session] = await Promise.all([
      ctx.db.get(inv.artistId),
      inv.songId ? ctx.db.get(inv.songId) : null,
      inv.sessionId ? ctx.db.get(inv.sessionId) : null,
    ]);
    return {
      ...inv,
      status: effectiveStatus(inv),
      artist,
      songTitle: song?.title ?? null,
      sessionTitle: session?.title ?? null,
    };
  },
});

/** Money summary for the Payments dashboard. */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("invoices")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    let outstanding = 0;
    let overdue = 0;
    let collectedThisMonth = 0;
    let draftValue = 0;
    for (const r of rows) {
      const status = effectiveStatus(r);
      if (status === "sent" || status === "viewed") outstanding += r.amountCents;
      if (status === "overdue") {
        outstanding += r.amountCents;
        overdue += r.amountCents;
      }
      if (status === "draft") draftValue += r.amountCents;
      if (status === "paid" && r.paidAt && r.paidAt >= monthStart.getTime()) {
        collectedThisMonth += r.amountCents;
      }
    }
    return { outstanding, overdue, collectedThisMonth, draftValue, count: rows.length };
  },
});

export const create = mutation({
  args: {
    artistId: v.id("artists"),
    songId: v.optional(v.id("songs")),
    sessionId: v.optional(v.id("sessions")),
    lineItems: v.array(v.object({ label: v.string(), amountCents: v.number() })),
    dueDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);
    const artist = await ctx.db.get(args.artistId);
    if (!artist || artist.orgId !== orgId) throw new Error("Artist not found");
    const amountCents = args.lineItems.reduce((s, li) => s + li.amountCents, 0);
    const number = `PLS-${String(Date.now()).slice(-6)}`;
    const id = await ctx.db.insert("invoices", {
      orgId,
      number,
      artistId: args.artistId,
      songId: args.songId,
      sessionId: args.sessionId,
      status: "draft",
      lineItems: args.lineItems,
      amountCents,
      dueDate: args.dueDate ?? Date.now() + 14 * 86400000,
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "invoice.created",
      summary: `Invoice ${number} drafted for ${artist.name}`,
      entityType: "invoice",
      entityId: id,
      accent: "info",
    });
    return id;
  },
});

export const setStatus = mutation({
  args: { id: v.id("invoices"), status: statusV },
  handler: async (ctx, { id, status }) => {
    const orgId = await currentOrg(ctx);
    const inv = await ctx.db.get(id);
    if (!inv || inv.orgId !== orgId) throw new Error("Not found");

    const patch: Record<string, unknown> = { status };
    if (status === "paid") patch.paidAt = Date.now();
    await ctx.db.patch(id, patch);

    if (status === "paid") {
      const artist = await ctx.db.get(inv.artistId);
      await ctx.db.insert("activity", {
        orgId,
        kind: "invoice.paid",
        summary: `${inv.number} paid in full by ${artist?.name ?? "client"}`,
        entityType: "invoice",
        entityId: id,
        accent: "positive",
      });
    } else if (status === "sent") {
      await ctx.db.insert("activity", {
        orgId,
        kind: "invoice.sent",
        summary: `Invoice ${inv.number} sent`,
        entityType: "invoice",
        entityId: id,
        accent: "info",
      });
    }
  },
});

export const remove = mutation({
  args: { id: v.id("invoices") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const inv = await ctx.db.get(id);
    if (!inv || inv.orgId !== orgId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
