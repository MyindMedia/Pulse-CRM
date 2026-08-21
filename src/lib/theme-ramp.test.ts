import { describe, it, expect } from "vitest";
import {
  buildThemeVars, mix, lighten, darken, luminance, isDark, readableInk, hexToRgb,
} from "./theme-ramp";

/* White labelling has to change the whole interface, not just the accent.
   These tests pin the two properties that make that true: every token the app
   styles against gets a value, and the ramp reacts to the chosen colours
   rather than assuming a dark theme. */

const PULSE = {
  background: "#1A1A1A", surface: "#212121", text: "#FAFAFA",
  primary: "#FDB913", accent: "#FDB913", muted: "#A1A1AA", border: "#2E2E2E",
};

describe("colour maths", () => {
  it("mixes, lightens and darkens", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(lighten("#000000", 1)).toBe("#ffffff");
    expect(darken("#ffffff", 1)).toBe("#000000");
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("knows a dark colour from a light one", () => {
    expect(isDark("#1A1A1A")).toBe(true);
    expect(isDark("#FAF8F4")).toBe(false);
    expect(luminance("#ffffff")).toBeCloseTo(1, 1);
  });

  it("picks readable text for whatever sits on the brand colour", () => {
    // Gold needs dark text. Guessing white here produces a button nobody can
    // read, which is the single most common white-label failure.
    expect(readableInk("#FDB913")).not.toBe("#ffffff");
    expect(readableInk("#1B2A6B")).toBe("#ffffff");
  });
});

describe("the derived interface", () => {
  it("fills every token the app is styled against", () => {
    const v = buildThemeVars(PULSE);
    for (const key of [
      "--color-ink", "--color-ink-2", "--color-obsidian",
      "--color-coal", "--color-coal-2", "--color-coal-3",
      "--color-hairline", "--color-hairline-2", "--color-graphite",
      "--color-gold", "--color-gold-bright", "--color-gold-deep",
      "--color-gold-dim", "--color-gold-ink",
      "--color-bone", "--color-mist", "--color-steel", "--color-ash",
      "--shadow-card", "--shadow-glow-gold", "--shadow-gold-soft",
    ]) {
      expect(v[key], `${key} must be derived, not left to Pulse's default`).toBeTruthy();
    }
  });

  it("builds a real surface ladder, so cards lift off the page", () => {
    const v = buildThemeVars(PULSE);
    const rungs = ["--color-ink", "--color-ink-2", "--color-coal-2", "--color-coal-3"]
      .map((k) => luminance(v[k]));
    // On a dark theme each rung is lighter than the one below it.
    for (let i = 1; i < rungs.length; i++) {
      expect(rungs[i]).toBeGreaterThan(rungs[i - 1]);
    }
  });

  it("inverts the ladder for a light theme instead of assuming dark", () => {
    const v = buildThemeVars({ ...PULSE, background: "#FAF8F4", text: "#1A1815" });
    // Surfaces now step DOWN into shadow, or a light theme would blow out.
    expect(luminance(v["--color-coal-3"])).toBeLessThan(luminance(v["--color-ink"]));
  });

  it("tints the shadows to the brand, not to ours", () => {
    const v = buildThemeVars({ ...PULSE, primary: "#7C3AED" });
    // 124,58,237 is the chosen purple.
    expect(v["--shadow-glow-gold"]).toContain("124,58,237");
    expect(v["--shadow-gold-soft"]).toContain("124,58,237");
  });

  it("moves the background, the nav and the cards together", () => {
    const a = buildThemeVars(PULSE);
    const b = buildThemeVars({ ...PULSE, background: "#0B0B10", surface: "#141420" });
    // The complaint this fixes: changing the background used to move nothing.
    expect(b["--color-ink"]).not.toBe(a["--color-ink"]);
    expect(b["--color-coal"]).not.toBe(a["--color-coal"]);
    expect(b["--color-coal-3"]).not.toBe(a["--color-coal-3"]);
  });
});
