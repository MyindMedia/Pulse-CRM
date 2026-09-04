import { query } from "./_generated/server";
import { mutation } from "./functions";
import { v, ConvexError } from "convex/values";
import { requireCapability } from "./lib/access";
import { currentOrg } from "./lib/tenant";
import { orgGate } from "./lib/tier";
import { PLAN_LIMITS, priceLabel, type CapabilityKey } from "./lib/plans";
import { capabilitiesForTier } from "./lib/entitlements";
import {
  moduleBoard,
  moduleFor,
  isToggleable,
  isModuleKey,
  MODULES,
} from "./lib/modules";

/* ============================================================
   The module switchboard.

   `board` is the read every switchboard UI renders - agency console
   and studio settings both. It answers three things per module:
     owned    - the plan includes it
     enabled  - it is owned AND not switched off
     locked   - why it cannot be switched on (tier, or core)

   Writes go through `setModule` (a studio owner managing their own
   workspace) or `agency.setFeatures` (an operator managing a
   sub-account). Both land in the same `orgs.disabledFeatures` list,
   which the access engine enforces on every call.
   ============================================================ */

/** One row per module: what it is, whether it is owned, on, and switchable. */
export const board = query({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, { orgId: argOrgId }) => {
    // An agency viewer passes the sub-account it is managing; a studio member
    // gets their own workspace and cannot ask about anyone else's.
    let orgId: string;
    if (argOrgId) {
      await requireCapability(ctx, "agency.viewAll", { orgId: argOrgId });
      orgId = argOrgId;
    } else {
      orgId = await currentOrg(ctx);
    }

    const { tier, disabled } = await orgGate(ctx, orgId);
    const owned = capabilitiesForTier(tier);

    const areas = moduleBoard().map((group) => ({
      area: group.area,
      label: group.label,
      modules: group.modules.map((m) => {
        const isOwned = owned.has(m.key);
        const switchable = !m.core && isOwned;
        const off = isToggleable(m.key) && disabled.has(m.key);
        return {
          key: m.key,
          label: m.label,
          blurb: m.blurb,
          nav: m.nav,
          core: m.core === true,
          tier: m.tier,
          tierLabel: m.tier ? PLAN_LIMITS[m.tier].label : null,
          tierPrice: m.tier ? priceLabel(m.tier) : null,
          owned: isOwned,
          enabled: isOwned && !off,
          switchable,
          // Why the switch is not usable, for the UI to say out loud.
          lockedReason: m.core
            ? ("core" as const)
            : !isOwned
              ? ("tier" as const)
              : null,
        };
      }),
      // Not switchable by anyone: platform guarantees and agency-side
      // surfaces. Listed so the board mirrors the feature catalog.
      alwaysOn: group.alwaysOn.map((a) => ({
        id: a.id,
        label: a.label,
        blurb: a.blurb,
        kind: a.kind,
        tier: a.tier ?? null,
        tierLabel: a.tier ? PLAN_LIMITS[a.tier].label : null,
        available: a.kind === "always" || (a.tier ? owned.has("multiStudio") : true),
      })),
    }));

    const flat = areas.flatMap((a) => a.modules);
    return {
      orgId,
      tier,
      tierLabel: PLAN_LIMITS[tier].label,
      tierPrice: priceLabel(tier),
      areas,
      counts: {
        total: flat.length,
        owned: flat.filter((m) => m.owned).length,
        enabled: flat.filter((m) => m.enabled).length,
        offByChoice: flat.filter((m) => m.owned && !m.enabled).length,
        lockedByTier: flat.filter((m) => !m.owned).length,
      },
    };
  },
});

/** Switch one module on or off for the caller's own workspace.
 *
 *  A studio owner curating their own sidebar. Refuses to switch ON anything
 *  the plan does not include, and refuses to switch OFF a core module. */
export const setModule = mutation({
  args: { key: v.string(), enabled: v.boolean() },
  handler: async (ctx, { key, enabled }) => {
    await requireCapability(ctx, "branding.edit"); // owner + manager
    const orgId = await currentOrg(ctx);

    if (!isModuleKey(key)) throw new Error(`${key} is not a module.`);
    const mod = moduleFor(key)!;
    if (mod.core) {
      throw new ConvexError({
        code: "MODULE_CORE",
        message: `${mod.label} is part of the core product and cannot be switched off.`,
      });
    }

    const { tier, disabled } = await orgGate(ctx, orgId);
    if (enabled && !capabilitiesForTier(tier).has(key as CapabilityKey)) {
      throw new ConvexError({
        code: "UPGRADE_REQUIRED",
        capability: key,
        currentTier: tier,
        message: `${mod.label} is not on your plan.`,
      });
    }

    const next = new Set(disabled);
    if (enabled) next.delete(key);
    else next.add(key);

    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error("Workspace not found.");
    // Only ever persist real, toggleable keys, so a stale row cannot
    // accumulate junk that outlives a renamed module.
    await ctx.db.patch(org._id, {
      disabledFeatures: [...next].filter(isToggleable),
    });
    return { key, enabled };
  },
});

/** Turn everything the plan includes back on. The way out of a workspace
 *  somebody switched half of off and then left. */
export const enableAll = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "branding.edit");
    const orgId = await currentOrg(ctx);
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error("Workspace not found.");
    await ctx.db.patch(org._id, { disabledFeatures: [] });
    return { restored: (org.disabledFeatures ?? []).length };
  },
});

/** The registry itself, for surfaces that need labels without an org read. */
export const catalog = query({
  args: {},
  handler: async () => MODULES.map((m) => ({ ...m, core: m.core === true })),
});
