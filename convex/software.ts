import { query } from "./_generated/server";
import { mutation } from "./functions";
import { v, ConvexError } from "convex/values";
import { currentOrg, currentOrgWithCapability} from "./lib/tenant";
import { searchSoftwareCatalog } from "./lib/softwareCatalog";

/* ============================================================
   Software + license management - DAWs, plugins, sample
   libraries and subscriptions. Tenant-scoped (currentOrg),
   mirroring the equipment module.
   ============================================================ */

const categoryV = v.union(
  v.literal("daw"),
  v.literal("plugin"),
  v.literal("sample_library"),
  v.literal("subscription"),
  v.literal("utility"),
  v.literal("other"),
);
const licenseTypeV = v.union(v.literal("perpetual"), v.literal("subscription"));
const intervalV = v.union(v.literal("one_time"), v.literal("monthly"), v.literal("annual"));
const statusV = v.union(v.literal("active"), v.literal("expired"), v.literal("unused"));

/** Annualized recurring cost in cents for a license (0 for perpetual/one-time). */
function annualizedCents(row: { licenseType: string; billingInterval: string; costCents: number }): number {
  if (row.licenseType !== "subscription") return 0;
  if (row.billingInterval === "monthly") return row.costCents * 12;
  if (row.billingInterval === "annual") return row.costCents;
  return 0;
}

export const list = query({
  args: { category: v.optional(v.string()), status: v.optional(v.string()) },
  handler: async (ctx, { category, status }) => {
    const orgId = await currentOrg(ctx);
    let rows = await ctx.db
      .query("softwareLicenses")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    if (category) rows = rows.filter((r) => r.category === category);
    if (status) rows = rows.filter((r) => r.status === status);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("softwareLicenses")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const now = Date.now();
    const soon = now + 60 * 86_400_000; // 60 days
    const annualRecurring = rows.reduce((s, r) => s + annualizedCents(r), 0);
    const perpetualValue = rows
      .filter((r) => r.licenseType === "perpetual")
      .reduce((s, r) => s + r.costCents, 0);
    const upcomingRenewals = rows.filter(
      (r) => r.licenseType === "subscription" && r.renewalDate && r.renewalDate <= soon && r.status === "active",
    ).length;
    const expired = rows.filter((r) => r.status === "expired").length;
    return {
      count: rows.length,
      annualRecurring,
      monthlyRecurring: Math.round(annualRecurring / 12),
      perpetualValue,
      upcomingRenewals,
      expired,
      subscriptions: rows.filter((r) => r.licenseType === "subscription").length,
    };
  },
});

/** Search the software catalog for the add dropdown (reference data). */
export const searchCatalog = query({
  args: { q: v.string(), category: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { q, category, limit }) => {
    await currentOrg(ctx);
    return searchSoftwareCatalog(q, category, limit ?? 20);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    vendor: v.optional(v.string()),
    category: categoryV,
    licenseType: licenseTypeV,
    seats: v.optional(v.number()),
    costCents: v.number(),
    billingInterval: intervalV,
    purchaseDate: v.optional(v.number()),
    renewalDate: v.optional(v.number()),
    licenseKey: v.optional(v.string()),
    seatHolder: v.optional(v.string()),
    status: v.optional(statusV),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "licenses.edit");
    const name = args.name.trim();
    if (!name) throw new ConvexError("Give the software a name.");
    if (!Number.isFinite(args.costCents) || args.costCents < 0) {
      throw new ConvexError("Cost can't be negative.");
    }
    const id = await ctx.db.insert("softwareLicenses", {
      orgId,
      name,
      vendor: args.vendor?.trim() || undefined,
      category: args.category,
      licenseType: args.licenseType,
      seats: args.seats,
      costCents: Math.round(args.costCents),
      billingInterval: args.billingInterval,
      purchaseDate: args.purchaseDate,
      renewalDate: args.renewalDate,
      licenseKey: args.licenseKey?.trim() || undefined,
      seatHolder: args.seatHolder?.trim() || undefined,
      status: args.status ?? "active",
      notes: args.notes?.trim() || undefined,
      createdAt: Date.now(),
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "software.added",
      summary: `${name} added to software inventory`,
      entityType: "software",
      entityId: id,
      accent: "info",
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("softwareLicenses"),
    name: v.optional(v.string()),
    vendor: v.optional(v.string()),
    category: v.optional(categoryV),
    licenseType: v.optional(licenseTypeV),
    seats: v.optional(v.number()),
    costCents: v.optional(v.number()),
    billingInterval: v.optional(intervalV),
    purchaseDate: v.optional(v.number()),
    renewalDate: v.optional(v.number()),
    licenseKey: v.optional(v.string()),
    seatHolder: v.optional(v.string()),
    status: v.optional(statusV),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrgWithCapability(ctx, "licenses.edit");
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new ConvexError("Software not found.");
    const clean: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(patch)) {
      if (val === undefined) continue;
      if (k === "name") {
        const n = (val as string).trim();
        if (!n) throw new ConvexError("Give the software a name.");
        clean.name = n;
      } else if (typeof val === "string" && ["vendor", "licenseKey", "seatHolder", "notes"].includes(k)) {
        clean[k] = (val as string).trim() || undefined;
      } else {
        clean[k] = val;
      }
    }
    await ctx.db.patch(id, clean);
  },
});

export const remove = mutation({
  args: { id: v.id("softwareLicenses") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "licenses.edit");
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new ConvexError("Software not found.");
    await ctx.db.delete(id);
  },
});
