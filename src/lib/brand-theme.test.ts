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
    for (const accent of ["#ffffff", "#000000", "#c9c9c9"]) {
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
