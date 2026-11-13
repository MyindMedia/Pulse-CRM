import type { QueryCtx, MutationCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { orgGate } from "./tier";
import { capabilitiesForTier, upgradeError } from "./entitlements";
import { isToggleable, moduleFor } from "./modules";

/* ============================================================
   Plan gates for the AI receptionist and visitor check-in
   (truth-plan-gates).

   Both are Growth features that used to work on every plan. Now:
     - the operator's module switch always wins (off means off);
     - a plan that includes it works as before;
     - a plan that does not include it is refused, EXCEPT a studio that
       was already using it before this change. That studio keeps it until
       its notice date (orgs.planGraceUntil) passes (owner decision 2b:
       30 days' notice). With no notice date set it keeps working, exactly
       as before, until the owner sets one with plans:setPlanGateGrace.

   "Already using it" is read from the data, not stored:
     - receptionist: the studio's switch is on (it can no longer be
       switched on without the plan, so only old rows qualify);
     - visitors: the studio has at least one visit recorded (a studio
       without the plan can no longer record its first one).
   ============================================================ */

export type GatedFeature = "aiReceptionist" | "visitors";

async function orgRow(ctx: QueryCtx | MutationCtx, orgId: string) {
  return ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
}

/** Was this studio using the feature before the gate existed? */
export async function inUse(ctx: QueryCtx | MutationCtx, orgId: string, key: GatedFeature): Promise<boolean> {
  if (key === "aiReceptionist") return (await orgRow(ctx, orgId))?.aiReceptionistEnabled === true;
  const visit = await ctx.db.query("visitors").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  return visit !== null;
}

export type GateState =
  | { on: true; via: "plan" | "notice" }
  | { on: false; reason: "module_off" | "plan" };

/** The one answer every receptionist / visitor path asks. */
export async function gatedFeatureState(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  key: GatedFeature,
  now = Date.now(),
): Promise<GateState> {
  const { tier, disabled } = await orgGate(ctx, orgId);
  if (isToggleable(key) && disabled.has(key)) return { on: false, reason: "module_off" };
  if (capabilitiesForTier(tier).has(key)) return { on: true, via: "plan" };
  const org = await orgRow(ctx, orgId);
  const graceUntil = org?.planGraceUntil;
  if (graceUntil !== undefined && graceUntil <= now) return { on: false, reason: "plan" };
  return (await inUse(ctx, orgId, key)) ? { on: true, via: "notice" } : { on: false, reason: "plan" };
}

export async function gatedFeatureOn(ctx: QueryCtx | MutationCtx, orgId: string, key: GatedFeature): Promise<boolean> {
  return (await gatedFeatureState(ctx, orgId, key)).on;
}

/** Throwing form for write paths and staff screens. */
export async function requireGatedFeature(ctx: QueryCtx | MutationCtx, orgId: string, key: GatedFeature): Promise<void> {
  const s = await gatedFeatureState(ctx, orgId, key);
  if (s.on) return;
  if (s.reason === "module_off") {
    const label = moduleFor(key)?.label ?? key;
    throw new ConvexError({
      code: "MODULE_DISABLED",
      capability: key,
      label,
      message: `${label} is switched off for this studio. An owner or the agency can turn it back on in Settings.`,
    });
  }
  const { tier } = await orgGate(ctx, orgId);
  throw upgradeError(key, tier);
}
