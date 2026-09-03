import { describe, expect, it } from "vitest";
import { routeFromDeepLink } from "./shell";

/* The macOS/iOS app hands the web app pulse:// URLs. The first segment
   parses as the URL host, which is easy to get wrong, so the mapping is
   pinned here. */
describe("routeFromDeepLink", () => {
  it("maps the host to the first path segment", () => {
    expect(routeFromDeepLink("pulse://bookings")).toBe("/bookings");
    expect(routeFromDeepLink("pulse://portal/abc123")).toBe("/portal/abc123");
  });
  it("keeps query and hash", () => {
    expect(routeFromDeepLink("pulse://settings?stripe=return#top")).toBe(
      "/settings?stripe=return#top",
    );
  });
  it("opens the dashboard for a bare link", () => {
    expect(routeFromDeepLink("pulse://")).toBe("/dashboard");
    expect(routeFromDeepLink("pulse:///")).toBe("/dashboard");
  });
  it("refuses anything that is not pulse://", () => {
    expect(routeFromDeepLink("https://evil.example/portal/x")).toBeNull();
    expect(routeFromDeepLink("not a url")).toBeNull();
  });
  it("strips a trailing slash", () => {
    expect(routeFromDeepLink("pulse://bookings/")).toBe("/bookings");
  });
});
