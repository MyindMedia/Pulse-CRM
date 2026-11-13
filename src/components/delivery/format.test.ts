import { describe, expect, it } from "vitest";
import { contrastRatio, inkFor, PULSE_GOLD, safeAccent } from "./format";

/* V4-02: the text on the studio accent (Download all, Pay and unlock, the
   logo initials tile) is chosen by one rule: black or white, whichever has
   the higher WCAG contrast ratio against the accent. */

const ACCENTS = ["#fdb913", "#ff6b4a", "#0f8f6f", "#3b63e6", "#777777", "#000000", "#ffffff"];

describe("inkFor (V4-02)", () => {
  it("picks only black or white", () => {
    for (const a of ACCENTS) expect(["#000000", "#ffffff"]).toContain(inkFor(a));
  });

  it("every result reads at 4.5:1 or better on the accent", () => {
    for (const a of ACCENTS) {
      expect(contrastRatio(a, inkFor(a)), a).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("picks the higher ratio of the two", () => {
    for (const a of ACCENTS) {
      const chosen = contrastRatio(a, inkFor(a));
      expect(chosen).toBeGreaterThanOrEqual(contrastRatio(a, "#000000") - 1e-9);
      expect(chosen).toBeGreaterThanOrEqual(contrastRatio(a, "#ffffff") - 1e-9);
    }
  });

  it("known picks", () => {
    expect(inkFor("#fdb913")).toBe("#000000");
    expect(inkFor("#0f8f6f")).toBe("#000000");
    expect(inkFor("#3b63e6")).toBe("#ffffff");
    expect(inkFor("#000000")).toBe("#ffffff");
    expect(inkFor("#ffffff")).toBe("#000000");
  });

  it("the Pulse gold fallback follows the same rule", () => {
    expect(inkFor(safeAccent("not a color"))).toBe(inkFor(PULSE_GOLD));
    expect(contrastRatio(PULSE_GOLD, inkFor(PULSE_GOLD))).toBeGreaterThanOrEqual(4.5);
  });

  it("contrastRatio matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});
