import { describe, expect, it } from "vitest";
import { RADIUS_PX } from "@convex/lib/themeSpec";
import {
  applyEdits,
  colorsPayload,
  diffBrandDraft,
  draftProblem,
  effectiveThemeColors,
  previewScope,
  savedColors,
  savedTheme,
  themePayload,
  type BrandDraft,
} from "./brand-draft";

const theme = savedTheme({
  appName: "Vault",
  colors: {
    primary: "#fdb913",
    accent: "#fdb913",
    background: "#1A1A1A",
    surface: "#212121",
    text: "#FAFAFA",
    muted: "#A1A1AA",
    border: "#2E2E2E",
  },
  fontHeading: null,
  fontBody: null,
  radius: "soft",
  density: "comfortable",
});

const saved: BrandDraft = {
  colors: savedColors({ accentColor: "#fdb913" }),
  look: "hardware",
  theme,
};

describe("savedColors", () => {
  it("reads an unbranded studio as Pulse Gold", () => {
    expect(savedColors({ accentColor: "#FDB913" })).toEqual({
      preset: "pulse-gold",
      primary: "#fdb913",
      secondary: "#d0947b",
    });
  });
  it("reads a preset back by id", () => {
    expect(savedColors({ accentColor: "#7a9bef", brandPreset: "midnight-blue" }).preset).toBe("midnight-blue");
  });
  it("reads anything else as custom", () => {
    const c = savedColors({ accentColor: "#123456", brandSecondary: "#abcdef" });
    expect(c).toEqual({ preset: "custom", primary: "#123456", secondary: "#abcdef" });
  });
});

describe("diffBrandDraft", () => {
  it("is clean with no edits", () => {
    const d = diffBrandDraft(saved, applyEdits(saved, {}));
    expect(d).toEqual({ colors: false, look: false, themeKeys: [], dirty: false });
  });

  it("sees each group separately", () => {
    const draft = applyEdits(saved, {
      colors: { preset: "crimson", primary: "#ed7e81", secondary: "#c22f38" },
      look: "glass",
      theme: { fontHeading: "Sora", radius: "round" },
    });
    const d = diffBrandDraft(saved, draft);
    expect(d.colors).toBe(true);
    expect(d.look).toBe(true);
    expect(d.themeKeys).toEqual(["fontHeading", "radius"]);
    expect(d.dirty).toBe(true);
  });

  it("treats a value typed back to the saved one as unchanged", () => {
    const draft = applyEdits(saved, { theme: { background: "#1a1a1a", appName: " Vault " }, look: "hardware" });
    expect(diffBrandDraft(saved, draft).dirty).toBe(false);
  });

  it("compares a custom pair by its hex, not by how it was typed", () => {
    const s: BrandDraft = { ...saved, colors: { preset: "custom", primary: "#123456", secondary: "#abcdef" } };
    const d = applyEdits(s, { colors: { preset: "custom", primary: "123456", secondary: "#ABCDEF" } });
    expect(diffBrandDraft(s, d).colors).toBe(false);
  });
});

describe("payloads", () => {
  it("sends only the changed theme keys, trimmed, with cleared fonts as empty", () => {
    const draft = applyEdits({ ...saved, theme: { ...theme, fontBody: "Sora" } }, { theme: { fontBody: "", appName: " Vault Two " } });
    expect(themePayload(draft.theme, ["fontBody", "appName"])).toEqual({ fontBody: "", appName: "Vault Two" });
  });
  it("sends a preset by id and a custom pair by value", () => {
    expect(colorsPayload({ preset: "emerald", primary: "x", secondary: "y" })).toEqual({ preset: "emerald" });
    expect(colorsPayload({ preset: "custom", primary: "3F6FE8", secondary: "#AABBCC" })).toEqual({
      preset: "custom",
      primary: "#3f6fe8",
      secondary: "#aabbcc",
    });
  });
});

describe("draftProblem", () => {
  it("catches a half typed custom color", () => {
    const draft = applyEdits(saved, { colors: { preset: "custom", primary: "#12", secondary: "#abcdef" } });
    expect(draftProblem(draft, diffBrandDraft(saved, draft), true)).toMatch(/6-digit hex/);
  });
  it("catches unreadable text before the server does", () => {
    const draft = applyEdits(saved, { theme: { text: "#222222" } });
    expect(draftProblem(draft, diffBrandDraft(saved, draft), true)).toMatch(/needs 4.5:1/);
  });
  it("ignores theme problems on a plan that cannot apply the theme", () => {
    const draft = applyEdits(saved, { theme: { text: "#222222" } });
    expect(draftProblem(draft, diffBrandDraft(saved, draft), false)).toBeNull();
  });
});

describe("effectiveThemeColors", () => {
  const emerald = { preset: "emerald", primary: "#2fbf71", secondary: "#8fd1b5" };

  it("brand-driven: the draft brand primary sets primary and accent, the rest stays the theme's", () => {
    const pinned = { ...saved, theme: { ...theme, primary: "#7c3aed", accent: "#7c3aed", background: "#0b0b10" } };
    const c = effectiveThemeColors(pinned, applyEdits(pinned, { colors: emerald }), true);
    expect(c.primary).toBe("#2fbf71");
    expect(c.accent).toBe("#2fbf71");
    expect(c.background).toBe("#0b0b10");
  });

  it("not brand-driven: a pinned theme primary keeps applying", () => {
    const pinned = { ...saved, theme: { ...theme, primary: "#7c3aed" } };
    expect(effectiveThemeColors(pinned, pinned, false).primary).toBe("#7c3aed");
  });
});

describe("previewScope", () => {
  it("stock draft without a theme: stock brand tokens, no theme attributes", () => {
    const s = previewScope(saved, saved, { theme: false, brandDriven: false, radiusPx: RADIUS_PX });
    expect(s.attrs).toEqual({});
    expect(s.vars["--pl-yellow"]).toBe("#ffc900");
    expect(s.vars["--color-ink"]).toBeUndefined();
    expect(s.vars["--font-sans"]).toBeUndefined();
  });

  it("puts look, brand, fonts and shape on the preview root only", () => {
    const draft = applyEdits(saved, {
      colors: { preset: "violet", primary: "#ac8bf9", secondary: "#6d3fd6" },
      look: "glass",
      theme: { fontHeading: "Fraunces", fontBody: "Sora", radius: "round" },
    });
    const s = previewScope(saved, draft, { theme: true, brandDriven: true, radiusPx: RADIUS_PX });
    expect(s.attrs["data-ui-style"]).toBe("glass");
    expect(s.attrs["data-brand-theme"]).toBe("on");
    expect(s.attrs["data-whitelabel"]).toBe("true");
    expect(s.vars["--font-grotesk"]).toContain('"Fraunces"');
    expect(s.vars["--font-archivo"]).toContain('"Sora"');
    expect(s.vars["--pl-radius-chassis"]).toBe("22px");
    expect(s.vars["--radius-chrome"]).toBe("18px");
    // Brand owns the accent family over the theme ramp.
    expect(s.vars["--color-gold"]).toBe(s.vars["--pl-yellow"]);
  });

  it("soft corners write nothing to the hardware radii", () => {
    const s = previewScope(saved, saved, { theme: true, brandDriven: false, radiusPx: RADIUS_PX });
    expect(s.vars["--pl-radius-chassis"]).toBeUndefined();
  });

  it("guards the brand color against a light theme", () => {
    const light = applyEdits(saved, {
      colors: { preset: "custom", primary: "#ffd400", secondary: "#d0947b" },
      theme: { background: "#ffffff", surface: "#f4f4f5", text: "#111111", muted: "#555555", border: "#dddddd" },
    });
    const s = previewScope(saved, light, { theme: true, brandDriven: true, radiusPx: RADIUS_PX });
    expect(s.attrs["data-theme-mode"]).toBe("light");
    const gold = s.vars["--color-gold"];
    expect(gold).not.toBe("#ffd400");
    // Darkened toward readable on white.
    const lum = parseInt(gold.slice(1, 3), 16) + parseInt(gold.slice(3, 5), 16);
    expect(lum).toBeLessThan(0xff + 0xd4);
  });
});
