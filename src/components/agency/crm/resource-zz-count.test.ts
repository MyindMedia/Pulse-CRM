import { describe, expect, it } from "vitest";
import { RESOURCES } from "./resource-config";

/* Pins how many resources each CRM sub-tab shows, so a dropped resource is noticed. */
describe("resource counts per group", () => {
  it("matches the agreed layout", () => {
    const counts = Object.fromEntries(Object.entries(RESOURCES).map(([g, rs]) => [g, rs.length]));
    expect(counts).toEqual({ campaigns: 1, automations: 2, forms: 2, calls: 3, more: 42, settings: 24 });
    const keys = Object.values(RESOURCES).flat().map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
