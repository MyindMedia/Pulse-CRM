import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability, resolveViewer } from "./lib/access";
import { DEMO_ORG } from "./lib/tenant";
import { PLAN_LIMITS } from "./lib/plans";

/** Whether the agency's plan unlocks a white-label custom domain.
    agency_plus (resell tier) isn't in PLAN_LIMITS; treat it as unlocked.
    Unknown/legacy keys lean permissive. */
function customDomainAllowed(plan: string | undefined): boolean {
  if (!plan) return true;
  if (plan === "agency_plus") return true;
  const limits = (PLAN_LIMITS as Record<string, { customDomain: boolean }>)[plan];
  return limits?.customDomain ?? true;
}

/* ============================================================
   Agency settings hub - identity + rollup the console settings
   page reads, plus a small profile update. Branding (logo/accent/
   domain) stays in branding.ts; plans live in agencyPlans.ts.
   ============================================================ */

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await resolveViewer(ctx).catch(() => null);
    if (viewer?.kind !== "agency_member") return null;
    const agency = await ctx.db
      .query("agencies")
      .withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId))
      .first();

    const orgs = (await ctx.db
      .query("orgs")
      .withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId))
      .collect()).filter((o) => o.orgId !== DEMO_ORG);
    const plans = await ctx.db
      .query("agencyPlans")
      .withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId))
      .collect();
    const staff = await ctx.db
      .query("agencyMembers")
      .withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId))
      .collect();
    const defaultPlan = plans.find((p) => p.isDefault && p.active) ?? null;

    // Billing health across studios.
    const onTrial = orgs.filter((o) => o.billingStatus === "trialing").length;
    const active = orgs.filter((o) => o.billingStatus === "active").length;
    const pastDue = orgs.filter((o) => o.billingStatus === "past_due").length;
    const comped = orgs.filter((o) => o.billingStatus === "comped").length;

    return {
      agencyId: viewer.agencyId,
      name: agency?.name ?? "My Agency",
      slug: agency?.slug ?? null,
      plan: agency?.plan ?? "agency",
      status: agency?.status ?? "active",
      appName: agency?.appName ?? null,
      accentColor: agency?.accentColor ?? null,
      logoUrl: agency?.logoId ? await ctx.storage.getUrl(agency.logoId) : null,
      supportEmail: agency?.supportEmail ?? agency?.ownerEmail ?? null,
      customDomain: agency?.customDomain ?? null,
      customDomainAvailable: customDomainAllowed(agency?.plan),
      stripeConnected: Boolean(agency?.stripeCustomerId),
      role: viewer.role,
      counts: {
        studios: orgs.length,
        plans: plans.length,
        activePlans: plans.filter((p) => p.active).length,
        staff: staff.length,
        defaultPlanName: defaultPlan?.name ?? null,
        onTrial,
        active,
        pastDue,
        comped,
      },
    };
  },
});

export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    supportEmail: v.optional(v.string()),
    appName: v.optional(v.string()),
  },
  handler: async (ctx, { name, supportEmail, appName }) => {
    const viewer = await requireCapability(ctx, "branding.edit");
    if (viewer.kind !== "agency_member") throw new Error("Agency users only.");
    const agency = await ctx.db
      .query("agencies")
      .withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId))
      .first();
    if (!agency) throw new Error("Agency not found.");
    const patch: Record<string, unknown> = {};
    if (name !== undefined && name.trim()) patch.name = name.trim();
    if (supportEmail !== undefined) patch.supportEmail = supportEmail.trim() || undefined;
    if (appName !== undefined) patch.appName = appName.trim() || undefined;
    await ctx.db.patch(agency._id, patch);
  },
});
