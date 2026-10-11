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
