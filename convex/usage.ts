import { query, internalQuery, internalMutation, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
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
const MONTHLY_METRICS = new Set(["ai_credits", "email", "sms", "exports", "magic_links"]);

const BYTES_PER_GB = 1024 * 1024 * 1024;
/** Count-metric sentinel for "effectively unlimited" (storage is never this). */
const UNLIMITED = 999_999;

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

/** Resolve an org's effective tier: its own `tier`, or its agency's `plan`
 *  when the org rolls up to an agency. */
export async function tierForOrg(ctx: QueryCtx, orgId: string): Promise<TierKey> {
  const org = await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
  let planString: string | undefined = org?.tier;
  if (org?.agencyId) {
    const agency = await ctx.db
      .query("agencies")
      .withIndex("by_agency", (q) => q.eq("agencyId", org.agencyId!))
      .first();
    if (agency?.plan) planString = agency.plan;
  }
  return tierForPlan(planString);
}

/** Whether the org's plan white-labels client-facing pages (hides Pulse marks
 *  on booking/portal/sign). True for any tier whose `whitelabel` isn't false. */
export async function whitelabelFor(ctx: QueryCtx, orgId: string): Promise<boolean> {
  return PLAN_LIMITS[await tierForOrg(ctx, orgId)].whitelabel !== false;
}

/** Plan cap for a metered metric (storage in bytes), or null if uncapped. */
function capForMetric(metric: string, limits: TierLimits): number | null {
  switch (metric) {
    case "ai_credits":
      return limits.aiCreditsPerMonth;
    case "magic_links":
      return limits.magicLinkGrantsPerMonth;
    case "storage_bytes":
      return limits.storageGb * BYTES_PER_GB;
    case "subaccounts":
      return limits.subAccountCap;
    default:
      return null;
  }
}

/** Throw LIMIT_REACHED (a ConvexError the UI can read) if recording `add` more
 *  of `metric` would push the org past its plan cap. Count metrics treat
 *  >=999_999 as unlimited; storage is always a real byte cap. Read-only, so it
 *  runs in query or mutation context. */
export async function assertWithinLimit(
  ctx: QueryCtx,
  orgId: string,
  metric: string,
  add = 1,
): Promise<void> {
  const limits = PLAN_LIMITS[await tierForOrg(ctx, orgId)];
  const cap = capForMetric(metric, limits);
  if (cap === null) return;
  if (metric !== "storage_bytes" && cap >= UNLIMITED) return;
  const used = await readCounter(ctx, orgId, metric);
  if (used + add > cap) {
    throw new ConvexError({
      code: "LIMIT_REACHED",
      metric,
      used,
      cap,
      tier: limits.label,
      message: `Your ${limits.label} plan limit for ${metric.replace("_", " ")} has been reached. Upgrade to add more.`,
    });
  }
}

/** Action-callable guard: throws LIMIT_REACHED if over cap. Actions have no
 *  ctx.db, so they call this via ctx.runQuery before consuming. */
export const checkLimit = internalQuery({
  args: { orgId: v.string(), metric: v.string(), add: v.optional(v.number()) },
  handler: async (ctx, { orgId, metric, add }) =>
    await assertWithinLimit(ctx, orgId, metric, add ?? 1),
});

/** Meter + enforce a storage upload. Reads the new (and optional previous) file
 *  sizes; if the delta would exceed the plan's storage cap it throws
 *  LIMIT_REACHED (which rolls the save mutation back, so the file is never
 *  attached or metered), otherwise records the byte delta. Call from
 *  upload-save mutations after receiving the storageId.
 *
 *  Note: we deliberately do NOT ctx.storage.delete the over-cap file here - a
 *  throwing mutation rolls back all its effects, including storage deletes, so
 *  the delete would be undone. The rejected upload is left orphaned (never
 *  referenced, never counted); a separate sweep can garbage-collect orphans. */
export async function meterStorageUpload(
  ctx: MutationCtx,
  orgId: string,
  newStorageId: Id<"_storage">,
  prevStorageId?: Id<"_storage"> | null,
): Promise<void> {
  const meta = await ctx.db.system.get(newStorageId);
  const newSize = meta?.size ?? 0;
  let prevSize = 0;
  if (prevStorageId) {
    const pm = await ctx.db.system.get(prevStorageId);
    prevSize = pm?.size ?? 0;
  }
  const delta = newSize - prevSize;
  if (delta > 0) {
    const limits = PLAN_LIMITS[await tierForOrg(ctx, orgId)];
    const capBytes = limits.storageGb * BYTES_PER_GB;
    const used = await readCounter(ctx, orgId, "storage_bytes");
    if (used + delta > capBytes) {
      throw new ConvexError({
        code: "LIMIT_REACHED",
        metric: "storage_bytes",
        used,
        cap: capBytes,
        tier: limits.label,
        message: `Your ${limits.label} plan storage limit (${limits.storageGb} GB) is full. Upgrade or remove files to upload more.`,
      });
    }
  }
  if (delta !== 0) await recordUsage(ctx, orgId, "storage_bytes", delta);
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
    const magicLinks = await readCounter(ctx, orgId, "magic_links");
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
        period: periodFor("magic_links"),
        used: magicLinks,
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
