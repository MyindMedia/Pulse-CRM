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

/* H6: Packages is sold on Growth (lib/pricing.ts "packages"), so a Core studio
   must not see the screen in the nav or reach it by URL. */
describe("packages plan gate", () => {
  it("ties the Packages item and route to the Growth packages entitlement", async () => {
    const { featureForPath } = await import("./features");
    const { effectiveDisabledFeatures } = await import("@convex/lib/entitlements");
    expect(NAV.find((i) => i.href === "/packages")?.feature).toBe("packages");
    expect(featureForPath("/packages")).toBe("packages");
    expect(effectiveDisabledFeatures("core", [])).toContain("packages");
    expect(effectiveDisabledFeatures("growth", [])).not.toContain("packages");
  });
});
