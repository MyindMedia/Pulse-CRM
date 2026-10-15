import { describe, it, expect } from "vitest";
import { deriveBrandTokens } from "./brand-theme";

function hsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

describe("deriveBrandTokens", () => {
  it("returns null for stock gold, empty and invalid accents", () => {
    expect(deriveBrandTokens("#fdb913")).toBeNull();
    expect(deriveBrandTokens(null)).toBeNull();
    expect(deriveBrandTokens("nope")).toBeNull();
  });

  it("keeps the hue of a vivid accent", () => {
    const tokens = deriveBrandTokens("#3e63c4"); // royal blue
    expect(tokens).not.toBeNull();
    const [h, s] = hsl(tokens!["--color-gold"]);
    expect(h).toBeGreaterThan(200);
    expect(h).toBeLessThan(260);
    expect(s).toBeGreaterThan(0.4);
  });

  it("monochrome accents derive a NEUTRAL family, never a saturated hue", () => {
    // #f2eded is the real-world trap: near-white with a red tint reads
    // s=0.16 in HSL but has almost zero chroma - it must theme as silver.
    for (const accent of ["#ffffff", "#000000", "#c9c9c9", "#f2eded"]) {
      const tokens = deriveBrandTokens(accent);
      expect(tokens).not.toBeNull();
      const [, s, l] = hsl(tokens!["--color-gold"]);
      expect(s).toBeLessThan(0.1); // silver, not dusty red
      expect(l).toBeGreaterThan(0.6); // readable accent on dark UI
      const [, sInk, lInk] = hsl(tokens!["--color-gold-ink"]);
      expect(sInk).toBeLessThan(0.12);
      expect(lInk).toBeLessThan(0.12); // near-black text on the accent
    }
  });
});

import {
  BRAND_THEME_KEYS,
  GUARD_SURFACE,
  contrastRatio,
  deriveBrandTheme,
  ensureContrast,
  onColor,
  previewBrandTokens,
  brandStyle,
} from "./brand-theme";
import { BRAND_PRESETS } from "@convex/lib/brandPresets";

describe("contrast helpers", () => {
  it("computes WCAG ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  it("guard leaves a passing color alone", () => {
    const { color, adjusted } = ensureContrast("#ffc900");
    expect(adjusted).toBe(false);
    expect(color).toBe("#ffc900");
  });

  it("guard lightens a failing dark color until it reads at 4.5:1, keeping the hue", () => {
    const { color, adjusted } = ensureContrast("#1e3a8a"); // dark navy
    expect(adjusted).toBe(true);
    expect(contrastRatio(color, GUARD_SURFACE)).toBeGreaterThanOrEqual(4.5);
    const [h] = hsl(color);
    expect(h).toBeGreaterThan(215);
    expect(h).toBeLessThan(235);
  });

  it("guard darkens on a light surface", () => {
    const { color } = ensureContrast("#ffe680", "#ffffff", 3);
    expect(contrastRatio(color, "#ffffff")).toBeGreaterThanOrEqual(3);
  });

  it("text on a brand color always reaches 4.5:1", () => {
    for (const bg of ["#ffc900", "#ff0000", "#3f6fe8", "#2fbf71", "#d4d4d8", "#8b5cf6", "#7a7a7a"]) {
      expect(contrastRatio(onColor(bg), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("deriveBrandTheme", () => {
  it("returns null for the stock look so nothing is overridden", () => {
    expect(deriveBrandTheme(null)).toBeNull();
    expect(deriveBrandTheme("#fdb913")).toBeNull();
    expect(deriveBrandTheme("#FDB913", "#d0947b")).toBeNull();
    expect(brandStyle("#fdb913")).toBeUndefined();
  });

  it("every preset passes AA for accent text and for text on the accent", () => {
    for (const p of BRAND_PRESETS) {
      const theme = deriveBrandTheme(p.primary, p.secondary);
      if (p.id === "pulse-gold") {
        expect(theme).toBeNull();
        continue;
      }
      expect(theme, p.id).not.toBeNull();
      expect(theme!.contrast.accentOnSurface, p.id).toBeGreaterThanOrEqual(4.5);
      expect(theme!.contrast.onAccent, p.id).toBeGreaterThanOrEqual(4.5);
      expect(theme!.adjusted, `${p.id} should already be AA-safe`).toBe(false);
    }
  });

  it("a dark brand color is lifted and reported as adjusted", () => {
    const theme = deriveBrandTheme("#0b1f5c")!;
    expect(theme.adjusted).toBe(true);
    expect(contrastRatio(theme.accent, GUARD_SURFACE)).toBeGreaterThanOrEqual(4.5);
  });

  it("drives the hardware UI and the room light from the brand colors", () => {
    const theme = deriveBrandTheme("#3f6fe8", "#6fb6d9")!;
    const t = theme.tokens;
    expect(t["--pl-yellow"]).toBe(theme.accent);
    expect(t["--color-gold"]).toBe(theme.accent);
    expect(t["--pl-on-yellow"]).toBe(theme.onAccent);
    expect(t["--pl-copper"]).toBe("#6fb6d9");
    expect(t["--pl-copper-rgb"]).toBe("111, 182, 217");
    // legacy comma triplets, so gradients keep sRGB interpolation
    expect(t["--pl-yellow-rgb"]).toMatch(/^\d{1,3}, \d{1,3}, \d{1,3}$/);
    expect(t["--brand-rgb"]).toBe(t["--pl-yellow-rgb"]);
    expect(t["--pl-amber-rgb"]).toMatch(/^\d{1,3}, \d{1,3}, \d{1,3}$/);
    for (const key of Object.keys(t)) expect(BRAND_THEME_KEYS).toContain(key);
  });

  it("derives a secondary when none was chosen", () => {
    const theme = deriveBrandTheme("#e5484d")!;
    expect(theme.tokens["--pl-copper"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.tokens["--pl-copper"]).not.toBe("#d0947b");
  });

  it("stock gold with a custom secondary moves only the secondary", () => {
    const theme = deriveBrandTheme("#fdb913", "#6fb6d9")!;
    expect(Object.keys(theme.tokens).sort()).toEqual(["--pl-copper", "--pl-copper-rgb"]);
  });

  it("floors a very dark secondary so the glow still shows", () => {
    const theme = deriveBrandTheme("#3f6fe8", "#101020")!;
    const [, , l] = hsl(theme.tokens["--pl-copper"]);
    expect(l).toBeGreaterThanOrEqual(0.44);
  });

  it("brandStyle carries the composite glows a wrapper needs", () => {
    const style = brandStyle("#3f6fe8") as Record<string, string>;
    expect(style["--shadow-gold-soft"]).toContain(`rgba(${style["--brand-rgb"]}, .22)`);
    expect(style["--pl-yellow-soft"]).toBe(`rgba(${style["--pl-yellow-rgb"]}, 0.14)`);
  });

  it("previews stock explicitly, so Pulse Gold previews as stock inside a branded app", () => {
    const t = previewBrandTokens("#fdb913");
    expect(t["--pl-yellow"]).toBe("#ffc900");
    expect(t["--pl-yellow-rgb"]).toBe("255, 201, 0");
    expect(t["--pl-copper"]).toBe("#d0947b");
  });
});

describe("light brand colors", () => {
  it("a pastel stays light instead of being pushed to a mid tone", () => {
    const theme = deriveBrandTheme("#f9d7e8", "#9ee6d0")!;
    const [, , l] = hsl(theme.accent);
    expect(l).toBeGreaterThan(0.75);
    expect(theme.contrast.onAccent).toBeGreaterThanOrEqual(4.5);
    expect(theme.contrast.accentOnSurface).toBeGreaterThanOrEqual(4.5);
  });
});
