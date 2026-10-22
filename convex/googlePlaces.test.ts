import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/* Google reviews integration (openspec/changes/google-reviews-studio-seo).
   No identity = the demo viewer, owner of pulse-demo. Google is stubbed. */

const ORG = "pulse-demo";
const ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

function googleReplies(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Google reviews integration", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: ORG, name: "Vault", slug: "vault", tier: "growth", status: "active",
        directoryListed: true, directoryCity: "Atlanta", directoryRegion: "GA",
      });
      await ctx.db.insert("rooms", { orgId: ORG, name: "A", roomType: "Live room", hourlyRateCents: 5000, status: "available" });
      await ctx.db.insert("members", { orgId: ORG, name: "Sienna", role: "engineer", skills: [], clerkUserId: "u_eng" });
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("says unavailable when Pulse has no Google key", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    expect((await t.query(api.googlePlaces.status, {})).available).toBe(false);
    await expect(t.action(api.googlePlaces.search, { q: "Vault Atlanta" })).rejects.toThrow(/not available/);
  });

  it("searches Google with the key server side, never in the URL", async () => {
    const f = googleReplies({ places: [{ id: ID, displayName: { text: "Vault Studios" }, formattedAddress: "Atlanta, GA" }] });
    const out = await t.action(api.googlePlaces.search, { q: "Vault Atlanta" });
    expect(out).toEqual([{ placeId: ID, name: "Vault Studios", address: "Atlanta, GA" }]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("test-key");
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("test-key");
  });

  it("links a listing hidden, stores only the place ID, and fills the review link", async () => {
    googleReplies({ id: ID, displayName: { text: "Vault Studios" }, rating: 4.6, userRatingCount: 12, reviews: [{ rating: 5, text: { text: "Great" } }] });
    await t.action(api.googlePlaces.connect, { placeId: ID });
    const org = await t.run(async (ctx) => ctx.db.query("orgs").first());
    expect(org).toMatchObject({ googlePlaceId: ID, googleReviewsShown: false });
    expect(org!.googleReviewUrl).toContain(ID);
    expect(JSON.stringify(org)).not.toContain("Great"); // review text is never stored
    await t.mutation(api.googlePlaces.setShown, { shown: true });
    expect((await t.query(api.googlePlaces.status, {})).shown).toBe(true);
  });

  it("the public listing carries the place ID only while shown", async () => {
    // The demo workspace is never listed, so use a real Listed Studio.
    const echo = await t.run(async (ctx) => {
      const id = await ctx.db.insert("orgs", {
        orgId: "o2", name: "Echo", slug: "echo", tier: "growth", status: "active",
        directoryListed: true, directoryCity: "Atlanta", googlePlaceId: ID, googleReviewsShown: false,
      });
      await ctx.db.insert("rooms", { orgId: "o2", name: "A", roomType: "Live room", hourlyRateCents: 5000, status: "available" });
      return id;
    });
    expect((await t.query(api.directory.listing, { slug: "echo" }))!.googlePlaceId).toBeNull();
    await t.run(async (ctx) => ctx.db.patch(echo, { googleReviewsShown: true }));
    expect((await t.query(api.directory.listing, { slug: "echo" }))!.googlePlaceId).toBe(ID);
  });

  it("refuses a place Google does not know, and a malformed ID without calling Google", async () => {
    const f = googleReplies({ error: "nope" }, 404);
    await expect(t.action(api.googlePlaces.connect, { placeId: ID })).rejects.toThrow(/could not find/);
    f.mockClear();
    await expect(t.action(api.googlePlaces.connect, { placeId: "../../etc" })).rejects.toThrow(/not a Google place/);
    expect(f).not.toHaveBeenCalled();
  });

  it("unlinking clears the listing and the link it set, but keeps a pasted link", async () => {
    googleReplies({ id: ID, displayName: { text: "Vault Studios" } });
    await t.action(api.googlePlaces.connect, { placeId: ID });
    await t.mutation(api.googlePlaces.disconnect, {});
    let org = await t.run(async (ctx) => ctx.db.query("orgs").first());
    expect(org!.googlePlaceId).toBeUndefined();
    expect(org!.googleReviewUrl).toBeUndefined();

    await t.mutation(api.growth.set, { googleReviewUrl: "https://g.page/r/vault/review" });
    await t.action(api.googlePlaces.connect, { placeId: ID });
    await expect(t.mutation(api.growth.set, { googleReviewUrl: "https://g.page/r/other/review" })).rejects.toThrow(/Integrations/);
    await t.run(async (ctx) => {
      const o = (await ctx.db.query("orgs").first())!;
      await ctx.db.patch(o._id, { googleReviewUrl: "https://g.page/r/vault/review" });
    });
    await t.mutation(api.googlePlaces.disconnect, {});
    org = await t.run(async (ctx) => ctx.db.query("orgs").first());
    expect(org!.googleReviewUrl).toBe("https://g.page/r/vault/review");
  });

  it("an engineer cannot see or change it", async () => {
    const eng = t.withIdentity({ subject: "u_eng", name: "Sienna" });
    await expect(eng.query(api.googlePlaces.status, {})).rejects.toThrow();
    await expect(eng.mutation(api.googlePlaces.setShown, { shown: true })).rejects.toThrow();
    const f = googleReplies({ places: [] });
    await expect(eng.action(api.googlePlaces.search, { q: "Vault" })).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("Find a Studio pages", () => {
  async function studio(t: ReturnType<typeof convexTest>, orgId: string, slug: string, city: string, listed = true) {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId, name: slug, slug, tier: "growth", status: "active",
        directoryListed: listed, directoryCity: city, directoryRegion: "GA", timezone: "UTC",
      });
      await ctx.db.insert("rooms", { orgId, name: "A", roomType: "Live room", hourlyRateCents: 5000, status: "available" });
    });
  }

  it("a City Page needs two Listed Studios", async () => {
    const t = convexTest(schema);
    await studio(t, "o1", "vault", "Atlanta");
    expect(await t.query(api.directory.city, { slug: "atlanta-ga" })).toBeNull();
    expect((await t.query(api.directory.listing, { slug: "vault" }))!.hasCityPage).toBe(false);
    await studio(t, "o2", "echo", "Atlanta");
    await studio(t, "o3", "hidden", "Atlanta", false);
    const c = (await t.query(api.directory.city, { slug: "atlanta-ga" }))!;
    expect(c.listings.map((l) => l.slug)).toEqual(["echo", "vault"]);
    expect((await t.query(api.directory.listing, { slug: "vault" }))!.hasCityPage).toBe(true);
    expect((await t.query(api.directory.search, {})).cityPages).toEqual([{ slug: "atlanta-ga", city: "Atlanta", region: "GA" }]);
  });

  it("the sitemap lists Listed Studios and real City Pages only", async () => {
    const t = convexTest(schema);
    await studio(t, "o1", "vault", "Atlanta");
    await studio(t, "o2", "echo", "Atlanta");
    await studio(t, "o3", "solo", "Macon");
    await studio(t, "o4", "hidden", "Macon", false);
    const s = await t.query(api.directory.sitemapEntries, {});
    expect(s.studios.map((x) => x.slug)).toEqual(["echo", "solo", "vault"]);
    expect(s.cities.map((c) => c.slug)).toEqual(["atlanta-ga"]);
  });
});
