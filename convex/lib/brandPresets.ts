/* ============================================================
   Studio brand color presets, shared by the server (validation in
   branding.setBrandColors) and the Branding settings panel.

   Every plan gets these (decision 2026-10-14). A preset is a primary
   accent plus a secondary color: the primary drives buttons, highlights,
   focus rings, chart accents and the main pool of the animated
   background; the secondary tints the second pool and the copper tiles.
   "pulse-gold" is the stock look and renders exactly like an unbranded
   studio.
   ============================================================ */

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_RE.test(value);
}

/** Stock Pulse colors. The app's own palette, never a studio override. */
export const STOCK_PRIMARY = "#fdb913";
export const STOCK_SECONDARY = "#d0947b";

/* Preset primaries are already AA-safe as text on the app's dark surfaces
   (4.5:1 on #343438, see GUARD_SURFACE in src/lib/brand-theme.ts), so the
   contrast guard never has to move them; the deep secondaries carry the
   preset's mood in the background glow, where text never sits. */
export type BrandPreset = {
  id: string;
  label: string;
  primary: string;
  secondary: string;
};

export const BRAND_PRESETS: readonly BrandPreset[] = [
  { id: "pulse-gold", label: "Pulse Gold", primary: STOCK_PRIMARY, secondary: STOCK_SECONDARY },
  { id: "midnight-blue", label: "Midnight Blue", primary: "#7a9bef", secondary: "#3557c9" },
  { id: "crimson", label: "Crimson", primary: "#ed7e81", secondary: "#c22f38" },
  { id: "emerald", label: "Emerald", primary: "#2fbf71", secondary: "#8fd1b5" },
  { id: "violet", label: "Violet", primary: "#ac8bf9", secondary: "#6d3fd6" },
  { id: "mono", label: "Mono", primary: "#d4d4d8", secondary: "#8a8a90" },
] as const;

export const CUSTOM_PRESET_ID = "custom";
export const DEFAULT_PRESET_ID = "pulse-gold";

export function presetById(id: string | null | undefined): BrandPreset | null {
  if (!id) return null;
  return BRAND_PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * The studio's secondary brand color. Only a studio that chose colors in the
 * Branding panel (brandPreset set) has one; a palette that came from logo
 * extraction alone is a set of logo colors, not a chosen secondary, so the
 * theme derives the secondary from the accent instead.
 */
export function brandSecondaryOf(org: {
  brandPreset?: string | null;
  brandPalette?: string[] | null;
}): string | null {
  if (!org.brandPreset) return null;
  const second = org.brandPalette?.[1];
  return isHexColor(second) ? second.toLowerCase() : null;
}
