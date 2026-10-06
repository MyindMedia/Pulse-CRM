import { describe, it, expect, vi, afterEach } from "vitest";
import { callTreg, parseMapsPlaces, parseIgUsers, parseIgContact, isAggregator } from "./treg";

afterEach(() => vi.unstubAllEnvs());

describe("treg parsers", () => {
  it("maps: keeps name, website, published emails and phones; drops social links", () => {
    const json = { output: { data: { items: [
      { name: "Union Recording Studio", website: "http://unionrecstudios.com/", emails: ["Info@Hello.Union.com"], phone: "+13236153575", phones: ["+13236153575"], instagrams: ["https://instagram.com/someclient"], category: "Recording studio", rating: 4.8, reviewCount: 243 },
      { website: "http://nameless.example" },
    ] } } };
    const places = parseMapsPlaces(json);
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ name: "Union Recording Studio", emails: ["info@hello.union.com"], phones: ["+13236153575"], rating: 4.8 });
    expect(JSON.stringify(places)).not.toContain("someclient");
  });

  it("maps: junk shapes give an empty list, not a throw", () => {
    expect(parseMapsPlaces(null)).toEqual([]);
    expect(parseMapsPlaces({ output: { data: { items: "x" } } })).toEqual([]);
  });

  it("instagram search: lowercases handles, skips private and malformed accounts", () => {
    const json = { output: { users: [
      { username: "MixRecordingStudio", full_name: "MIX", biography: "We mix", external_url: "https://msgsndr.com/l/x", category_name: "Music Production Studio", follower_count: 39654, is_private: false },
      { username: "secret", is_private: true },
      { username: "bad handle!" },
    ] } };
    const out = parseIgUsers(json);
    expect(out.map((u) => u.handle)).toEqual(["mixrecordingstudio"]);
    expect(out[0].followers).toBe(39654);
  });

  it("instagram contact: reads the public email and phone, or null when none", () => {
    const json = { output: { found: true, data: { publicEmail: "Studio@IceCreamSound.com", emails: ["studio@icecreamsound.com"], publicPhone: "+13237607557", phones: ["+13237607557", "3237607557"], externalUrl: "http://icecreamsound.com" } } };
    expect(parseIgContact(json)).toMatchObject({ emails: ["studio@icecreamsound.com"], phones: ["+13237607557", "3237607557"], externalUrl: "http://icecreamsound.com" });
    expect(parseIgContact({ output: { found: true, data: {} } })).toBeNull();
    expect(parseIgContact({ output: { found: false } })).toBeNull();
  });

  it("link-in-bio and social hosts are never trusted as a studio website", () => {
    for (const u of ["https://linktr.ee/x", "https://msgsndr.com/l/abc", "https://www.instagram.com/x", "https://beacons.ai/x"]) expect(isAggregator(u)).toBe(true);
    expect(isAggregator("https://icecreamsound.com")).toBe(false);
  });
});

describe("callTreg", () => {
  it("is off without TREG_TOKEN and never calls the network", async () => {
    vi.stubEnv("TREG_TOKEN", "");
    const f = vi.fn();
    const r = await callTreg("treg.instagram.search.users", { q: "x" }, f as never);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("TREG_TOKEN") });
    expect(f).not.toHaveBeenCalled();
  });

  it("sends the token as a header only, with a cost ceiling, and never leaks it in the reason", async () => {
    vi.stubEnv("TREG_TOKEN", "secret-token-123");
    const f = vi.fn(async () => new Response(JSON.stringify({ output: {} }), { status: 200 }));
    const r = await callTreg("anyapi.maps.contacts", { query: "studio" }, f as never);
    expect(r.ok).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://treg.to/call/anyapi.maps.contacts");
    expect((init.headers as Record<string, string>)["X-Treg-Token"]).toBe("secret-token-123");
    expect((init.headers as Record<string, string>)["X-Treg-Route-Max-Cost"]).toBe("0.05");
    expect(String(init.body)).not.toContain("secret-token-123");
  });

  it("maps failures to short operator messages", async () => {
    vi.stubEnv("TREG_TOKEN", "secret-token-123");
    const empty = await callTreg("anyapi.maps.contacts", {}, (async () => new Response("insufficient balance", { status: 402 })) as never);
    expect(empty).toEqual({ ok: false, reason: "treg balance is empty" });
    const boom = await callTreg("anyapi.maps.contacts", {}, (async () => { throw new Error("secret-token-123 down"); }) as never);
    expect(boom.ok).toBe(false);
    expect(JSON.stringify(boom)).not.toContain("secret-token-123");
  });
});
