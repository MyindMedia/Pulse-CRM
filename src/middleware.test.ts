import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: () => () => undefined,
  createRouteMatcher: () => () => false,
}));

const { isProductionUiLab } = await import("./middleware");

/* The UI lab is staging only: production must answer it with a real 404
   status, which only the middleware can set (the page streams a 200). */
describe("UI lab gate", () => {
  it("404s the lab and its sub-paths in production only", () => {
    expect(isProductionUiLab("/ui-lab", false)).toBe(true);
    expect(isProductionUiLab("/ui-lab/anything", false)).toBe(true);
    expect(isProductionUiLab("/ui-lab", true)).toBe(false);
    expect(isProductionUiLab("/ui-labs", false)).toBe(false);
    expect(isProductionUiLab("/dashboard", false)).toBe(false);
  });
});
