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

/* ── token derivation ─────────────────────────────────────── */

export type BrandTokens = Record<string, string>;

/**
 * One accent in, the whole gold token family out. Mirrors the shade
 * relationships of the stock palette (#fdb913 family) so contrast holds:
 *   gold        the accent itself (normalized to a usable lightness)
 *   gold-bright hover/active pop
 *   gold-deep   pressed / deep accents
 *   gold-dim    subdued borders on dark
 *   gold-ink    text ON the accent (very dark tinted)
 */
export function deriveBrandTokens(accent: string | null | undefined): BrandTokens | null {
  if (!accent) return null;
  const rgb = hexToRgb(accent);
  if (!rgb) return null;
  const normalized = accent.startsWith("#") ? accent.toLowerCase() : `#${accent.toLowerCase()}`;
  if (normalized === DEFAULT_ACCENT) return null; // stock brand - no override needed
  const [h, s, l] = rgbToHsl(...rgb);
  // Keep the accent itself usable on dark UI: floor very dark logos up.
  const baseL = Math.max(0.42, Math.min(0.62, l));
  const baseS = Math.max(0.45, s);
  return {
    "--color-gold": hslToHex(h, baseS, baseL),
    "--color-gold-bright": hslToHex(h, Math.min(1, baseS * 1.05), Math.min(0.78, baseL + 0.16)),
    "--color-gold-deep": hslToHex(h, Math.min(1, baseS * 1.1), Math.max(0.26, baseL - 0.18)),
    "--color-gold-dim": hslToHex(h, baseS * 0.75, 0.24),
    "--color-gold-ink": hslToHex(h, Math.min(1, baseS), 0.07),
  };
}

/** React style object for a theme wrapper (display:contents keeps layout). */
export function brandStyle(accent: string | null | undefined): React.CSSProperties | undefined {
  const tokens = deriveBrandTokens(accent);
  return tokens ? (tokens as React.CSSProperties) : undefined;
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
