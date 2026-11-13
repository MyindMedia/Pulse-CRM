import { describe, expect, it } from "vitest";
import { NAV, NAV_GROUPS } from "./nav";

/* The sidebar renders NAV in NAV_GROUPS sections; an item with no known
   section would silently vanish from the rail. */
describe("nav sections", () => {
  it("puts every nav item in a known section, and every section has items", () => {
    const keys = new Set(NAV_GROUPS.map((g) => g.key));
    for (const item of NAV) expect(keys.has(item.group), `${item.label} -> ${item.group}`).toBe(true);
    for (const g of NAV_GROUPS) expect(NAV.some((i) => i.group === g.key), g.label).toBe(true);
  });

  it("opens the Studio section with Dashboard, then Bookings, like the kit", () => {
    const studio = NAV.filter((i) => i.group === "studio").map((i) => i.label);
    expect(studio.slice(0, 2)).toEqual(["Dashboard", "Bookings"]);
  });
});

/* H6 round 2 (H207-12, H207-15): selling packages is on Growth (lib/pricing.ts
   "packages"), but a Core studio that set packages up before the gate keeps
   the page: only the sell paths check the plan (convex/packages.ts). This test
   asserted the nav item and route were gated; that locked existing Core
   studios out of their own products with no notice. */
describe("packages plan gate", () => {
  it("keeps the Packages page for every plan and leaves the plan check to selling", async () => {
    const { featureForPath } = await import("./features");
    const { effectiveDisabledFeatures } = await import("@convex/lib/entitlements");
    expect(NAV.find((i) => i.href === "/packages")?.feature).toBeUndefined();
    expect(featureForPath("/packages")).toBeNull();
    expect(effectiveDisabledFeatures("core", [])).toContain("packages");
    expect(effectiveDisabledFeatures("growth", [])).not.toContain("packages");
  });
});
