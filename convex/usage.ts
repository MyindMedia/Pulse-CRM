import { query, internalMutation, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { currentOrg } from "./lib/tenant";
import { PLAN_LIMITS, type TierKey, type TierLimits } from "./lib/plans";

/* ============================================================
   Usage metering. A single usageCounters row per (orgId, period,
   metric); record() upserts and increments. Period is the active
   calendar month ("YYYY-MM") for recurring metrics, or "all" for
   cumulative ones (storage, sub-accounts).

   Other domains call internal.usage.record from their write paths
   to meter AI credits, email/SMS sends, exports, etc.
   ============================================================ */

/** Metrics that reset every calendar month. Everything else is cumulative. */
const MONTHLY_METRICS = new Set(["ai_credits", "email", "sms", "exports"]);

/** Current period key for a metric: "YYYY-MM" for monthly, "all" otherwise. */
export function periodFor(metric: string, now: number = Date.now()): string {
  if (!MONTHLY_METRICS.has(metric)) return "all";
  const d = new Date(now);
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${d.getUTCFullYear()}-${month}`;
}

/**
 * Resolve a stored org/agency plan string into a valid PLAN_LIMITS tier.
 * orgs.tier is one of "studio" | "pro" | "agency"; agencies.plan can also be
 * "growth" | "enterprise" | "agency_plus". Unknown values fall back to
 * "agency" (the legacy generous tier) when the value isn't a public key,
 * otherwise "studio".
 */
export function tierForPlan(plan: string | undefined): TierKey {
  if (plan && plan in PLAN_LIMITS) return plan as TierKey;
  if (plan === "agency_plus") return "agency";
  return "studio";
}

/**
 * Plain upsert helper - increment usageCounters[orgId, period(metric), metric]
 * by amount. Callable directly from any mutation/action write path (mutations
 * cannot runMutation, so they import and call this).
 */
export async function recordUsage(
  ctx: MutationCtx,
  orgId: string,
  metric: string,
  amount: number,
): Promise<number> {
  const period = periodFor(metric);
  const existing = await ctx.db
    .query("usageCounters")
    .withIndex("by_org_period_metric", (q) =>
      q.eq("orgId", orgId).eq("period", period).eq("metric", metric),
    )
    .first();
  if (existing) {
    const next = existing.value + amount;
    await ctx.db.patch(existing._id, { value: next, updatedAt: Date.now() });
    return next;
  }
  await ctx.db.insert("usageCounters", {
    orgId,
    period,
    metric,
    value: amount,
    updatedAt: Date.now(),
  });
  return amount;
}

/**
 * Internal upsert: increment usageCounters by amount. Thin wrapper over
 * recordUsage for action callers (which use ctx.runMutation).
 */
export const record = internalMutation({
  args: {
    orgId: v.string(),
    metric: v.string(),
    amount: v.number(),
  },
  handler: async (ctx, { orgId, metric, amount }) =>
    await recordUsage(ctx, orgId, metric, amount),
});

/** Read a single counter's value (0 when absent). */
async function readCounter(
  ctx: QueryCtx,
  orgId: string,
  metric: string,
): Promise<number> {
  const period = periodFor(metric);
  const row = await ctx.db
    .query("usageCounters")
    .withIndex("by_org_period_metric", (q) =>
      q.eq("orgId", orgId).eq("period", period).eq("metric", metric),
    )
    .first();
  return row?.value ?? 0;
}

export type UsageMetricView = {
  metric: string;
  label: string;
  period: string;
  used: number;
  /** -1 means effectively unlimited (caps >= 999_999). */
  limit: number;
  /** Bytes for storage so the UI can format; undefined elsewhere. */
  unit?: "bytes" | "gb" | "count";
};

/**
 * Resolve the caller's org + tier and return the current-period usage for each
 * metered dimension alongside the PLAN_LIMITS caps.
 */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();

    // Prefer the org's cached tier; if the org rolls up to an agency, the
    // agency plan is the source of truth for caps.
    let planString: string | undefined = org?.tier;
    if (org?.agencyId) {
      const agency = await ctx.db
        .query("agencies")
        .withIndex("by_agency", (q) => q.eq("agencyId", org.agencyId!))
        .first();
      if (agency?.plan) planString = agency.plan;
    }
    const tier = tierForPlan(planString);
    const limits: TierLimits = PLAN_LIMITS[tier];

    const aiCredits = await readCounter(ctx, orgId, "ai_credits");
    const email = await readCounter(ctx, orgId, "email");
    const sms = await readCounter(ctx, orgId, "sms");
    const exports = await readCounter(ctx, orgId, "exports");
    const storageBytes = await readCounter(ctx, orgId, "storage_bytes");
    const subaccounts = await readCounter(ctx, orgId, "subaccounts");

    const storageGbUsed = storageBytes / (1024 * 1024 * 1024);

    const metrics: UsageMetricView[] = [
      {
        metric: "ai_credits",
        label: "AI credits",
        period: periodFor("ai_credits"),
        used: aiCredits,
        limit: limits.aiCreditsPerMonth,
        unit: "count",
      },
      {
        metric: "magic_links",
        label: "Magic-link grants",
        period: periodFor("email"),
        used: email,
        limit: limits.magicLinkGrantsPerMonth,
        unit: "count",
      },
      {
        metric: "storage",
        label: "Storage",
        period: "all",
        used: Number(storageGbUsed.toFixed(2)),
        limit: limits.storageGb,
        unit: "gb",
      },
      {
        metric: "subaccounts",
        label: "Sub-accounts",
        period: "all",
        used: subaccounts,
        limit: limits.subAccountCap,
        unit: "count",
      },
      {
        metric: "sms",
        label: "SMS sends",
        period: periodFor("sms"),
        used: sms,
        // No dedicated SMS cap in PLAN_LIMITS; surface usage without a ceiling.
        limit: -1,
        unit: "count",
      },
      {
        metric: "exports",
        label: "Data exports",
        period: periodFor("exports"),
        used: exports,
        limit: -1,
        unit: "count",
      },
    ];

    return {
      orgId,
      tier,
      tierLabel: limits.label,
      caps: {
        aiCreditsPerMonth: limits.aiCreditsPerMonth,
        storageGb: limits.storageGb,
        magicLinkGrantsPerMonth: limits.magicLinkGrantsPerMonth,
        subAccountCap: limits.subAccountCap,
      },
      metrics,
    };
  },
});
