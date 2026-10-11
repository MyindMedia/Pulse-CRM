import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { checkUrl, isPublicHostname, isPrivateIp, resolvesPublic, dnsTuning, robotsAllows, safeGet, guardedFetch, loadRobots, robotsVerdict, classifyFetchError, fetchTuning, USER_AGENT } from "./safeFetch";

const realResolve = dnsTuning.resolve;
// Page-level tests run against a resolver that says every host is public;
// the DNS checks have their own tests below.
beforeEach(() => { fetchTuning.backoffMs = 0; dnsTuning.resolve = async () => ["93.184.216.34"]; });
afterEach(() => { vi.unstubAllGlobals(); dnsTuning.resolve = realResolve; });

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
  it("guardedFetch (image import) refuses a metadata or private address without requesting it", async () => {
    const f = vi.fn(async () => new Response("secret"));
    vi.stubGlobal("fetch", f);
    for (const u of ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:6379/", "http://10.0.0.1/admin", "http://metadata.google.internal/"]) {
      const r = await guardedFetch(u, "image/*");
      expect(r.ok, u).toBe(false);
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("guardedFetch refuses a redirect into the private network and hands back a public image", async () => {
    const f = vi.fn(async (u: string) =>
      u.includes("evil")
        ? new Response(null, { status: 302, headers: { location: "http://192.168.0.10/cam.jpg" } })
        : new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", f);
    expect((await guardedFetch("https://evil.example.com/logo.png", "image/*")).ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
    const ok = await guardedFetch("https://studio.example.com/logo.png", "image/*");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.res.headers.get("content-type")).toBe("image/png");
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

describe("DNS rebinding (pentest re-scan, CWE-918)", () => {
  it.each(["127.0.0.1.nip.io", "10-0-0-1.sslip.io", "app.localtest.me", "169.254.169.254.xip.io", "lvh.me", "api.192.168.1.20.example.com"])(
    "refuses the wildcard or embedded-IP name %s",
    (h) => {
      expect(isPublicHostname(h)).toBe(false);
    },
  );
  it("still accepts ordinary studio domains", () => {
    expect(isPublicHostname("studio-b.example.com")).toBe(true);
    expect(isPublicHostname("www.icecreamsound.com")).toBe(true);
  });
  it("classifies private and public addresses, IPv4 and IPv6", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "fd12::1", "fe80::1", "::ffff:192.168.1.1"]) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "2606:4700:4700::1111"]) expect(isPrivateIp(ip), ip).toBe(false);
  });
  it("refuses a host whose DNS answers include a private address, and fails closed when DNS does not answer", async () => {
    dnsTuning.resolve = async (h) => (h === "evil.example.com" ? ["93.184.216.34", "169.254.169.254"] : h === "ok.example.com" ? ["93.184.216.34"] : null);
    expect(await resolvesPublic("evil.example.com")).toBe(false);
    expect(await resolvesPublic("ok.example.com")).toBe(true);
    expect(await resolvesPublic("nowhere.example.com")).toBe(false);
    const f = vi.fn(async () => new Response("secret"));
    vi.stubGlobal("fetch", f);
    expect((await guardedFetch("https://evil.example.com/logo.png", "image/*")).ok).toBe(false);
    expect((await safeGet("https://evil.example.com/")).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("a name with no DNS record is unreachable (dns), not blocked; resolvers down fails closed as network", async () => {
    dnsTuning.resolve = async (h) => (h === "gone.example.com" ? [] : null);
    const f = vi.fn(async () => new Response("page"));
    vi.stubGlobal("fetch", f);
    const gone = await safeGet("https://gone.example.com/");
    expect(gone.ok === false && gone.kind).toBe("dns");
    const down = await safeGet("https://anything.example.com/");
    expect(down.ok === false && down.kind).toBe("network");
    expect(f).not.toHaveBeenCalled();
  });
  it("resolves over DNS-over-HTTPS and falls back to the second resolver", async () => {
    dnsTuning.resolve = realResolve;
    const f = vi.fn(async (u: string) => {
      if (u.startsWith("https://cloudflare-dns.com/")) return new Response("down", { status: 503 });
      if (u.startsWith("https://dns.google/")) {
        const type = new URL(u).searchParams.get("type");
        return Response.json({ Answer: type === "A" ? [{ type: 1, data: "10.0.0.9" }] : [] });
      }
      return new Response("page");
    });
    vi.stubGlobal("fetch", f);
    expect(await resolvesPublic("sneaky.example.com")).toBe(false); // the A record points inside
    expect(f.mock.calls.some(([u]) => String(u).startsWith("https://dns.google/"))).toBe(true);
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
