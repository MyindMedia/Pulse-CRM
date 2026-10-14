import { describe, it, expect, vi } from "vitest";
import { convexSiteUrl, forwardGoogleCallback } from "./google-callback";

describe("studiopulse.tech/google/callback forwarder", () => {
  it("derives the Convex site URL from the cloud URL", () => {
    expect(convexSiteUrl({ NEXT_PUBLIC_CONVEX_URL: "https://fiery-cricket-350.convex.cloud" })).toBe("https://fiery-cricket-350.convex.site");
    expect(convexSiteUrl({ NEXT_PUBLIC_CONVEX_SITE_URL: "https://a.convex.site/", NEXT_PUBLIC_CONVEX_URL: "https://b.convex.cloud" })).toBe("https://a.convex.site");
    expect(convexSiteUrl({})).toBeNull();
  });

  it("forwards the query string to Convex and returns its redirect", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://x.convex.cloud");
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://studiopulse.tech/settings?google=connected" } }));
    const res = await forwardGoogleCallback(new Request("https://studiopulse.tech/google/callback?code=abc&state=n1"), fetchImpl as never);
    expect(fetchImpl).toHaveBeenCalledWith("https://x.convex.site/google/callback?code=abc&state=n1", expect.objectContaining({ redirect: "manual" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://studiopulse.tech/settings?google=connected");
    vi.unstubAllEnvs();
  });

  it("fails clearly when the backend is not configured or unreachable", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "");
    expect((await forwardGoogleCallback(new Request("https://a.b/google/callback"))).status).toBe(500);
    vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://x.convex.site");
    const boom = vi.fn(async () => { throw new Error("down"); });
    expect((await forwardGoogleCallback(new Request("https://a.b/google/callback?code=1"), boom as never)).status).toBe(502);
    vi.unstubAllEnvs();
  });
});
