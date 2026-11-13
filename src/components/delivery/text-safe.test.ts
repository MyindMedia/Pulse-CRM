import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AA_TEXT, AA_UI, contrastRatio } from "@/lib/brand-theme";

/* V3-05: the text and focus-ring colors of the delivery surfaces, computed,
   not eyeballed. Reads the shipped CSS (text-safe.module.css, globals.css,
   hardware.css), so a changed value fails here. */

const read = (...p: string[]) => readFileSync(join(__dirname, ...p), "utf8");
const MODULE = read("text-safe.module.css");
const GLOBALS = read("..", "..", "app", "globals.css");
const HARDWARE = read("..", "..", "app", "hardware.css");

/** The body of the first rule whose selector contains `selector`. */
function block(css: string, selector: string): string {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

/** A #rrggbb custom property in a rule body. */
function hex(body: string, name: string): string {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(body);
  if (!m) throw new Error(`no hex value for ${name}`);
  return m[1].toLowerCase();
}

const DARK = block(GLOBALS, "@theme {");
const LIGHT = block(GLOBALS, 'html[data-theme="light"] {');
const KIT = block(HARDWARE, ":root {");

const SAFE_LIGHT = block(MODULE, ':global(html[data-theme="light"]:not(:has(.pulse-hw))) .safeText {');
const SAFE_KIT = block(MODULE, ":global(:root:has(.pulse-hw)) .safeText {");

const surfaces = (body: string) => ({
  ink: hex(body, "--color-ink"),
  coal: hex(body, "--color-coal"),
  "coal-2": hex(body, "--color-coal-2"),
  "coal-3": hex(body, "--color-coal-3"),
});

function expectAll(color: string, on: Record<string, string>, min: number) {
  for (const [name, bg] of Object.entries(on)) {
    const ratio = contrastRatio(color, bg);
    expect(ratio, `${color} on ${name} ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  }
}

describe("text-safe colors: light theme", () => {
  const on = surfaces(LIGHT);
  const text = {
    gold: hex(SAFE_LIGHT, "--gold-text"),
    ok: hex(SAFE_LIGHT, "--ok-text"),
    bad: hex(SAFE_LIGHT, "--bad-text"),
    warn: hex(SAFE_LIGHT, "--warn-text"),
  };

  it("reads the light surfaces it expects", () => {
    expect(on).toEqual({ ink: "#e8e6df", coal: "#ffffff", "coal-2": "#f3f1ea", "coal-3": "#e7e3da" });
  });

  it("every text color is at least 4.5:1 on every light surface", () => {
    for (const c of Object.values(text)) expectAll(c, on, AA_TEXT);
  });

  it("the focus ring (gold text) is at least 3:1 on every light surface", () => {
    expect(MODULE).toMatch(/:focus-visible\s*\{\s*outline-color:\s*var\(--gold-text\);/);
    expectAll(text.gold, on, AA_UI);
  });

  it("the gold is the mockup's text gold", () => {
    expect(text.gold).toBe("#7a5600");
  });

  it("the light theme's own gold and signal tokens fail as text, which is why these exist", () => {
    expect(contrastRatio(hex(LIGHT, "--color-gold"), on["coal-2"])).toBeLessThan(2);
    expect(contrastRatio(hex(DARK, "--color-positive"), on.coal)).toBeLessThan(AA_TEXT);
    expect(contrastRatio(hex(DARK, "--color-critical"), on.coal)).toBeLessThan(AA_TEXT);
    expect(contrastRatio(hex(DARK, "--color-caution"), on.coal)).toBeLessThan(AA_TEXT);
  });

  it("never applies under the dark-only hardware kit", () => {
    expect(MODULE).toContain(':global(html[data-theme="light"]:not(:has(.pulse-hw))) .safeText {');
    expect(MODULE).toContain(':global(html[data-theme="light"]:not(:has(.pulse-hw))) .safeText :is(');
  });
});

describe("text-safe colors: dark theme (stock tokens)", () => {
  const on = surfaces(DARK);
  it("gold, positive, critical and caution are at least 4.5:1 on every dark surface", () => {
    for (const name of ["--color-gold", "--color-positive", "--color-critical", "--color-caution"]) {
      expectAll(hex(DARK, name), on, AA_TEXT);
    }
  });
});

describe("text-safe colors: hardware kit (dark only)", () => {
  const face = { face: hex(KIT, "--pl-face"), "face-raised": hex(KIT, "--pl-face-raised") };
  const high = { "face-high": hex(KIT, "--pl-face-high") };

  it("the kit's red is under 4.5:1 on its raised face, so the module replaces it", () => {
    expect(contrastRatio(hex(KIT, "--pl-negative"), face["face-raised"])).toBeLessThan(AA_TEXT);
    expectAll(hex(SAFE_KIT, "--bad-text"), face, AA_TEXT);
  });

  it("gold and positive text read at 4.5:1 on the faces text sits on", () => {
    expectAll(hex(KIT, "--pl-yellow"), face, AA_TEXT);
    expectAll(hex(KIT, "--pl-positive"), face, AA_TEXT);
  });

  it("icons on the high face (file tiles) clear 3:1", () => {
    for (const c of [hex(KIT, "--pl-yellow"), hex(KIT, "--pl-positive"), hex(SAFE_KIT, "--bad-text")]) expectAll(c, high, AA_UI);
  });
});
