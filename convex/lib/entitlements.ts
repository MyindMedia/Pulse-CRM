import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import {
  PLAN_LIMITS,
  SELLABLE_TIERS,
  priceLabel,
  type CapabilityKey,
  type TierKey,
} from "./plans";
import { tierForOrg, orgGate } from "./tier";
import { MODULE_KEYS, isToggleable, moduleFor } from "./modules";

/* ============================================================
   Entitlements - what a tier may reach, and the guard that says no.

   Two layers, both required:
     1. Nav gating (soft). orgs.current merges tier-locked feature keys
        into disabledFeatures, so the sidebar, mobile tab bar, command
        palette and route guard all hide them with no extra wiring.
     2. Server gating (hard). requireFeature() throws UPGRADE_REQUIRED
        inside the mutation, so a locked capability cannot be reached by
        calling the API directly.

   Nav gating alone is decoration. Every paid capability must also call
   requireFeature on its write path.
   ============================================================ */

/** Nav-surface capability keys, mirroring src/lib/features.ts FeatureKey.
 *  These are the only keys that participate in disabledFeatures. */
export const NAV_CAPABILITIES = [
  "agent",
  "songs",
  "clients",
  "pipeline",
  "inbox",
  "calendar",
  "schedule",
  "visitors",
  "bookings",
  "payments",
  "reports",
  "releases",
  "licensing",
  "studio",
  "inventory",
  "patch",
  "software",
] as const satisfies readonly CapabilityKey[];

const NAV_SET = new Set<string>(NAV_CAPABILITIES);

const CAP_CACHE = new Map<TierKey, Set<CapabilityKey>>();

/** Every capability a tier can reach. */
export function capabilitiesForTier(tier: TierKey): Set<CapabilityKey> {
  let set = CAP_CACHE.get(tier);
  if (!set) {
    set = new Set(PLAN_LIMITS[tier].capabilities);
    CAP_CACHE.set(tier, set);
  }
  return set;
}

export function hasCapability(tier: TierKey, key: CapabilityKey): boolean {
  return capabilitiesForTier(tier).has(key);
}

/** Nav feature keys this tier does NOT get. Merged into disabledFeatures so
 *  every nav surface hides them without touching each component. */
export function lockedNavFeatures(tier: TierKey): string[] {
  const caps = capabilitiesForTier(tier);
  return NAV_CAPABILITIES.filter((k) => !caps.has(k));
}

/** The cheapest sellable tier that includes `key`, or null when nothing
 *  sells it. Drives the "Upgrade to Pro to unlock" copy. */
export function minTierFor(key: CapabilityKey): TierKey | null {
  for (const t of SELLABLE_TIERS) {
    if (capabilitiesForTier(t).has(key)) return t;
  }
  return null;
}

/** Structured, UI-readable refusal. The client reads `code` to render an
 *  upgrade card instead of a red error toast. */
export function upgradeError(key: CapabilityKey, tier: TierKey): ConvexError<{
  code: string;
  capability: string;
  currentTier: string;
  requiredTier: string | null;
  requiredTierLabel: string | null;
  price: string;
  message: string;
}> {
  const need = minTierFor(key);
  const needLabel = need ? PLAN_LIMITS[need].label : null;
  return new ConvexError({
    code: "UPGRADE_REQUIRED",
    capability: key,
    currentTier: tier,
    requiredTier: need,
    requiredTierLabel: needLabel,
    price: need ? priceLabel(need) : "",
    message: needLabel
      ? `${needLabel} unlocks this. You are on ${PLAN_LIMITS[tier].label}.`
      : "This is not available on your plan.",
  });
}

/** Hard gate. Call at the top of every write path behind a paid capability.
 *  Reads the org's tier the same way usage metering does, so one org can
 *  never disagree with itself about what it bought. */
export async function requireFeature(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  key: CapabilityKey,
): Promise<void> {
  const { tier, disabled } = await orgGate(ctx, orgId);
  if (!capabilitiesForTier(tier).has(key)) throw upgradeError(key, tier);
  if (isToggleable(key) && disabled.has(key)) throw moduleOffError(key);
}

/** Switched off by the operator, as opposed to never bought. A different
 *  refusal on purpose: "upgrade" is the wrong advice for a module the studio
 *  already owns and someone turned off. */
export function moduleOffError(key: CapabilityKey): ConvexError<{
  code: string;
  capability: string;
  label: string;
  message: string;
}> {
  const mod = moduleFor(key);
  const label = mod?.label ?? key;
  return new ConvexError({
    code: "MODULE_DISABLED",
    capability: key,
    label,
    message: `${label} is switched off for this studio. An owner or the agency can turn it back on in Settings.`,
  });
}

/** Non-throwing variant for read paths that degrade instead of failing. */
export async function orgHasFeature(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  key: CapabilityKey,
): Promise<boolean> {
  const { tier, disabled } = await orgGate(ctx, orgId);
  return moduleEnabled(tier, disabled, key);
}

/** The effective disabled-module list for an org: what the operator switched
 *  off, plus everything the tier never included.
 *
 *  Toggles can only ever SUBTRACT. A Studio-tier workspace cannot be handed
 *  the patch bay by flipping a switch, because the tier locks are unioned in
 *  after the toggles, never before. Core modules are never disabled, whatever
 *  the stored list says - a stale row cannot leave a studio unable to take a
 *  booking. */
export function effectiveDisabledFeatures(
  tier: TierKey,
  operatorDisabled: string[] | undefined,
): string[] {
  const out = new Set<string>(lockedModules(tier));
  for (const k of operatorDisabled ?? []) {
    if (isToggleable(k)) out.add(k);
  }
  return [...out];
}

/** Every module key this tier did not buy. Wider than lockedNavFeatures:
 *  covers behaviour modules (payroll, white label, receptionist) too. */
export function lockedModules(tier: TierKey): string[] {
  const caps = capabilitiesForTier(tier);
  return MODULE_KEYS.filter((k) => !caps.has(k));
}

/** Is this module actually usable right now - bought AND switched on. */
export function moduleEnabled(
  tier: TierKey,
  operatorDisabled: Set<string> | string[] | undefined,
  key: CapabilityKey,
): boolean {
  if (!capabilitiesForTier(tier).has(key)) return false;
  if (!isToggleable(key)) return true;
  const off = operatorDisabled instanceof Set
    ? operatorDisabled
    : new Set(operatorDisabled ?? []);
  return !off.has(key);
}

/** Feature keys locked purely by price (not by an agency toggle). The UI shows
 *  these as upgrade prompts rather than hiding them outright, so the studio
 *  can see what the next tier buys. */
export function tierLockedFeatures(tier: TierKey): string[] {
  return lockedNavFeatures(tier);
}


/* ============================================================
   Central gate. requireCapability() answers "is this person allowed
   to do that?"; this answers "did this workspace buy that?". Both
   must pass. Mapping the check here means a module added later is
   gated by default, instead of relying on someone remembering to
   call requireFeature.

   Only list permission capabilities that map 1:1 onto a paid
   entitlement. Anything absent is unmetered and always allowed.
   ============================================================ */
export const ENTITLEMENT_FOR_CAPABILITY: Record<string, CapabilityKey> = {
  // Names below are the real capability strings from accessPolicies.ts.
  // Anything not listed here is unmetered and available on every tier.
  "schedule.manage": "schedule",          // shifts, availability, time clock
  "songs.read": "songs",
  "songs.edit": "songs",
  "songs.delete": "songs",
  "insights.read": "reports",             // reports, P&L, payroll summaries
  "ops.action.approve": "agent",
  "ops.autonomy.manage": "aiAutonomy",
  "opportunities.read": "pipeline",
  "opportunities.edit": "pipeline",
  "equipment.read": "inventory",
  "equipment.edit": "inventory",
  "releases.read": "releases",
  "releases.edit": "releases",
  // NOTE: "licenses.*" is shared by two surfaces - sync/beat Licensing and
  // the Software licenses page. Both are Label-tier, so one mapping is
  // correct today. Split the capability before moving either to a different
  // tier, or the other one moves with it.
  "licenses.read": "licensing",
  "licenses.edit": "licensing",
  "syncOpportunities.read": "licensing",
  "syncOpportunities.edit": "licensing",
  "patch.read": "patch",
  "patch.edit": "patch",
  // Editing a split sheet is Label-tier. Signing one deliberately is NOT
  // gated: an artist mid-signature must never hit an upgrade wall.
  "splitsheet.edit": "splitSheets",
  // Full white-label theming.
  "theme.edit": "whiteLabelUi",
};

/** Entitlement required by a permission capability, or null when unmetered. */
export function entitlementForCapability(cap: string): CapabilityKey | null {
  return ENTITLEMENT_FOR_CAPABILITY[cap] ?? null;
}
