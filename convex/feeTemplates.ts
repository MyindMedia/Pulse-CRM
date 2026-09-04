import { query } from "./_generated/server";
import { mutation } from "./functions";
import { v, ConvexError } from "convex/values";
import { currentOrg } from "./lib/tenant";
import { requireCapability } from "./lib/access";

/* ============================================================
   Fee templates - reusable flat charges (mix/master per song,
   annual maintenance, etc.) a studio can quick-add as invoice
   line items. Tenant-scoped; invoice lines stay plain
   {label, amountCents} - these are just the saved presets.
   ============================================================ */

/** Saved fees for the current studio, alphabetical. */
export const list = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, { activeOnly }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "invoices.read", { orgId });
    const rows = await ctx.db
      .query("feeTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows
      .filter((f) => (activeOnly ? f.active : true))
      .sort((a, b) => a.label.localeCompare(b.label));
  },
});

export const create = mutation({
  args: {
    label: v.string(),
    amountCents: v.number(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "invoices.send", { orgId });
    const label = args.label.trim();
    if (!label) throw new ConvexError("Give the fee a name.");
    if (!Number.isFinite(args.amountCents) || args.amountCents <= 0) {
      throw new ConvexError("Amount must be positive.");
    }
    return ctx.db.insert("feeTemplates", {
      orgId,
      label,
      amountCents: Math.round(args.amountCents),
      description: args.description?.trim() || undefined,
      active: true,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("feeTemplates"),
    label: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    description: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "invoices.send", { orgId });
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new ConvexError("Fee not found.");
    const clean: Record<string, unknown> = {};
    if (patch.label !== undefined) {
      const label = patch.label.trim();
      if (!label) throw new ConvexError("Give the fee a name.");
      clean.label = label;
    }
    if (patch.amountCents !== undefined) {
      if (!Number.isFinite(patch.amountCents) || patch.amountCents <= 0) {
        throw new ConvexError("Amount must be positive.");
      }
      clean.amountCents = Math.round(patch.amountCents);
    }
    if (patch.description !== undefined) {
      clean.description = patch.description.trim() || undefined;
    }
    if (patch.active !== undefined) clean.active = patch.active;
    await ctx.db.patch(id, clean);
  },
});

export const remove = mutation({
  args: { id: v.id("feeTemplates") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "invoices.send", { orgId });
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new ConvexError("Fee not found.");
    await ctx.db.delete(id);
  },
});
