import { describe, expect, it } from "vitest";
import { PULSE_DEFAULT_COLORS } from "./themeSpec";
import { brandColorsSet, resolveEmailAccent, resolveThemePalette } from "./themePrecedence";

const THEME = {
  primary: "#7C3AED",
  accent: "#7C3AED",
  background: "#0B0B10",
  surface: "#141420",
  text: "#F5F5FF",
  muted: "#9A9AB0",
  border: "#26263A",
  emailHeaderColor: "#7C3AED",
};

describe("brandColorsSet", () => {
  it("is off for a studio that never chose brand colors", () => {
    expect(brandColorsSet(null)).toBe(false);
    expect(brandColorsSet({})).toBe(false);
    expect(brandColorsSet({ accentColor: "#FDB913" })).toBe(false);
  });
  it("is on for a picked preset, even Pulse Gold, or a non-stock accent", () => {
    expect(brandColorsSet({ brandPreset: "pulse-gold", accentColor: "#fdb913" })).toBe(true);
    expect(brandColorsSet({ brandPreset: "emerald", accentColor: "#2fbf71" })).toBe(true);
    expect(brandColorsSet({ accentColor: "#3e63c4" })).toBe(true);
  });
});

describe("resolveThemePalette", () => {
  it("Max, brand unset: the white-label theme applies exactly as before", () => {
    const p = resolveThemePalette({ theme: THEME }, true);
    expect(p.brandDriven).toBe(false);
    expect(p.colors.primary).toBe("#7C3AED");
    expect(p.colors.accent).toBe("#7C3AED");
    expect(resolveEmailAccent(THEME, p, true)).toBe("#7C3AED");
  });

  it("Max, brand set: brand wins primary, accent and email accent; the rest stays custom", () => {
    const org = { brandPreset: "emerald", accentColor: "#2fbf71", theme: THEME };
    const p = resolveThemePalette(org, true);
    expect(p.brandDriven).toBe(true);
    expect(p.colors.primary).toBe("#2fbf71");
    expect(p.colors.accent).toBe("#2fbf71");
    expect(p.colors.background).toBe("#0B0B10");
    expect(p.colors.surface).toBe("#141420");
    expect(p.colors.text).toBe("#F5F5FF");
    expect(p.colors.border).toBe("#26263A");
    expect(resolveEmailAccent(THEME, p, true)).toBe("#2fbf71");
  });

  it("Max, accent from a logo with no theme primary: same as before", () => {
    const p = resolveThemePalette({ accentColor: "#3e63c4", theme: { background: "#0B0B10" } }, true);
    expect(p.colors.primary).toBe("#3e63c4");
    expect(p.colors.background).toBe("#0B0B10");
  });

  it("below Max: Pulse defaults whether or not brand colors are set", () => {
    for (const org of [{ theme: THEME }, { brandPreset: "emerald", accentColor: "#2fbf71", theme: THEME }]) {
      const p = resolveThemePalette(org, false);
      expect(p.brandDriven).toBe(false);
      expect(p.colors).toEqual(PULSE_DEFAULT_COLORS);
      expect(resolveEmailAccent(THEME, p, false)).toBe(PULSE_DEFAULT_COLORS.primary);
    }
  });
});
