/* ============================================================
   White-label theme spec - shared by the server validator and the
   client renderer so they can never disagree about what is legal.

   Only the Label tier ($499.99) may write a theme. The "Powered by
   Pulse" lockup under the studio's logo is not part of the theme and
   cannot be switched off from here. See plans.ts.
   ============================================================ */

/** Fonts the app can actually serve. A theme naming anything else is
 *  rejected rather than silently falling back to a system font. */
export const THEME_FONTS = [
  "Inter",
  "Geist",
  "Satoshi",
  "General Sans",
  "Manrope",
  "Space Grotesk",
  "IBM Plex Sans",
  "Sora",
  "Outfit",
  "DM Sans",
  "Playfair Display",
  "Fraunces",
  "Instrument Serif",
  "JetBrains Mono",
] as const;
export type ThemeFont = (typeof THEME_FONTS)[number];

export const THEME_RADII = ["sharp", "soft", "round"] as const;
export const THEME_DENSITIES = ["compact", "comfortable"] as const;
export const THEME_MODES = ["dark", "light", "system"] as const;

/** Corner radius in px for each shape language, applied as --radius. */
export const RADIUS_PX: Record<(typeof THEME_RADII)[number], string> = {
  sharp: "2px",
  soft: "10px",
  round: "18px",
};

/** Base spacing scale per density, applied as --density. */
export const DENSITY_SCALE: Record<(typeof THEME_DENSITIES)[number], string> = {
  compact: "0.875",
  comfortable: "1",
};

/** Every themeable color slot and the CSS custom property it drives. */
export const THEME_COLOR_VARS = {
  primary: "--brand-primary",
  accent: "--brand-accent",
  background: "--brand-bg",
  surface: "--brand-surface",
  text: "--brand-text",
  muted: "--brand-muted",
  border: "--brand-border",
} as const;
export type ThemeColorKey = keyof typeof THEME_COLOR_VARS;

/** Pulse's own palette. A theme that sets nothing renders exactly this. */
export const PULSE_DEFAULT_COLORS: Record<ThemeColorKey, string> = {
  primary: "#FDB913",
  accent: "#FDB913",
  background: "#1A1A1A",
  surface: "#212121",
  text: "#FAFAFA",
  muted: "#A1A1AA",
  border: "#2E2E2E",
};

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** True for a 3- or 6-digit hex color. Anything else is rejected: a bad value
 *  here would land in a CSS custom property and could break the whole shell. */
export function isHexColor(v: string): boolean {
  return HEX.test(v.trim());
}

export function isThemeFont(v: string): v is ThemeFont {
  return (THEME_FONTS as readonly string[]).includes(v);
}

/** Relative luminance, per WCAG. Used to keep text readable on a custom bg. */
export function luminance(hex: string): number {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA for body text. A studio can pick any brand colors it likes, but
 *  not a combination that makes its own app unreadable. */
export const MIN_TEXT_CONTRAST = 4.5;
