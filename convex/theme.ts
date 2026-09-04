import { query, internalQuery } from "./_generated/server";
import { mutation } from "./functions";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requireCapability } from "./lib/access";
import { currentOrg } from "./lib/tenant";
import { orgHasFeature } from "./lib/entitlements";
import { tierForOrg } from "./lib/tier";
import { PLAN_LIMITS } from "./lib/plans";
import {
  isHexColor,
  isThemeFont,
  contrastRatio,
  MIN_TEXT_CONTRAST,
  THEME_COLOR_VARS,
  PULSE_DEFAULT_COLORS,
  RADIUS_PX,
  DENSITY_SCALE,
  type ThemeColorKey,
} from "./lib/themeSpec";

/* ============================================================
   White-label theming - the Label tier's defining feature.

   `get` is readable by any member (the shell needs it to paint), and
   degrades to the Pulse defaults for tiers that never bought theming.
   `save` requires theme.edit, which the access engine additionally
   gates on the whiteLabelUi entitlement.
   ============================================================ */

const themeArgs = {
  appName: v.optional(v.string()),
  wordmark: v.optional(v.string()),
  primary: v.optional(v.string()),
  accent: v.optional(v.string()),
  background: v.optional(v.string()),
  surface: v.optional(v.string()),
  text: v.optional(v.string()),
  muted: v.optional(v.string()),
  border: v.optional(v.string()),
  fontHeading: v.optional(v.string()),
  fontBody: v.optional(v.string()),
  radius: v.optional(v.union(v.literal("sharp"), v.literal("soft"), v.literal("round"))),
  density: v.optional(v.union(v.literal("compact"), v.literal("comfortable"))),
  mode: v.optional(v.union(v.literal("dark"), v.literal("light"), v.literal("system"))),
  loginHeadline: v.optional(v.string()),
  loginSubhead: v.optional(v.string()),
  emailHeaderColor: v.optional(v.string()),
  emailFooterText: v.optional(v.string()),
};

const COLOR_KEYS = Object.keys(THEME_COLOR_VARS) as ThemeColorKey[];

/**
 * The theme the shell should paint, already merged over the Pulse defaults.
 * Returns `active: false` for any tier below Label, so a downgrade instantly
 * reverts the app to Pulse chrome without deleting the studio's saved theme.
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    const tier = await tierForOrg(ctx, orgId);
    const active = PLAN_LIMITS[tier].whitelabel === "full";
    const saved = org?.theme;

    const colors: Record<string, string> = { ...PULSE_DEFAULT_COLORS };
    if (active && saved) {
      for (const k of COLOR_KEYS) {
        const val = saved[k];
        if (val && isHexColor(val)) colors[k] = val;
      }
    }

    return {
      active,
      tier,
      // Never removable, at any tier or price.
      poweredByPulse: true,
      appName: (active && saved?.appName) || null,
      wordmark: (active && saved?.wordmark) || null,
      colors,
      // Custom-property name -> value. Typed loosely on purpose: the keys are
      // derived from THEME_COLOR_VARS, so a literal type here would drift the
      // moment a color slot is added.
      cssVars: {
        ...Object.fromEntries(
          COLOR_KEYS.map((k) => [THEME_COLOR_VARS[k], colors[k]]),
        ),
        "--radius": RADIUS_PX[(active && saved?.radius) || "soft"],
        "--density": DENSITY_SCALE[(active && saved?.density) || "comfortable"],
      } as Record<string, string>,
      fontHeading: (active && saved?.fontHeading) || null,
      fontBody: (active && saved?.fontBody) || null,
      radius: (active && saved?.radius) || "soft",
      density: (active && saved?.density) || "comfortable",
      mode: (active && saved?.mode) || "dark",
      loginHeadline: (active && saved?.loginHeadline) || null,
      loginSubhead: (active && saved?.loginSubhead) || null,
      loginBackgroundUrl:
        active && saved?.loginBackgroundId
          ? await ctx.storage.getUrl(saved.loginBackgroundId)
          : null,
      emailHeaderColor: (active && saved?.emailHeaderColor) || colors.primary,
      emailFooterText: (active && saved?.emailFooterText) || null,
    };
  },
});

/** Save the white-label theme. Partial: only the keys passed are written. */
export const save = mutation({
  args: themeArgs,
  handler: async (ctx, args) => {
    // requireCapability enforces BOTH the role (theme.edit) and the tier
    // (whiteLabelUi), throwing UPGRADE_REQUIRED for anything below Label.
    await requireCapability(ctx, "theme.edit");
    const orgId = await currentOrg(ctx);
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error("Workspace not found.");

    const next: Record<string, unknown> = { ...(org.theme ?? {}) };

    for (const k of COLOR_KEYS) {
      const val = args[k];
      if (val === undefined) continue;
      if (!isHexColor(val)) throw new Error(`${k} must be a hex color like #1A1A1A.`);
      next[k] = val.trim();
    }
    if (args.emailHeaderColor !== undefined) {
      if (!isHexColor(args.emailHeaderColor)) throw new Error("Email header color must be a hex color.");
      next.emailHeaderColor = args.emailHeaderColor.trim();
    }

    // A studio can pick any brand colors it likes, but not a combination that
    // makes its own app unreadable. Checked against the merged result, not just
    // the incoming keys, so changing one half of a pair is still caught.
    const bg = (next.background as string) ?? PULSE_DEFAULT_COLORS.background;
    const fg = (next.text as string) ?? PULSE_DEFAULT_COLORS.text;
    const ratio = contrastRatio(bg, fg);
    if (ratio < MIN_TEXT_CONTRAST) {
      throw new ConvexError({
        code: "THEME_CONTRAST",
        message:
          `Text on background is ${ratio.toFixed(1)}:1. It needs ${MIN_TEXT_CONTRAST}:1 to stay readable. ` +
          `Lighten the text or darken the background.`,
      });
    }

    for (const k of ["fontHeading", "fontBody"] as const) {
      const val = args[k];
      if (val === undefined) continue;
      if (val && !isThemeFont(val)) throw new Error(`${val} is not an available font.`);
      next[k] = val || undefined;
    }

    for (const k of ["radius", "density", "mode"] as const) {
      if (args[k] !== undefined) next[k] = args[k];
    }
    for (const k of ["appName", "wordmark", "loginHeadline", "loginSubhead", "emailFooterText"] as const) {
      if (args[k] !== undefined) next[k] = args[k]?.trim() || undefined;
    }

    const identity = await ctx.auth.getUserIdentity();
    next.updatedAt = Date.now();
    next.updatedBy = identity?.subject ?? "system";

    await ctx.db.patch(org._id, { theme: next as typeof org.theme });
  },
});

/** Upload target for the branded sign-in background. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "theme.edit");
    return await ctx.storage.generateUploadUrl();
  },
});

export const setLoginBackground = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    await requireCapability(ctx, "theme.edit");
    const orgId = await currentOrg(ctx);
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error("Workspace not found.");
    await ctx.db.patch(org._id, {
      theme: { ...(org.theme ?? {}), loginBackgroundId: storageId },
    });
  },
});

/** Drop the custom theme and go back to Pulse chrome. */
export const reset = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "theme.edit");
    const orgId = await currentOrg(ctx);
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error("Workspace not found.");
    await ctx.db.patch(org._id, { theme: undefined });
  },
});

/** Whether this workspace may theme the app at all - drives the settings UI. */
export const canTheme = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    return await orgHasFeature(ctx, orgId, "whiteLabelUi");
  },
});


/* ============================================================
   Public theming.

   A studio's clients never sign in. They land on a booking page, a
   portal link or a review form, and those are the surfaces that
   most need to look like the studio rather than like Pulse.

   Resolved from the slug or a grant token, so no auth is needed and
   no private field is exposed - this returns colours and copy, and
   nothing else.
   ============================================================ */

/** Shared shape builder, so the public and private paths cannot drift. */
async function themeFor(ctx: QueryCtx, org: Doc<"orgs"> | null) {
  const tier = org ? await tierForOrg(ctx, org.orgId) : "studio";
  const active = Boolean(org) && PLAN_LIMITS[tier].whitelabel === "full";
  const saved = org?.theme;

  const colors: Record<string, string> = { ...PULSE_DEFAULT_COLORS };
  if (active && saved) {
    for (const k of COLOR_KEYS) {
      const val = saved[k];
      if (val && isHexColor(val)) colors[k] = val;
    }
  }
  return { active, tier, saved, colors };
}

/** PUBLIC. The theme for a studio's client-facing pages, by booking slug. */
export const publicBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    const { active, colors, saved } = await themeFor(ctx, org ?? null);
    return {
      active,
      // Never removable, on any surface.
      poweredByPulse: true,
      appName: (active && saved?.appName) || org?.name || null,
      colors,
      fontHeading: (active && saved?.fontHeading) || null,
      fontBody: (active && saved?.fontBody) || null,
      radius: (active && saved?.radius) || "soft",
      logoUrl: org?.logoId ? await ctx.storage.getUrl(org.logoId) : null,
      loginHeadline: (active && saved?.loginHeadline) || null,
      loginSubhead: (active && saved?.loginSubhead) || null,
      loginBackgroundUrl:
        active && saved?.loginBackgroundId
          ? await ctx.storage.getUrl(saved.loginBackgroundId)
          : null,
    };
  },
});

/** PUBLIC. Same, resolved from a magic-link grant token (portal, review,
 *  signature pages), which is how a client reaches those surfaces. */
export const publicByGrant = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const grant = await ctx.db
      .query("collaboratorGrants")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    const org = grant
      ? await ctx.db
          .query("orgs")
          .withIndex("by_org", (q) => q.eq("orgId", grant.orgId))
          .first()
      : null;
    const { active, colors, saved } = await themeFor(ctx, org ?? null);
    return {
      active,
      poweredByPulse: true,
      appName: (active && saved?.appName) || org?.name || null,
      colors,
      fontHeading: (active && saved?.fontHeading) || null,
      fontBody: (active && saved?.fontBody) || null,
      radius: (active && saved?.radius) || "soft",
      logoUrl: org?.logoId ? await ctx.storage.getUrl(org.logoId) : null,
    };
  },
});

/** INTERNAL. The colours an outgoing client email should wear. */
export const _emailTheme = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    const { active, colors, saved } = await themeFor(ctx, org ?? null);
    return {
      active,
      accent: (active && saved?.emailHeaderColor) || colors.primary,
      footerText: (active && saved?.emailFooterText) || null,
      appName: (active && saved?.appName) || org?.name || null,
    };
  },
});
