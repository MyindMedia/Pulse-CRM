import { describe, expect, it } from "vitest";
import { THEME_FONTS } from "@convex/lib/themeSpec";
import { fontStack, fontStylesheetHref, themeFontVars } from "./theme-fonts";

describe("fontStylesheetHref", () => {
  it("has a free source for every allowed font", () => {
    for (const f of THEME_FONTS) {
      const href = fontStylesheetHref(f);
      expect(href, f).toMatch(/^https:\/\/(fonts\.googleapis\.com\/css2|api\.fontshare\.com\/v2\/css)\?/);
    }
  });
  it("asks Google for one weight only where only one exists", () => {
    expect(fontStylesheetHref("Instrument Serif")).toBe(
      "https://fonts.googleapis.com/css2?family=Instrument+Serif&display=swap",
    );
    expect(fontStylesheetHref("Space Grotesk")).toContain("family=Space+Grotesk:wght@400;500;600;700");
  });
  it("sends Satoshi and General Sans to Fontshare", () => {
    expect(fontStylesheetHref("Satoshi")).toContain("api.fontshare.com");
    expect(fontStylesheetHref("General Sans")).toContain("general-sans@");
  });
  it("refuses anything off the allowlist", () => {
    expect(fontStylesheetHref("Comic Sans")).toBeNull();
    expect(fontStylesheetHref('x"); }body{')).toBeNull();
  });
});

describe("themeFontVars", () => {
  it("writes nothing for the Pulse default", () => {
    expect(themeFontVars("", null)).toEqual({});
  });
  it("points heading voices and body voices (including the hardware face) at the picks", () => {
    const v = themeFontVars("Playfair Display", "DM Sans");
    expect(v["--font-grotesk"]).toBe('"Playfair Display", ui-serif, Georgia, serif');
    expect(v["--font-display"]).toBe(v["--font-grotesk"]);
    expect(v["--font-archivo"]).toBe(fontStack("DM Sans"));
    expect(v["--font-sans"]).toBe(fontStack("DM Sans"));
  });
});
