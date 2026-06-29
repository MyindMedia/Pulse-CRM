import { query, mutation, internalQuery, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { currentOrg, currentActor, currentOrgWithCapability} from "./lib/tenant";
import { US_STATES, findState } from "./lib/usTaxRates";
import { meterStorageUpload } from "./usage";
import { evaluateBillingGate, effectivePriceCents } from "./lib/billingGate";

/** Internal: every active, non-demo studio subaccount's orgId. The cron
 * fan-outs (weekly briefing, rate-cut sweep, ops-brain scan) iterate this
 * to run per-org work without an auth context. */
export const listActiveOrgIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("orgs").collect();
    return orgs
      .filter((o) => (o.status ?? "active") === "active" && o.orgId !== "pulse-demo")
      .map((o) => o.orgId);
  },
});

/* Orgs - one row per studio subaccount. `current` is the active workspace;
   `getBySlug` powers the public /book/<slug> page. Branding (logo, accent,
   booking-page theming) lives here and flows into the app + booking site. */

/** Shape an org doc into the branding payload the UI consumes. */
async function billingOf(ctx: QueryCtx, org: Doc<"orgs"> | null) {
  if (!org || !org.agencyPlanId || !org.billingStatus) return null;
  const plan = await ctx.db.get(org.agencyPlanId);
  const gate = evaluateBillingGate(org, plan, Date.now());
  return {
    status: org.billingStatus,
    planName: plan?.name ?? null,
    trialEndsAt: org.trialEndsAt ?? null,
    paymentMethodOnFile: Boolean(org.paymentMethodOnFile),
    effectivePriceCents: effectivePriceCents(org.priceCentsOverride, plan?.priceCents),
    billingInterval: plan?.billingInterval ?? "month",
    ...gate,
  };
}

async function brandOf(ctx: QueryCtx, org: Doc<"orgs"> | null, orgId: string) {
  return {
    orgId,
    name: org?.name ?? "Pulse Studio",
    slug: org?.slug ?? "pulse-studio",
    plan: org?.plan ?? "studio",
    status: org?.status ?? "active",
    accentColor: org?.accentColor ?? "#fdb913",
    brandPalette: org?.brandPalette ?? null,
    tagline: org?.tagline ?? "Your music business runs itself.",
    logoUrl: org?.logoId ? await ctx.storage.getUrl(org.logoId) : null,
    bookingHeroUrl: org?.bookingHeroId ? await ctx.storage.getUrl(org.bookingHeroId) : null,
    bookingHeadline: org?.bookingHeadline ?? null,
    bookingIntro: org?.bookingIntro ?? null,
    depositPolicyText: org?.depositPolicyText ?? null,
    ownerName: org?.ownerName ?? null,
    ownerEmail: org?.ownerEmail ?? null,
    configured: Boolean(org),
    // Feature toggles (nav gating) - keys the agency has disabled for this org.
    disabledFeatures: org?.disabledFeatures ?? [],
    // Pricing / discount / tax config (cycle: Pricing settings)
    servicePricing: org?.servicePricing ?? null,
    discountCodes: org?.discountCodes ?? [],
    defaultRateCutPct: org?.defaultRateCutPct ?? null,
    taxState: org?.taxState ?? null,
    taxRate: org?.taxRate ?? null,
    taxApply: org?.taxApply ?? false,
    // Agency rebilling state (null for standalone studios with no agency plan).
    billing: await billingOf(ctx, org),
  };
}

/** The caller's active workspace + branding. */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    const actor = await currentActor(ctx);
    return { ...(await brandOf(ctx, org, orgId)), actor };
  },
});

/** Public - resolve a studio by its slug for the /book/<slug> page. */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!org) return null;
    return brandOf(ctx, org, org.orgId);
  },
});

/** Ensure the active org has a row, then return it. */
async function ensureOrg(ctx: { db: QueryCtx["db"] }, orgId: string) {
  return ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
}

export const update = mutation({
  args: {
    name: v.optional(v.string()),
    plan: v.optional(v.union(v.literal("solo"), v.literal("studio"), v.literal("label"))),
    accentColor: v.optional(v.string()),
    tagline: v.optional(v.string()),
    bookingHeadline: v.optional(v.string()),
    bookingIntro: v.optional(v.string()),
    depositPolicyText: v.optional(v.string()),
  },
  handler: async (ctx, patch) => {
    const orgId = await currentOrgWithCapability(ctx, "branding.edit");
    const org = await ensureOrg(ctx, orgId);
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    if (org) {
      await ctx.db.patch(org._id, clean);
    } else {
      await ctx.db.insert("orgs", {
        orgId,
        name: (patch.name as string) ?? "Pulse Studio",
        slug: "pulse-studio",
        plan: patch.plan ?? "studio",
        status: "active",
        accentColor: patch.accentColor,
        tagline: patch.tagline,
        bookingHeadline: patch.bookingHeadline,
        bookingIntro: patch.bookingIntro,
        depositPolicyText: patch.depositPolicyText,
      });
    }
  },
});

/** Upload URL for a branding asset (logo / booking hero). */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await currentOrg(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const setLogo = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const orgId = await currentOrgWithCapability(ctx, "branding.edit");
    const org = await ensureOrg(ctx, orgId);
    await meterStorageUpload(ctx, orgId, storageId, org?.logoId ?? null);
    await ctx.scheduler.runAfter(3000, internal.brandHero.generate, { orgId });
    if (org) await ctx.db.patch(org._id, { logoId: storageId });
    else
      await ctx.db.insert("orgs", {
        orgId,
        name: "Pulse Studio",
        slug: "pulse-studio",
        plan: "studio",
        status: "active",
        logoId: storageId,
      });
  },
});

/** Auto-branding: store the accent + palette extracted client-side from the
    uploaded logo. The studio can still override the accent manually in the
    branding panel afterwards. */
export const applyBrandFromLogo = mutation({
  args: { accentColor: v.string(), palette: v.array(v.string()) },
  handler: async (ctx, { accentColor, palette }) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(accentColor)) throw new Error("Invalid accent color.");
    if (palette.length > 6 || palette.some((p) => !/^#[0-9a-fA-F]{6}$/.test(p))) {
      throw new Error("Invalid palette.");
    }
    const orgId = await currentOrgWithCapability(ctx, "branding.edit");
    const org = await ensureOrg(ctx, orgId);
    if (!org) throw new Error("No studio yet - upload a logo first.");
    await ctx.db.patch(org._id, { accentColor, brandPalette: palette });
    return { accentColor };
  },
});

export const setBookingHero = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const orgId = await currentOrgWithCapability(ctx, "branding.edit");
    const org = await ensureOrg(ctx, orgId);
    await meterStorageUpload(ctx, orgId, storageId, org?.bookingHeroId ?? null);
    if (org) await ctx.db.patch(org._id, { bookingHeroId: storageId });
    else
      await ctx.db.insert("orgs", {
        orgId,
        name: "Pulse Studio",
        slug: "pulse-studio",
        plan: "studio",
        status: "active",
        bookingHeroId: storageId,
      });
  },
});

/* ============================================================
   Pricing / discounts / tax config
   ============================================================ */

/** Public list of US states with default tax rates for the settings UI. */
export const stateTaxRates = query({
  args: {},
  handler: async () => US_STATES,
});

/** Update per-service pricing (cents/hr). Pass only the fields you want
 * to change; pass null to clear a field. */
export const setServicePricing = mutation({
  args: {
    pricing: v.object({
      recording: v.optional(v.number()),
      mixing: v.optional(v.number()),
      mastering: v.optional(v.number()),
      production: v.optional(v.number()),
      consultation: v.optional(v.number()),
      rehearsal: v.optional(v.number()),
      writing: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { pricing }) => {
    const orgId = await currentOrgWithCapability(ctx, "branding.edit");
    const org = await ensureOrg(ctx, orgId);
    if (!org) throw new Error("Org not found");
    await ctx.db.patch(org._id, { servicePricing: pricing });
  },
});

/** Replace the studio's discount-code list. Each code stores its percent
 * and active flag so the owner can pause one without deleting it. */
export const setDiscountCodes = mutation({
  args: {
    codes: v.array(
      v.object({
        code: v.string(),
        pct: v.number(),
        label: v.optional(v.string()),
        active: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, { codes }) => {
    const orgId = await currentOrgWithCapability(ctx, "branding.edit");
    const org = await ensureOrg(ctx, orgId);
    if (!org) throw new Error("Org not found");
    // Normalize codes to uppercase + dedupe; drop empty rows.
    const seen = new Set<string>();
    const clean = codes
      .map((c) => ({ ...c, code: c.code.trim().toUpperCase() }))
      .filter((c) => c.code && !seen.has(c.code) && (seen.add(c.code), true));
    await ctx.db.patch(org._id, { discountCodes: clean });
  },
});

/** Set the default cut % used by the AI rate-cut recommender when it
 * finds an underused window. */
export const setDefaultRateCutPct = mutation({
  args: { pct: v.number() },
  handler: async (ctx, { pct }) => {
    if (pct < 1 || pct > 90) throw new Error("Cut % must be between 1 and 90");
    const orgId = await currentOrgWithCapability(ctx, "branding.edit");
    const org = await ensureOrg(ctx, orgId);
    if (!org) throw new Error("Org not found");
    await ctx.db.patch(org._id, { defaultRateCutPct: pct });
  },
});

/** Set the tax config. Picking a state auto-fills `taxRate` from the
 * built-in lookup; the owner can pass `taxRate` to override (e.g. for
 * city/county add-ons). `apply` toggles whether invoices auto-add tax. */
export const setTaxConfig = mutation({
  args: {
    state: v.optional(v.string()),
    taxRate: v.optional(v.number()),
    apply: v.boolean(),
  },
  handler: async (ctx, { state, taxRate, apply }) => {
    const orgId = await currentOrgWithCapability(ctx, "branding.edit");
    const org = await ensureOrg(ctx, orgId);
    if (!org) throw new Error("Org not found");
    // Resolve the rate: explicit value wins, else look up from the state.
    let rate = taxRate;
    if (rate === undefined && state) {
      rate = findState(state)?.rate ?? 0;
    }
    await ctx.db.patch(org._id, {
      taxState: state,
      taxRate: rate,
      taxApply: apply,
    });
  },
});
