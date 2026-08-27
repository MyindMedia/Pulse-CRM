import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ghlFromEnv, ghlFetch, startOAuth, createScheduledPost } from "./ghl";

describe("ghl client", () => {
  beforeEach(() => {
    vi.stubEnv("GHL_API_KEY", "pit_default");
    vi.stubEnv("GHL_LOCATION_ID", "loc_default");
    vi.stubEnv("GHL_SOCIAL_USER_ID", "user_pulse");
    vi.stubEnv("GHL_TOKEN_SLANG", "pit_slang");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("resolves the platform default when the org has no override", () => {
    expect(ghlFromEnv(null)).toEqual({ locationId: "loc_default", token: "pit_default", userId: "user_pulse" });
  });

  it("resolves a per-org location and token by env var name, never by value", () => {
    const g = ghlFromEnv({ ghl: { locationId: "loc_slang", tokenRef: "GHL_TOKEN_SLANG" } });
    expect(g).toEqual({ locationId: "loc_slang", token: "pit_slang", userId: "user_pulse" });
  });

  it("returns null (simulated mode) when the token env is missing", () => {
    vi.stubEnv("GHL_API_KEY", "");
    expect(ghlFromEnv(null)).toBeNull();
  });

  it("sends Authorization, Version and User-Agent on every call", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const g = ghlFromEnv(null)!;
    await ghlFetch(g, "/social-media-posting/loc_default/accounts", { version: "2021-07-28" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://services.leadconnectorhq.com/social-media-posting/loc_default/accounts");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer pit_default");
    expect(h.Version).toBe("2021-07-28");
    expect(h["User-Agent"]).toContain("Pulse/1.0");
  });

  it("startOAuth passes locationId and userId as query params", async () => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: "https://oauth.example/x" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await startOAuth(ghlFromEnv(null)!, "instagram");
    expect(res).toEqual({ url: "https://oauth.example/x" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/social-media-posting/oauth/instagram/start?locationId=loc_default&userId=user_pulse");
    expect(init.redirect).toBe("manual");
  });

  it("startOAuth returns the real Facebook dialog URL from a 302 Location header", async () => {
    const facebookUrl =
      "https://www.facebook.com/dialog/oauth?client_id=123456789&redirect_uri=https%3A%2F%2Fservices.leadconnectorhq.com%2Fsocial-media-posting%2Foauth%2Ffacebook%2Ffinish&state=abc123&scope=pages_show_list%2Cpages_read_engagement";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: facebookUrl },
    })));
    const res = await startOAuth(ghlFromEnv(null)!, "facebook");
    expect(res).toEqual({ url: facebookUrl });
  });

  it("startOAuth returns null when a 3xx response has no Location header", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302 })));
    const res = await startOAuth(ghlFromEnv(null)!, "facebook");
    expect(res).toBeNull();
  });

  it("startOAuth falls back to a JSON { url } body on a 200 response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ url: "https://oauth.example/x" }), { status: 200 })));
    const res = await startOAuth(ghlFromEnv(null)!, "instagram");
    expect(res).toEqual({ url: "https://oauth.example/x" });
  });

  it("startOAuth returns null instead of throwing when a 200 body is not JSON", async () => {
    // Regression test: this is what happens when fetch follows the 302 to
    // Facebook and lands on the login page HTML with status 200.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html><body>Log in to Facebook</body></html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    })));
    const res = await startOAuth(ghlFromEnv(null)!, "facebook");
    expect(res).toBeNull();
  });

  it("startOAuth returns null on a non-2xx, non-3xx error response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Invalid JWT" }), { status: 401 })));
    const res = await startOAuth(ghlFromEnv(null)!, "facebook");
    expect(res).toBeNull();
  });

  it("createScheduledPost sends status scheduled and returns the GHL id", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: { post: { _id: "post_1" } } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await createScheduledPost(ghlFromEnv(null)!, {
      accountIds: ["acc_1"], summary: "Open Thursday", media: [{ url: "https://x/y.png", type: "image/png" }],
      scheduleDate: "2026-09-01T18:00:00.000Z", type: "post",
    });
    expect(res).toEqual({ id: "post_1" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.status).toBe("scheduled");
    expect(body.accountIds).toEqual(["acc_1"]);
  });

  it("surfaces a GHL error message instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Invalid JWT" }), { status: 401 })));
    const res = await createScheduledPost(ghlFromEnv(null)!, {
      accountIds: ["acc_1"], summary: "x", media: [], scheduleDate: "2026-09-01T18:00:00.000Z", type: "post",
    });
    expect(res).toEqual({ error: "Invalid JWT" });
  });
});
