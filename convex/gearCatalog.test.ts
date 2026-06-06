import { describe, it, expect } from "vitest";
import { GEAR_CATALOG, searchGearCatalog, type GearCategory } from "./lib/gearCatalog";

const VALID_CATEGORIES: GearCategory[] = [
  "console", "mic", "preamp", "interface", "outboard", "monitor",
  "monitor_controller", "headphones", "synth", "midi", "instrument", "other",
];

describe("gear catalog data integrity", () => {
  it("has a healthy number of curated items", () => {
    expect(GEAR_CATALOG.length).toBeGreaterThan(120);
  });

  it("every item has unique id, positive price, and a valid category", () => {
    const ids = new Set<string>();
    for (const it of GEAR_CATALOG) {
      expect(it.id, `dup id ${it.id}`).not.toBe(undefined);
      expect(ids.has(it.id), `duplicate id ${it.id}`).toBe(false);
      ids.add(it.id);
      expect(it.brand.length).toBeGreaterThan(0);
      expect(it.model.length).toBeGreaterThan(0);
      expect(it.priceCents, `${it.id} price`).toBeGreaterThan(0);
      expect(VALID_CATEGORIES, `${it.id} category ${it.category}`).toContain(it.category);
    }
  });
});

describe("searchGearCatalog", () => {
  it("finds a model by brand + model terms", () => {
    const r = searchGearCatalog("scarlett 2i2");
    expect(r[0].brand).toBe("Focusrite");
    expect(r[0].model.toLowerCase()).toContain("2i2");
  });

  it("finds an iconic mic by short token", () => {
    const r = searchGearCatalog("u87");
    expect(r.some((x) => x.brand === "Neumann" && x.model.includes("U 87"))).toBe(true);
  });

  it("filters by category", () => {
    const r = searchGearCatalog("", "monitor", 100);
    expect(r.length).toBeGreaterThan(5);
    expect(r.every((x) => x.category === "monitor")).toBe(true);
  });

  it("returns nothing for gibberish", () => {
    expect(searchGearCatalog("zzzqwerty-nope")).toHaveLength(0);
  });

  it("respects the limit", () => {
    expect(searchGearCatalog("a", undefined, 5).length).toBeLessThanOrEqual(5);
  });
});
