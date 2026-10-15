/* ============================================================
   The Branding page's draft: every look-and-feel control edits this
   local copy, the preview renders it, and nothing reaches the studio
   until Apply. Pure functions only, so the rules (what changed, what
   gets saved, which tokens the preview paints) are unit tested.

   Three saved sources feed one draft:
   - colors: branding.setBrandColors (every plan)
   - look:   branding.setUiStyle (every plan)
   - theme:  theme.save (the Max white-label theme)
   ============================================================ */

import {
  CUSTOM_PRESET_ID,
  DEFAULT_PRESET_ID,
  STOCK_PRIMARY,
  STOCK_SECONDARY,
  presetById,
} from "@convex/lib/brandPresets";
import {
  MIN_TEXT_CONTRAST,
  PULSE_DEFAULT_COLORS,
  contrastRatio,
  isHexColor as isThemeHex,
  type ThemeColorKey,
} from "@convex/lib/themeSpec";
import {
  BRAND_OWNED_THEME_VARS,
  brandGoldFor,
  brandGuardFor,
  deriveBrandTheme,
  previewBrandTokens,
} from "@/lib/brand-theme";
import { buildThemeVars, hardwareRadiusVars, isDark } from "@/lib/theme-ramp";
import { themeFontVars } from "@/lib/theme-fonts";

export type Look = "hardware" | "glass";

export type ColorsDraft = { preset: string; primary: string; secondary: string };

export const THEME_COLOR_KEYS: readonly ThemeColorKey[] = [
  "primary",
  "accent",
  "background",
  "surface",
  "text",
  "muted",
  "border",
];

export const THEME_DRAFT_KEYS = [
  "appName",
  ...THEME_COLOR_KEYS,
  "fontHeading",
  "fontBody",
  "radius",
  "density",
  "loginHeadline",
  "loginSubhead",
  "emailHeaderColor",
  "emailFooterText",
] as const;
export type ThemeDraftKey = (typeof THEME_DRAFT_KEYS)[number];
export type ThemeDraft = Record<ThemeDraftKey, string>;

/** Theme keys the preview can actually show. The rest (sign-in copy, email)
 *  never appear in the app chrome. */
export const PREVIEWABLE_THEME_KEYS: readonly ThemeDraftKey[] = [
  ...THEME_COLOR_KEYS,
  "fontHeading",
  "fontBody",
  "radius",
  "density",
];

export type BrandDraft = { colors: ColorsDraft; look: Look; theme: ThemeDraft };

/** Local edits over the saved values. Absent means "as saved". */
export type BrandEdits = { colors?: ColorsDraft; look?: Look; theme?: Partial<ThemeDraft> };

const HEX6 = /^#?[0-9a-fA-F]{6}$/;
export const isHex6 = (v: string) => HEX6.test(v.trim());
export const normHex = (hex: string) =>
  (hex.trim().startsWith("#") ? hex.trim() : `#${hex.trim()}`).toLowerCase();

/** What the studio has saved for brand colors, read back as a preset or a
 *  custom pair. */
export function savedColors(org: {
  accentColor?: string | null;
  brandPreset?: string | null;
  brandSecondary?: string | null;
}): ColorsDraft {
  const accent = normHex(org.accentColor || STOCK_PRIMARY);
  const preset = presetById(org.brandPreset);
  if (preset && preset.primary === accent) {
    return { preset: preset.id, primary: preset.primary, secondary: preset.secondary };
  }
  const secondary = org.brandSecondary ? normHex(org.brandSecondary) : null;
  if (accent === STOCK_PRIMARY && (!secondary || secondary === STOCK_SECONDARY)) {
    return { preset: DEFAULT_PRESET_ID, primary: STOCK_PRIMARY, secondary: STOCK_SECONDARY };
  }
  return {
    preset: CUSTOM_PRESET_ID,
    primary: accent,
    secondary: secondary ?? deriveBrandTheme(accent)?.secondary ?? STOCK_SECONDARY,
  };
}

/** The colors a draft selection renders: a named preset's own pair, or the
 *  custom pair when both are valid hex (falling back to `fallback` per side
 *  while one is half typed). */
export function renderedColors(c: ColorsDraft, fallback: ColorsDraft): { primary: string; secondary: string } {
  const p = presetById(c.preset);
  if (p) return { primary: p.primary, secondary: p.secondary };
  return {
    primary: isHex6(c.primary) ? normHex(c.primary) : fallback.primary,
    secondary: isHex6(c.secondary) ? normHex(c.secondary) : fallback.secondary,
  };
}

/** The saved white-label theme as draft strings. */
export function savedTheme(theme: {
  appName?: string | null;
  colors: Record<string, string>;
  fontHeading?: string | null;
  fontBody?: string | null;
  radius?: string | null;
  density?: string | null;
  loginHeadline?: string | null;
  loginSubhead?: string | null;
  emailHeaderColor?: string | null;
  emailFooterText?: string | null;
} | null | undefined): ThemeDraft {
  const colors = theme?.colors ?? PULSE_DEFAULT_COLORS;
  return {
    appName: theme?.appName ?? "",
    ...(Object.fromEntries(
      THEME_COLOR_KEYS.map((k) => [k, colors[k] ?? PULSE_DEFAULT_COLORS[k]]),
    ) as Record<ThemeColorKey, string>),
    fontHeading: theme?.fontHeading ?? "",
    fontBody: theme?.fontBody ?? "",
    radius: theme?.radius ?? "soft",
    density: theme?.density ?? "comfortable",
    loginHeadline: theme?.loginHeadline ?? "",
    loginSubhead: theme?.loginSubhead ?? "",
    emailHeaderColor: theme?.emailHeaderColor ?? "",
    emailFooterText: theme?.emailFooterText ?? "",
  };
}

export function applyEdits(saved: BrandDraft, edits: BrandEdits): BrandDraft {
  return {
    colors: edits.colors ?? saved.colors,
    look: edits.look ?? saved.look,
    theme: { ...saved.theme, ...(edits.theme ?? {}) },
  };
}

function sameValue(key: ThemeDraftKey, a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  const isColor = (THEME_COLOR_KEYS as readonly string[]).includes(key) || key === "emailHeaderColor";
  return isColor ? x.toLowerCase() === y.toLowerCase() : x === y;
}

export type DraftDiff = {
  colors: boolean;
  look: boolean;
  /** Theme keys that differ from what is saved. */
  themeKeys: ThemeDraftKey[];
  dirty: boolean;
};

/** What a draft would change. Equal values typed back in count as unchanged,
 *  so undoing an edit by hand clears the Unsaved bar. */
export function diffBrandDraft(saved: BrandDraft, draft: BrandDraft): DraftDiff {
  const a = saved.colors;
  const b = draft.colors;
  let colors: boolean;
  if (b.preset !== CUSTOM_PRESET_ID) colors = b.preset !== a.preset;
  else
    colors =
      a.preset !== CUSTOM_PRESET_ID ||
      normHex(a.primary) !== normHex(b.primary) ||
      normHex(a.secondary) !== normHex(b.secondary);
  const look = saved.look !== draft.look;
  const themeKeys = THEME_DRAFT_KEYS.filter((k) => !sameValue(k, saved.theme[k], draft.theme[k]));
  return { colors, look, themeKeys, dirty: colors || look || themeKeys.length > 0 };
}

/** branding.setBrandColors arguments for a draft selection. */
export function colorsPayload(c: ColorsDraft): { preset: string; primary?: string; secondary?: string } {
  return c.preset === CUSTOM_PRESET_ID
    ? { preset: CUSTOM_PRESET_ID, primary: normHex(c.primary), secondary: normHex(c.secondary) }
    : { preset: c.preset };
}

/**
 * theme.save arguments: ONLY the changed keys, since theme.save is partial.
 * Sending every color (what the old Save did) pinned a theme primary that
 * otherwise follows the brand color. An emptied text or font field is sent as
 * "", which the server stores as unset (Pulse default).
 */
export function themePayload(draft: ThemeDraft, keys: readonly ThemeDraftKey[]): Partial<ThemeDraft> {
  const out: Partial<ThemeDraft> = {};
  for (const k of keys) out[k] = draft[k].trim();
  return out;
}

/** The first problem that would make Apply fail server side, in plain words,
 *  or null. Checked before any mutation runs so Apply is all or nothing for
 *  the common mistakes. */
export function draftProblem(draft: BrandDraft, diff: DraftDiff, includeTheme: boolean): string | null {
  if (diff.colors && draft.colors.preset === CUSTOM_PRESET_ID) {
    if (!isHex6(draft.colors.primary) || !isHex6(draft.colors.secondary)) {
      return "Brand colors must be 6-digit hex values, like #3F6FE8.";
    }
  }
  if (includeTheme && diff.themeKeys.length > 0) {
    for (const k of [...THEME_COLOR_KEYS, "emailHeaderColor"] as ThemeDraftKey[]) {
      const v = draft.theme[k].trim();
      if (!diff.themeKeys.includes(k)) continue;
      if (k === "emailHeaderColor" && v === "") continue;
      if (!isThemeHex(v)) return `${k === "emailHeaderColor" ? "Email accent" : k[0].toUpperCase() + k.slice(1)} must be a hex color like #1A1A1A.`;
    }
    const ratio = textContrast(draft.theme);
    if (ratio < MIN_TEXT_CONTRAST) {
      return `Text on background is ${ratio.toFixed(1)}:1. It needs ${MIN_TEXT_CONTRAST}:1 to stay readable.`;
    }
  }
  return null;
}

export function textContrast(t: ThemeDraft): number {
  try {
    return contrastRatio(t.background, t.text);
  } catch {
    return 0;
  }
}

/**
 * The theme colors the app would paint after Apply (lib/themePrecedence.ts).
 *
 * Brand-driven (the studio set brand colors, or is setting them in this
 * draft): primary and accent are the draft brand primary, whatever the theme
 * fields say. Otherwise the theme's own primary and accent, except that the
 * server fills those from orgs.accentColor when the theme never pinned them,
 * and the client only sees the merged value; a theme primary equal to the
 * saved brand color is read as following it.
 */
export function effectiveThemeColors(
  saved: BrandDraft,
  draft: BrandDraft,
  brandDriven = false,
): Record<ThemeColorKey, string> {
  const savedBrand = renderedColors(saved.colors, saved.colors).primary;
  const draftBrand = renderedColors(draft.colors, saved.colors).primary;
  const out = {} as Record<ThemeColorKey, string>;
  for (const k of THEME_COLOR_KEYS) {
    const d = draft.theme[k].trim();
    out[k] = isThemeHex(d) ? d : saved.theme[k];
    if (k !== "primary" && k !== "accent") continue;
    if (brandDriven) {
      out[k] = draftBrand;
    } else if (sameValue(k, d, saved.theme[k]) && saved.theme[k].toLowerCase() === savedBrand.toLowerCase()) {
      out[k] = draftBrand;
    }
  }
  return out;
}

/** Every attribute and token the preview root carries. */
export type PreviewScope = {
  vars: Record<string, string>;
  attrs: { "data-ui-style"?: string; "data-brand-theme"?: string; "data-whitelabel"?: string; "data-theme-mode"?: string };
};

/**
 * The tokens for a preview of `draft`, in the order the app layers them:
 * brand colors (OrgTheme) first, then the white-label theme (WhiteLabelTheme)
 * over them, with brand colors keeping the accent family when they drive the
 * theme. Scoped to the preview's own document root, so the page around it
 * never changes until Apply.
 *
 * `theme` is false when the white-label theme is off for this studio and
 * untouched in the draft, which is exactly when the app paints none either.
 */
export function previewScope(
  saved: BrandDraft,
  draft: BrandDraft,
  opts: { theme: boolean; brandDriven: boolean; radiusPx: Record<string, string> },
): PreviewScope {
  const { primary, secondary } = renderedColors(draft.colors, saved.colors);
  const attrs: PreviewScope["attrs"] = {};
  if (draft.look === "glass") attrs["data-ui-style"] = "glass";

  if (!opts.theme) {
    if (deriveBrandTheme(primary, secondary)) attrs["data-brand-theme"] = "on";
    return { vars: { ...previewBrandTokens(primary, secondary) }, attrs };
  }

  const c = effectiveThemeColors(saved, draft, opts.brandDriven);
  const guard = brandGuardFor({ active: true, brandDriven: opts.brandDriven, colors: c });
  const vars: Record<string, string> = { ...previewBrandTokens(primary, secondary, guard) };
  if (deriveBrandTheme(primary, secondary, guard)) attrs["data-brand-theme"] = "on";

  const ramp = buildThemeVars(c);
  if (opts.brandDriven) {
    for (const k of BRAND_OWNED_THEME_VARS) delete ramp[k];
    Object.assign(ramp, brandGoldFor(c.primary, guard));
  }
  Object.assign(vars, ramp);
  const r = opts.radiusPx[draft.theme.radius];
  if (r) {
    vars["--radius-chrome"] = r;
    vars["--radius-md"] = r;
  }
  Object.assign(vars, hardwareRadiusVars(draft.theme.radius));
  Object.assign(vars, themeFontVars(draft.theme.fontHeading, draft.theme.fontBody));
  attrs["data-whitelabel"] = "true";
  attrs["data-theme-mode"] = isDark(c.background) ? "dark" : "light";
  return { vars, attrs };
}
