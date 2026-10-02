import { describe, it, expect, vi, afterEach } from "vitest";
import { checkUrl, isPublicHostname, robotsAllows, safeGet, robotsPermits } from "./safeFetch";

afterEach(() => { vi.unstubAllGlobals(); });

describe("SSRF guard", () => {
  it.each([
    "http://localhost/x", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "http://172.16.0.1/",
    "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://2130706433/", "http://0x7f000001/",
    "ftp://example.com/", "https://user:pw@example.com/", "https://example.com:8080/", "http://printer.local/", "http://intranet/",
  ])("refuses %s", (u) => {
    expect(checkUrl(u).ok).toBe(false);
  });
  it("accepts ordinary public sites", () => {
    expect(checkUrl("https://www.icecreamsound.com/contact").ok).toBe(true);
    expect(isPublicHostname("8.8.8.8")).toBe(true);
  });
  it("re-checks every redirect hop and refuses a redirect into a private address", async () => {
    const f = vi.fn(async (u: string) => u.includes("evil")
      ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } })
      : new Response("ok"));
    vi.stubGlobal("fetch", f);
    const r = await safeGet("https://evil.example.com/");
    expect(r.ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("stops after too many redirects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://a.example.com/" } })));
    const r = await safeGet("https://a.example.com/");
    expect(r).toEqual({ ok: false, reason: "Too many redirects" });
  });
  it("caps oversized bodies instead of reading them all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("a".repeat(3_000_000), { headers: { "content-type": "text/html" } })));
    const r = await safeGet("https://big.example.com/");
    expect(r.ok && r.html.length).toBeLessThanOrEqual(1_500_000 + 64_000);
  });
});

describe("robots.txt", () => {
  it("honours disallow, allow overrides and the wildcard group", () => {
    const txt = "User-agent: *\nDisallow: /private\nAllow: /private/ok\n";
    expect(robotsAllows(txt, "/")).toBe(true);
    expect(robotsAllows(txt, "/private/x")).toBe(false);
    expect(robotsAllows(txt, "/private/ok/y")).toBe(true);
  });
  it("our own group wins over the wildcard", () => {
    const txt = "User-agent: *\nDisallow: /\n\nUser-agent: PulseOutreachBot\nAllow: /\n";
    expect(robotsAllows(txt, "/contact")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /\n", "/contact")).toBe(false);
  });
  it("404 means allowed, but an erroring robots.txt means do not scrape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    expect((await robotsPermits("https://a.example.com", "/")).ok).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 503 })));
    expect((await robotsPermits("https://a.example.com", "/")).ok).toBe(false);
  });
});
