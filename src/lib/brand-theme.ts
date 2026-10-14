/* ============================================================
   Brand theming engine for sub-account white-labeling.

   - extractBrandFromImage: client-side (canvas) dominant-color
     extraction from an uploaded logo -> accent + palette.
   - deriveBrandTokens: turn one accent color into the full set of
     gold design-token overrides. Tailwind v4 compiles `bg-gold`
     etc. to var(--color-gold), so setting these vars on a wrapper
     rethemes every descendant for that org.
   ============================================================ */

import type * as React from "react";
import { STOCK_SECONDARY } from "@convex/lib/brandPresets";

const DEFAULT_ACCENT = "#fdb913";

/* ── color math ───────────────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360 / 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) return rgbToHex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return rgbToHex(hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255);
}

/* ── contrast (WCAG 2.x) ───────────────────────────────────── */

/** WCAG relative luminance of a #rrggbb color. */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

/** WCAG contrast ratio between two colors, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** AA thresholds: body text, and large text or UI parts (focus rings, icons). */
export const AA_TEXT = 4.5;
export const AA_UI = 3;

/**
 * The lightest dark surface accent text sits on in the app (the hardware
 * UI's raised face, #343438). An accent that reads at 4.5:1 here reads on
 * every darker surface too: the void, wells, cards and the booking page.
 */
export const GUARD_SURFACE = "#343438";

/**
 * Contrast guard. Nudges a color's lightness, keeping its hue and
 * saturation, until it reaches `min` against `surface` (lighter on a dark
 * surface, darker on a light one). Returns the color untouched when it
 * already passes.
 */
export function ensureContrast(
  hex: string,
  surface: string = GUARD_SURFACE,
  min: number = AA_TEXT,
): { color: string; adjusted: boolean } {
  const rgb = hexToRgb(hex);
  if (!rgb) return { color: hex, adjusted: false };
  const start = rgbToHex(...rgb);
  if (contrastRatio(start, surface) >= min) return { color: start, adjusted: false };
  const [h, s, l0] = rgbToHsl(...rgb);
  const up = relativeLuminance(surface) < 0.18;
  let l = l0;
  let color = start;
  for (let i = 0; i < 100; i++) {
    l = up ? Math.min(1, l + 0.01) : Math.max(0, l - 0.01);
    color = hslToHex(h, s, l);
    if (contrastRatio(color, surface) >= min || l <= 0 || l >= 1) break;
  }
  return { color, adjusted: true };
}

/**
 * Text color to put ON a brand color: a very dark tint of its own hue when
 * that reads at 4.5:1 (the stock look: dark ink on gold), else plain black
 * or white, whichever reads better.
 */
export function onColor(bg: string): string {
  const rgb = hexToRgb(bg);
  if (!rgb) return "#111111";
  const [h, s] = rgbToHsl(...rgb);
  const tinted = hslToHex(h, Math.min(1, s), 0.07);
  if (contrastRatio(tinted, bg) >= AA_TEXT) return tinted;
  return contrastRatio("#000000", bg) >= contrastRatio("#ffffff", bg) ? "#000000" : "#ffffff";
}

/* ── token derivation ─────────────────────────────────────── */

export type BrandTokens = Record<string, string>;

function normalizeHex(hex: string): string | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHex(...rgb) : null;
}

/**
 * One accent in, the whole gold token family out. Mirrors the shade
 * relationships of the stock palette (#fdb913 family) so contrast holds:
 *   gold        the accent itself (normalized to a usable lightness,
 *               then contrast-guarded to 4.5:1 on GUARD_SURFACE)
 *   gold-bright hover/active pop
 *   gold-deep   pressed / deep accents
 *   gold-dim    subdued borders on dark
 *   gold-ink    text ON the accent (very dark tinted, 4.5:1 or better)
 */
export function deriveBrandTokens(accent: string | null | undefined): BrandTokens | null {
  if (!accent) return null;
  const rgb = hexToRgb(accent);
  if (!rgb) return null;
  const normalized = rgbToHex(...rgb);
  if (normalized === DEFAULT_ACCENT) return null; // stock brand - no override needed
  const [h, s, l] = rgbToHsl(...rgb);
  // Monochrome brands (white / black / silver accents): force-saturating a
  // colorless value invents a random hue (white used to come out dusty red).
  // Chroma, not raw saturation, is the discriminator - HSL saturation
  // explodes near white (#f2eded reads s=0.16 with almost no visible color).
  const chroma = s * (1 - Math.abs(2 * l - 1));
  if (chroma < 0.08) {
    const gold = hslToHex(h, 0.04, 0.74);
    return {
      "--color-gold": gold,
      "--color-gold-bright": hslToHex(h, 0.04, 0.88),
      "--color-gold-deep": hslToHex(h, 0.05, 0.52),
      "--color-gold-dim": hslToHex(h, 0.05, 0.27),
      "--color-gold-ink": onColor(gold),
    };
  }
  // Keep the accent itself usable on dark UI: floor very dark logos up,
  // then let the contrast guard lift anything still under 4.5:1. Light and
  // pastel brands keep most of their lightness (capped at 0.82 so hover and
  // the glow ramp still have headroom) instead of being pushed to a mid tone.
  const baseS = Math.max(0.45, s);
  const gold = ensureContrast(hslToHex(h, baseS, Math.max(0.42, Math.min(0.82, l)))).color;
  const baseL = rgbToHsl(...hexToRgb(gold)!)[2];
  return {
    "--color-gold": gold,
    "--color-gold-bright": hslToHex(h, Math.min(1, baseS * 1.05), Math.min(0.9, baseL + 0.16)),
    "--color-gold-deep": hslToHex(h, Math.min(1, baseS * 1.1), Math.max(0.26, baseL - 0.18)),
    "--color-gold-dim": hslToHex(h, baseS * 0.75, 0.24),
    "--color-gold-ink": onColor(gold),
  };
}

/** "r, g, b" for rgba(var(--x), alpha) in CSS. Legacy comma syntax on
 *  purpose: a gradient whose stops are all legacy rgba() interpolates in
 *  sRGB, while modern rgb(r g b / a) switches it to Oklab and shifts the
 *  stock pixels. */
function rgbTriplet(hex: string): string {
  const rgb = hexToRgb(hex);
  return rgb ? rgb.join(", ") : "0, 0, 0";
}

export type BrandTheme = {
  /** Every CSS custom property to set on the themed root. */
  tokens: BrandTokens;
  /** The accent as rendered (normalized + contrast-guarded). */
  accent: string;
  /** The secondary as rendered. */
  secondary: string;
  /** Text color on the accent. */
  onAccent: string;
  /** Contrast of accent text on GUARD_SURFACE and of onAccent on the accent. */
  contrast: { accentOnSurface: number; onAccent: number };
  /** True when the guard had to move the studio's color to pass AA. */
  adjusted: boolean;
};

/** Stock values the CSS ships with (hardware.css / globals.css :root). */
export const STOCK_TOKENS = {
  plYellow: "#ffc900",
  plCopper: "#d0947b",
  plAmber: "#ffd696",
  brand: DEFAULT_ACCENT,
} as const;

/** Every key deriveBrandTheme can set, so a theme can be cleanly removed. */
export const BRAND_THEME_KEYS = [
  "--color-gold",
  "--color-gold-bright",
  "--color-gold-deep",
  "--color-gold-dim",
  "--color-gold-ink",
  "--brand-rgb",
  "--pl-yellow",
  "--pl-yellow-hover",
  "--pl-yellow-top",
  "--pl-yellow-press",
  "--pl-yellow-edge",
  "--pl-yellow-edge-deep",
  "--pl-yellow-rgb",
  "--pl-on-yellow",
  "--pl-copper",
  "--pl-copper-rgb",
  "--pl-amber-rgb",
] as const;

/**
 * The full studio brand token set from a primary accent and an optional
 * secondary. Covers the accent ramp (buttons, highlights, focus rings,
 * chart accents), the room light's glow colors (the animated background's
 * three pools and its tinted tiles), the booking/kiosk wash and the text
 * color on the accent. Returns null for the stock look, so an unbranded
 * studio sets nothing and renders exactly as before.
 */
export function deriveBrandTheme(
  primary: string | null | undefined,
  secondary?: string | null,
): BrandTheme | null {
  const p = primary ? normalizeHex(primary) : null;
  const sec = secondary ? normalizeHex(secondary) : null;
  const primaryIsStock = !p || p === DEFAULT_ACCENT;
  const secondaryIsStock = !sec || sec === STOCK_SECONDARY;
  if (primaryIsStock && secondaryIsStock) return null;

  const tokens: BrandTokens = {};

  // Secondary: what they picked, floored so it still glows on the dark
  // void; without one, a softer, warmer neighbor of the accent (the stock
  // copper sits about 30 degrees warmer than the stock yellow).
  let secondaryHex: string;
  if (sec) {
    const [h, s, l] = rgbToHsl(...hexToRgb(sec)!);
    secondaryHex = l < 0.45 ? hslToHex(h, s, 0.45) : sec;
  } else if (p && !primaryIsStock) {
    const [h, s] = rgbToHsl(...hexToRgb(p)!);
    secondaryHex = hslToHex(h - 30, Math.min(0.55, s * 0.55), 0.65);
  } else {
    secondaryHex = STOCK_SECONDARY;
  }
  if (!secondaryIsStock || !primaryIsStock) {
    tokens["--pl-copper"] = secondaryHex;
    tokens["--pl-copper-rgb"] = rgbTriplet(secondaryHex);
  }

  if (primaryIsStock) {
    // Stock gold with a custom secondary: only the secondary moves.
    return {
      tokens,
      accent: STOCK_TOKENS.plYellow,
      secondary: secondaryHex,
      onAccent: "#111111",
      contrast: {
        accentOnSurface: contrastRatio(STOCK_TOKENS.plYellow, GUARD_SURFACE),
        onAccent: contrastRatio("#111111", STOCK_TOKENS.plYellow),
      },
      adjusted: false,
    };
  }

  const gold = deriveBrandTokens(p)!;
  Object.assign(tokens, gold);
  const accent = gold["--color-gold"];
  const onAccent = gold["--color-gold-ink"];
  const [h, s, l] = rgbToHsl(...hexToRgb(accent)!);
  const mono = s < 0.1;

  // Hardware UI key ramp, in the stock relationships: #ffc900 face,
  // #ffd633 hover (+0.1 L), #ffe066 hover top (+0.2), #e0b000 pressed
  // (-0.06), #8a6d00 / #5c4900 key edges (L 0.27 / 0.18).
  tokens["--pl-yellow"] = accent;
  tokens["--pl-yellow-hover"] = hslToHex(h, s, Math.min(0.92, l + 0.1));
  tokens["--pl-yellow-top"] = hslToHex(h, s, Math.min(0.95, l + 0.2));
  tokens["--pl-yellow-press"] = hslToHex(h, s, Math.max(0.2, l - 0.06));
  tokens["--pl-yellow-edge"] = hslToHex(h, s, mono ? 0.32 : 0.27);
  tokens["--pl-yellow-edge-deep"] = hslToHex(h, s, mono ? 0.22 : 0.18);
  tokens["--pl-yellow-rgb"] = rgbTriplet(accent);
  tokens["--pl-on-yellow"] = onAccent;
  // The dim third pool: a pale tint of the accent (stock #ffd696).
  tokens["--pl-amber-rgb"] = rgbTriplet(hslToHex(h - 10, mono ? s : Math.min(1, s), 0.79));
  // Glows outside the hardware shell and the booking / kiosk wash.
  tokens["--brand-rgb"] = rgbTriplet(accent);

  return {
    tokens,
    accent,
    secondary: secondaryHex,
    onAccent,
    contrast: {
      accentOnSurface: contrastRatio(accent, GUARD_SURFACE),
      onAccent: contrastRatio(onAccent, accent),
    },
    adjusted: contrastRatio(p!, GUARD_SURFACE) < AA_TEXT,
  };
}

/**
 * Composite tokens that the stylesheets build from the "r, g, b" triplets at
 * :root (hardware.css, globals.css). A custom property that references
 * another is resolved where it is declared, so on <html> OrgTheme's triplets
 * flow into these by themselves; a WRAPPER (the booking page, the kiosk, a
 * preview) has to set them too or its glows stay stock. Same literal shapes
 * as the CSS, so they render identically.
 */
export function scopedBrandTokens(tokens: BrandTokens): BrandTokens {
  const out: BrandTokens = {};
  const y = tokens["--pl-yellow-rgb"];
  if (y) {
    out["--pl-yellow-soft"] = `rgba(${y}, 0.14)`;
    out["--pl-grid-line"] = `rgba(${y}, 0.05)`;
    out["--pl-glow-yellow"] = `0 0 14px 4px rgba(${y}, 0.65)`;
    out["--pl-glow-yellow-soft"] = `0 0 8px rgba(${y}, 0.6)`;
  }
  const b = tokens["--brand-rgb"];
  if (b) {
    out["--shadow-glow-gold"] = `0 0 0 1px rgba(${b}, .35), 0 10px 40px rgba(${b}, .18)`;
    out["--shadow-gold-soft"] = `inset 0 1px 0 0 rgba(255,255,255,.25), 0 1px 2px rgba(0,0,0,.45), 0 6px 16px rgba(${b}, .22)`;
    out["--shadow-gold-strong"] = `inset 0 1px 0 0 rgba(255,255,255,.3), 0 2px 4px rgba(0,0,0,.5), 0 10px 24px rgba(${b}, .35)`;
  }
  return out;
}

/**
 * The stock values of every brand key, as the hardware UI renders them.
 * Only for previews: a preview wrapper sets these explicitly so "Pulse
 * Gold" previews as stock even while the app itself wears another brand.
 */
export function stockBrandTokens(): BrandTokens {
  return {
    "--color-gold": STOCK_TOKENS.plYellow,
    "--color-gold-bright": "#ffd633",
    "--color-gold-deep": "#e0b000",
    "--color-gold-dim": "#7a6200",
    "--color-gold-ink": "#111111",
    "--brand-rgb": "253, 185, 19",
    "--pl-yellow": STOCK_TOKENS.plYellow,
    "--pl-yellow-hover": "#ffd633",
    "--pl-yellow-top": "#ffe066",
    "--pl-yellow-press": "#e0b000",
    "--pl-yellow-edge": "#8a6d00",
    "--pl-yellow-edge-deep": "#5c4900",
    "--pl-yellow-rgb": "255, 201, 0",
    "--pl-on-yellow": "#111111",
    "--pl-copper": STOCK_TOKENS.plCopper,
    "--pl-copper-rgb": "208, 148, 123",
    "--pl-amber-rgb": "255, 214, 150",
  };
}

/** Full token set for a preview: the brand's own, layered over stock. */
export function previewBrandTokens(primary: string | null | undefined, secondary?: string | null): BrandTokens {
  const tokens = { ...stockBrandTokens(), ...(deriveBrandTheme(primary, secondary)?.tokens ?? {}) };
  return { ...tokens, ...scopedBrandTokens(tokens) };
}

/** React style object for a theme wrapper (display:contents keeps layout). */
export function brandStyle(
  accent: string | null | undefined,
  secondary?: string | null,
): React.CSSProperties | undefined {
  const theme = deriveBrandTheme(accent, secondary);
  return theme
    ? ({ ...theme.tokens, ...scopedBrandTokens(theme.tokens) } as React.CSSProperties)
    : undefined;
}

/* ── logo color extraction (browser only) ─────────────────── */

export type ExtractedBrand = {
  /** The dominant vibrant color, normalized for dark UI. */
  accent: string;
  /** Top distinct colors, most prominent first (for gradient heroes). */
  palette: string[];
};

/**
 * Extract a brand accent + palette from a logo image. Pure canvas - runs
 * in the browser at upload time. Ignores transparent, near-white and
 * near-black pixels; scores hue buckets by (coverage x saturation) so a
 * vibrant mark beats a big grey background.
 */
export async function extractBrandFromImage(source: File | Blob | string): Promise<ExtractedBrand | null> {
  const url = typeof source === "string" ? source : URL.createObjectURL(source);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = "anonymous";
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const SIZE = 64;
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

    // 24 hue buckets, each accumulating weighted rgb sums.
    const buckets = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 128) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const [h, s, l] = rgbToHsl(r, g, b);
      if (l > 0.93 || l < 0.07) continue; // near-white / near-black
      if (s < 0.18) continue; // grey
      const weight = s * (1 - Math.abs(l - 0.5)); // vibrant midtones win
      const idx = Math.min(23, Math.floor((h / 360) * 24));
      buckets[idx].w += weight;
      buckets[idx].r += r * weight;
      buckets[idx].g += g * weight;
      buckets[idx].b += b * weight;
    }

    const ranked = buckets
      .map((bk, i) => ({ ...bk, i }))
      .filter((bk) => bk.w > 0)
      .sort((a, b) => b.w - a.w);
    if (ranked.length === 0) return null; // monochrome logo - keep current accent

    const toHex = (bk: { w: number; r: number; g: number; b: number }) =>
      rgbToHex(bk.r / bk.w, bk.g / bk.w, bk.b / bk.w);

    // Normalize the winner into a UI-friendly lightness band.
    const winner = toHex(ranked[0]);
    const [h, s, l] = rgbToHsl(...hexToRgb(winner)!);
    const accent = hslToHex(h, Math.max(0.5, s), Math.max(0.42, Math.min(0.6, l)));

    // Palette: winner first, then up to 3 distinct runners-up.
    const palette: string[] = [accent];
    for (const bk of ranked.slice(1)) {
      if (palette.length >= 4) break;
      const hex = toHex(bk);
      const [h2] = rgbToHsl(...hexToRgb(hex)!);
      const distinct = palette.every((p) => {
        const [hp] = rgbToHsl(...hexToRgb(p)!);
        const dh = Math.abs(((h2 - hp + 540) % 360) - 180);
        return dh > 25;
      });
      if (distinct && bk.w > ranked[0].w * 0.12) palette.push(hex);
    }
    return { accent, palette };
  } catch {
    return null;
  } finally {
    if (typeof source !== "string") URL.revokeObjectURL(url);
  }
}
