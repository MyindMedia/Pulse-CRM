import { describe, it, expect } from "vitest";
import { entitlementForCapability, capabilitiesForTier } from "./entitlements";
import { PLAN_LIMITS } from "./plans";
import { periodFor } from "../usage";

describe("marketing entitlement", () => {
  it("maps every marketing capability to the marketing module", () => {
    expect(entitlementForCapability("marketing.read")).toBe("marketing");
    expect(entitlementForCapability("marketing.edit")).toBe("marketing");
    expect(entitlementForCapability("marketing.approve")).toBe("marketing");
  });
  it("every paid tier has marketing, with caps only on studio", () => {
    expect(capabilitiesForTier("core").has("marketing")).toBe(true);
    expect(capabilitiesForTier("growth").has("marketing")).toBe(true);
    expect(PLAN_LIMITS.core.socialAccountCap).toBe(3);
    expect(PLAN_LIMITS.core.socialPostsPerMonth).toBe(20);
    expect(PLAN_LIMITS.growth.socialAccountCap).toBeGreaterThan(1000);
  });
  it("social posts reset monthly, connected accounts do not", () => {
    expect(periodFor("social_posts", Date.UTC(2026, 7, 26))).toBe("2026-08");
    expect(periodFor("social_accounts", Date.UTC(2026, 7, 26))).toBe("all");
  });
});
