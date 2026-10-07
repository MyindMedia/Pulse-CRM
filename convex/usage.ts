import { fileSize, type FileRef } from "./lib/media";
import { query, internalQuery, type QueryCtx, type MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { currentOrg } from "./lib/tenant";
import { PLAN_LIMITS, type TierKey, type TierLimits } from "./lib/plans";
import { tierForOrg, tierForPlan } from "./lib/tier";

// Tier resolution lives in lib/tier.ts (a leaf module) so the access engine
// can gate on entitlements without an import cycle. Re-exported here because
// a dozen callers already import it from usage.
export { tierForOrg, tierForPlan };

/* ============================================================
   Usage metering. A single usageCounters row per (orgId, period,
   metric); record() upserts and increments. Period is the active
   calendar month ("YYYY-MM") for recurring metrics, or "all" for
   cumulative ones (storage, sub-accounts).

   Other domains call internal.usage.record from their write paths
   to meter AI credits, email/SMS sends, exports, etc.
   ============================================================ */

/** Metrics that reset every calendar month. Everything else is cumulative. */
const MONTHLY_METRICS = new Set(["ai_credits", "email", "sms", "exports", "magic_links", "social_posts"]);

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


/**
 * Usage counted against a plan cap. On a pooled tier (Max) the allowance is
 * shared by every studio in the same group, so the count is the group's total
 * across the sibling studios that are also on a pooled tier. Anywhere else,
 * and for the studio count itself, it is this studio's own counter.
 */
async function usedAgainstCap(
  ctx: QueryCtx,
  orgId: string,
  metric: string,
  limits: TierLimits,
): Promise<number> {
  if (!limits.pooled || metric === "subaccounts") return readCounter(ctx, orgId, metric);
  const org = await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
  if (!org?.agencyId) return readCounter(ctx, orgId, metric);
  const siblings = await ctx.db
    .query("orgs")
    .withIndex("by_agency", (q) => q.eq("agencyId", org.agencyId!))
    .collect();
  let total = 0;
  for (const s of siblings) {
    if (s.orgId !== orgId && !PLAN_LIMITS[await tierForOrg(ctx, s.orgId)].pooled) continue;
    total += await readCounter(ctx, s.orgId, metric);
  }
  return total;
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
    case "social_accounts":
      return limits.socialAccountCap;
    case "social_posts":
      return limits.socialPostsPerMonth;
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
  const used = await usedAgainstCap(ctx, orgId, metric, limits);
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
  newStorageId: FileRef,
  prevStorageId?: FileRef | null,
): Promise<void> {
  // Either store: a legacy Convex storage id or an R2 mediaFiles id.
  const newSize = await fileSize(ctx, newStorageId);
  const prevSize = await fileSize(ctx, prevStorageId);
  const delta = newSize - prevSize;
  if (delta > 0) {
    const limits = PLAN_LIMITS[await tierForOrg(ctx, orgId)];
    const capBytes = limits.storageGb * BYTES_PER_GB;
    const used = await usedAgainstCap(ctx, orgId, "storage_bytes", limits);
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
    // Same resolution as every gate: beta flag, then the studio's own tier,
    // then its agency's plan.
    const tier = await tierForOrg(ctx, orgId);
    const limits: TierLimits = PLAN_LIMITS[tier];

    const aiCredits = await usedAgainstCap(ctx, orgId, "ai_credits", limits);
    const magicLinks = await usedAgainstCap(ctx, orgId, "magic_links", limits);
    const sms = await readCounter(ctx, orgId, "sms");
    const exports = await readCounter(ctx, orgId, "exports");
    const storageBytes = await usedAgainstCap(ctx, orgId, "storage_bytes", limits);
    const subaccounts = await readCounter(ctx, orgId, "subaccounts");

    const storageGbUsed = storageBytes / (1024 * 1024 * 1024);

    const metrics: UsageMetricView[] = [
      {
        metric: "ai_credits",
        label: "Assistant credits",
        period: periodFor("ai_credits"),
        used: aiCredits,
        limit: limits.aiCreditsPerMonth,
        unit: "count",
      },
      {
        metric: "magic_links",
        label: "Guest and invite links",
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
        label: "Studios",
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
        // Texts are not metered on any tier (lib/pricing.ts UNMETERED):
        // surface usage without a ceiling.
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
      pooled: limits.pooled,
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
