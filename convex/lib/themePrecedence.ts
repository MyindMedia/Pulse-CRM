/* ============================================================
   Who owns which color when a studio has both Brand colors (every
   plan, branding.setBrandColors) and the Max white-label theme.

   Owner decision 2026-10-14: "brand changes should override white
   label functions color but keep other preferences custom".

   - Brand colors set: the brand primary drives the white-label
     primary, accent and email accent. Everything else in the theme
     (background, surface, text, muted, border, fonts, corners,
     density, sign-in and email copy) stays the studio's own choice.
   - Brand colors unset: the white-label theme applies exactly as it
     did before this rule existed.

   Shared by the server (theme.ts) and the Branding page preview, so
   the two can never disagree.
   ============================================================ */

import { STOCK_PRIMARY, isHexColor as isHex6 } from "./brandPresets";
import { PULSE_DEFAULT_COLORS, isHexColor, type ThemeColorKey } from "./themeSpec";

/** Color slots the brand takes over when it is set. */
export const BRAND_DRIVEN_THEME_KEYS = ["primary", "accent"] as const satisfies readonly ThemeColorKey[];

type BrandSource = {
  accentColor?: string | null;
  brandPreset?: string | null;
};

/**
 * True when the studio chose brand colors: a preset or custom pair picked in
 * Branding (brandPreset), or an accent that is not stock (set from the logo
 * or the Workspace accent). A studio that never touched any of that keeps
 * its white-label colors.
 */
export function brandColorsSet(org: BrandSource | null | undefined): boolean {
  if (!org) return false;
  if (org.brandPreset) return true;
  const a = org.accentColor?.trim().toLowerCase();
  return Boolean(a && isHex6(a) && a !== STOCK_PRIMARY);
}

/**
 * The palette a workspace paints with.
 *
 * Precedence, weakest first:
 *   1. Pulse's own defaults
 *   2. orgs.accentColor for primary and accent
 *   3. the saved white-label theme
 *   4. brand colors, for primary and accent only, when the studio set them
 *
 * Inactive (below Max) returns the defaults: brand colors still reach those
 * studios, through OrgTheme, not through this palette.
 */
export function resolveThemePalette(
  org: (BrandSource & { theme?: Partial<Record<ThemeColorKey, string>> | null }) | null | undefined,
  active: boolean,
): { colors: Record<ThemeColorKey, string>; brandDriven: boolean } {
  const colors: Record<ThemeColorKey, string> = { ...PULSE_DEFAULT_COLORS };
  if (!active) return { colors, brandDriven: false };

  const accent = org?.accentColor;
  if (accent && isHexColor(accent)) {
    colors.primary = accent.trim();
    colors.accent = accent.trim();
  }
  const saved = org?.theme;
  if (saved) {
    for (const k of Object.keys(PULSE_DEFAULT_COLORS) as ThemeColorKey[]) {
      const val = saved[k];
      if (val && isHexColor(val)) colors[k] = val;
    }
  }
  const brandDriven = brandColorsSet(org) && Boolean(accent && isHexColor(accent));
  if (brandDriven) {
    for (const k of BRAND_DRIVEN_THEME_KEYS) colors[k] = accent!.trim();
  }
  return { colors, brandDriven };
}

/** The email accent: the brand primary when brand colors drive the theme,
 *  else the studio's saved email accent, else the theme primary. */
export function resolveEmailAccent(
  saved: { emailHeaderColor?: string | null } | null | undefined,
  palette: { colors: Record<ThemeColorKey, string>; brandDriven: boolean },
  active: boolean,
): string {
  if (palette.brandDriven) return palette.colors.primary;
  return (active && saved?.emailHeaderColor) || palette.colors.primary;
}
