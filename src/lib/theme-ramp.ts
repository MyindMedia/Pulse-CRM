/* ============================================================
   Deriving a whole interface from a handful of chosen colours.

   A studio picks a background, a text colour and a brand colour.
   The app needs far more than three: a ladder of surfaces so cards
   lift off the page, hairlines that read as edges and not lines,
   four weights of text, an accent family for hover and press
   states, and shadows tinted to the brand so the glow belongs to
   them rather than to us.

   All of it is computed from what they picked, which is the only
   way the result stays coherent. Handing someone eleven colour
   pickers produces a mess; handing them three and doing the
   arithmetic produces an interface.
   ============================================================ */

export type Rgb = { r: number; g: number; b: number };

export function hexToRgb(hex: string): Rgb {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function rgbToHex({ r, g, b }: Rgb): string {
  return "#" + [r, g, b].map((c) => clamp(c).toString(16).padStart(2, "0")).join("");
}

/** Blend two colours. t = 0 returns a, t = 1 returns b. */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex({
    r: x.r + (y.r - x.r) * t,
    g: x.g + (y.g - x.g) * t,
    b: x.b + (y.b - x.b) * t,
  });
}

export const lighten = (hex: string, t: number) => mix(hex, "#ffffff", t);
export const darken = (hex: string, t: number) => mix(hex, "#000000", t);

/** WCAG relative luminance. Drives every "is this a dark theme" decision, so
 *  the ramp reacts to the colour rather than to an assumption about it. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export const isDark = (hex: string) => luminance(hex) < 0.4;

/** Black or white, whichever is actually readable on this colour. Used for
 *  text sitting ON the brand colour, where guessing produces a button nobody
 *  can read. */
export function readableInk(hex: string): string {
  return luminance(hex) > 0.45 ? darken(hex, 0.82) : "#ffffff";
}

export function rgbaString(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export type ThemeInput = {
  background: string;
  surface: string;
  text: string;
  primary: string;
  accent: string;
  muted: string;
  border: string;
};

/**
 * The full token set the app actually styles against.
 *
 * Every key here already exists in globals.css. Nothing new is invented,
 * because a variable the stylesheets do not read paints nothing - which is
 * exactly what the first version of this did.
 */
export function buildThemeVars(t: ThemeInput): Record<string, string> {
  const dark = isDark(t.background);
  // On a dark theme surfaces step UP toward the light; on a light theme they
  // step DOWN into shadow. Same ramp, opposite direction.
  const step = (n: number) =>
    dark ? lighten(t.background, n) : darken(t.background, n * 0.6);

  const onBrand = readableInk(t.primary);
  const hair = t.border;

  return {
    /* Surfaces, lowest to highest. Cards lift because each step is a real
       colour change, not an overlay. */
    "--color-ink": t.background,
    "--color-ink-2": step(0.02),
    "--color-obsidian": step(0.03),
    "--color-coal": t.surface || step(0.05),
    "--color-coal-2": step(0.08),
    "--color-coal-3": step(0.12),
    "--color-hairline": hair,
    "--color-hairline-2": dark ? lighten(hair, 0.18) : darken(hair, 0.18),
    "--color-graphite": hair,

    /* The brand family. Bright for hover, deep for press, dim for a resting
       edge, ink for text sitting on top of it. */
    "--color-gold": t.primary,
    "--color-gold-bright": lighten(t.accent || t.primary, 0.22),
    "--color-gold-deep": darken(t.primary, 0.22),
    "--color-gold-dim": mix(t.primary, t.background, 0.62),
    "--color-gold-ink": onBrand,

    /* Text, strongest to quietest. */
    "--color-bone": t.text,
    "--color-mist": mix(t.text, t.muted, 0.35),
    "--color-steel": t.muted,
    "--color-ash": t.muted,
    "--color-slate": mix(t.muted, t.background, 0.35),
    "--color-ash-dim": mix(t.muted, t.background, 0.45),

    /* Shadows. Tinted to the brand so the glow reads as theirs, and scaled to
       the theme: a light interface cannot take the same weight as a dark one. */
    "--shadow-card": dark
      ? "0 1px 2px rgba(0,0,0,.5), 0 10px 30px rgba(0,0,0,.4)"
      : `0 1px 3px ${rgbaString(darken(t.background, 0.7), 0.08)}, 0 12px 28px -8px ${rgbaString(darken(t.background, 0.7), 0.14)}`,
    "--shadow-pop": dark
      ? "0 30px 80px rgba(0,0,0,.65), 0 2px 8px rgba(0,0,0,.5)"
      : `0 24px 60px -12px ${rgbaString(darken(t.background, 0.7), 0.22)}`,
    "--shadow-brutal": `5px 5px 0 0 ${dark ? "#000" : darken(t.background, 0.85)}`,
    "--shadow-brutal-gold": `5px 5px 0 0 ${t.primary}`,
    "--shadow-glow-gold": `0 0 0 1px ${rgbaString(t.primary, 0.35)}, 0 10px 40px ${rgbaString(t.primary, 0.18)}`,
    "--shadow-gold-soft": `0 6px 16px ${rgbaString(t.primary, 0.22)}`,
    "--shadow-gold-strong": `0 10px 24px ${rgbaString(t.primary, 0.35)}`,
  };
}
