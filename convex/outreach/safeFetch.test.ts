import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { checkUrl, isPublicHostname, robotsAllows, safeGet, loadRobots, robotsVerdict, classifyFetchError, fetchTuning, USER_AGENT } from "./safeFetch";

beforeEach(() => { fetchTuning.backoffMs = 0; });
afterEach(() => { vi.unstubAllGlobals(); });

/* Node's undici shape for a failed connection: TypeError("fetch failed") with an errno cause. */
const nodeErr = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });

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
    expect(r).toMatchObject({ ok: false, kind: "redirects", reason: "Too many redirects" });
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
  it("an empty Disallow allows everything and comments are ignored", () => {
    expect(robotsAllows("User-agent: *\nDisallow:\n", "/contact")).toBe(true);
    expect(robotsAllows("# hi\nUser-agent: * # all\nDisallow: /admin # private\n", "/admin/x")).toBe(false);
  });
});

describe("robots.txt policy (RFC 9309 semantics)", () => {
  it("404 and 410 mean there is no file, so everything is allowed", async () => {
    for (const status of [404, 410]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status })));
      const p = await loadRobots("https://a.example.com");
      expect(p.kind).toBe("none");
      expect(robotsVerdict(p, "/contact")).toBe("allow");
    }
  });

  it("an explicit Disallow is honoured", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("User-agent: *\nDisallow: /\n")));
    const p = await loadRobots("https://a.example.com");
    expect(p.kind).toBe("rules");
    expect(robotsVerdict(p, "/")).toBe("disallow");
  });

  it("a 5xx is retried with backoff, then reads as unreachable (limited), never disallow", async () => {
    const f = vi.fn(async () => new Response("err", { status: 503 }));
    vi.stubGlobal("fetch", f);
    const p = await loadRobots("https://a.example.com");
    expect(p).toMatchObject({ kind: "unreachable", failKind: "http", reason: "robots.txt unreachable (HTTP 503)" });
    expect(robotsVerdict(p, "/")).toBe("limited");
    expect(f).toHaveBeenCalledTimes(3); // first try plus two retries
  });

  it("a 5xx that recovers on retry uses the real file", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++n === 1 ? new Response("err", { status: 502 }) : new Response("User-agent: *\nDisallow: /private\n"))));
    const p = await loadRobots("https://a.example.com");
    expect(p.kind).toBe("rules");
    expect(robotsVerdict(p, "/")).toBe("allow");
    expect(robotsVerdict(p, "/private/x")).toBe("disallow");
  });

  it("a network failure is retried, then reads as unreachable (limited)", async () => {
    const f = vi.fn(async () => { throw nodeErr("ECONNRESET"); });
    vi.stubGlobal("fetch", f);
    const p = await loadRobots("http://a.example.com");
    expect(p).toMatchObject({ kind: "unreachable", failKind: "network" });
    expect(robotsVerdict(p, "/")).toBe("limited");
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("a DNS miss fails fast and is reported as a DNS miss (thamyind.org case)", async () => {
    const f = vi.fn(async () => { throw nodeErr("ENOTFOUND"); });
    vi.stubGlobal("fetch", f);
    const p = await loadRobots("https://nope.example.org");
    expect(p).toMatchObject({ kind: "unreachable", failKind: "dns" });
    expect(p.kind === "unreachable" && p.reason).toMatch(/does not resolve/);
    expect(f).toHaveBeenCalledTimes(1); // https only; DNS is not retried and http would hit the same DNS
  });

  it("https refused falls back to http (slangcity.com case: Apache on port 80 only)", async () => {
    const f = vi.fn(async (u: string) => {
      if (u.startsWith("https://")) throw nodeErr("ECONNREFUSED");
      return new Response("Not Found", { status: 404 });
    });
    vi.stubGlobal("fetch", f);
    const p = await loadRobots("https://studio.example.com");
    expect(p).toEqual({ kind: "none", origin: "http://studio.example.com", downgraded: true });
    expect(f.mock.calls.map((c) => c[0])).toEqual(["https://studio.example.com/robots.txt", "http://studio.example.com/robots.txt"]);
  });

  it("follows redirects (http to https, apex to www) for robots.txt", async () => {
    const f = vi.fn(async (u: string) => {
      if (u === "http://a.example.com/robots.txt") return new Response(null, { status: 301, headers: { location: "https://a.example.com/robots.txt" } });
      if (u === "https://a.example.com/robots.txt") return new Response(null, { status: 301, headers: { location: "https://www.a.example.com/robots.txt" } });
      return new Response("User-agent: *\nDisallow: /secret\n");
    });
    vi.stubGlobal("fetch", f);
    const p = await loadRobots("http://a.example.com");
    expect(p.kind).toBe("rules");
    expect(robotsVerdict(p, "/secret")).toBe("disallow");
  });

  it("sends an honest identifying User-Agent", async () => {
    const f = vi.fn<(u: string, init?: RequestInit) => Promise<Response>>(async () => new Response("", { status: 404 }));
    vi.stubGlobal("fetch", f);
    await loadRobots("https://a.example.com");
    const headers = f.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/PulseOutreachBot\/.+contact/);
  });
});

describe("fetch error classification", () => {
  it("reads Node errno causes", () => {
    expect(classifyFetchError(nodeErr("ENOTFOUND")).kind).toBe("dns");
    expect(classifyFetchError(nodeErr("ECONNREFUSED")).kind).toBe("refused");
    expect(classifyFetchError(nodeErr("CERT_HAS_EXPIRED")).kind).toBe("tls");
    expect(classifyFetchError(nodeErr("ECONNRESET")).kind).toBe("network");
  });
  it("reads Convex runtime (reqwest) message text", () => {
    expect(classifyFetchError(new TypeError("error sending request for url (https://x.org/robots.txt): error trying to connect: dns error: failed to lookup address information: Name or service not known")).kind).toBe("dns");
    expect(classifyFetchError(new TypeError("error trying to connect: tcp connect error: Connection refused (os error 111)")).kind).toBe("refused");
    expect(classifyFetchError(new TypeError("error trying to connect: invalid peer certificate: Expired")).kind).toBe("tls");
  });
  it("page reads retry a transient failure once by default", async () => {
    let n = 0;
    const f = vi.fn(async () => { if (++n === 1) throw nodeErr("ECONNRESET"); return new Response("<p>hi</p>", { headers: { "content-type": "text/html" } }); });
    vi.stubGlobal("fetch", f);
    const r = await safeGet("https://a.example.com/");
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
