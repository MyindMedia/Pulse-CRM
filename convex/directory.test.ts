import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/* The directory is the one place in Pulse where an unauthenticated stranger
   reads studio data. These tests exist to hold that line: opt-in only, and
   nothing that is not already on the studio's public booking page. */

const DAY = 86_400_000;

async function studio(
  t: ReturnType<typeof convexTest>,
  opts: {
    orgId: string; slug: string; name: string;
    listed?: boolean; city?: string; rate?: number; rooms?: number; bookable?: boolean;
  },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: opts.orgId, name: opts.name, slug: opts.slug, plan: "studio", status: "active",
      directoryListed: opts.listed ?? true,
      directoryCity: opts.city ?? "Atlanta",
      directoryRegion: "GA",
      directoryBlurb: "Big room, old console.",
      directoryTags: ["SSL", "live room"],
      // Something private that must never appear in a listing.
      ownerEmail: "secret@example.com",
    });
    for (let i = 0; i < (opts.rooms ?? 1); i++) {
      await ctx.db.insert("rooms", {
        orgId: opts.orgId, name: `Room ${i + 1}`, roomType: "Live room",
        hourlyRateCents: opts.rate ?? 10_000, status: "available",
        bookable: opts.bookable ?? true,
      });
    }
  });
}

describe("what the public can see", () => {
  it("lists an opted-in studio with its public facts", async () => {
    const t = convexTest(schema);
    await studio(t, { orgId: "o1", slug: "vault", name: "Vault" });
    const res = await t.query(api.directory.search, {});
    expect(res.total).toBe(1);
    const [l] = res.listings;
    expect(l).toMatchObject({
      slug: "vault", name: "Vault", city: "Atlanta", roomCount: 1,
      fromHourlyCents: 10_000, bookingPath: "/book/vault",
    });
    expect(l.tags).toContain("SSL");
  });

  it("never leaks a field that is not on the public booking page", async () => {
    const t = convexTest(schema);
    await studio(t, { orgId: "o1", slug: "vault", name: "Vault" });
    const res = await t.query(api.directory.search, {});
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("secret@example.com");
    expect(serialized).not.toContain("ownerEmail");
    expect(serialized).not.toContain("o1");   // internal org id
  });

  it("is opt-in: an unlisted studio is invisible", async () => {
    const t = convexTest(schema);
    await studio(t, { orgId: "o1", slug: "hidden", name: "Hidden", listed: false });
    expect((await t.query(api.directory.search, {})).total).toBe(0);
    expect(await t.query(api.directory.listing, { slug: "hidden" })).toBeNull();
  });

  it("hides a studio with nothing bookable rather than showing a dead end", async () => {
    const t = convexTest(schema);
    await studio(t, { orgId: "o1", slug: "empty", name: "Empty", bookable: false });
    expect((await t.query(api.directory.search, {})).total).toBe(0);
  });

  it("keeps the demo workspace out of the public directory", async () => {
    const t = convexTest(schema);
    await studio(t, { orgId: "pulse-demo", slug: "demo", name: "Demo" });
    expect((await t.query(api.directory.search, {})).total).toBe(0);
  });
});

describe("finding a room", () => {
  it("filters by city, price and free text", async () => {
    const t = convexTest(schema);
    await studio(t, { orgId: "o1", slug: "atl", name: "Atlanta Sound", city: "Atlanta", rate: 8_000 });
    await studio(t, { orgId: "o2", slug: "nyc", name: "Brooklyn Tape", city: "Brooklyn", rate: 25_000 });

    expect((await t.query(api.directory.search, { city: "brooklyn" })).total).toBe(1);
    expect((await t.query(api.directory.search, { maxHourlyCents: 10_000 })).total).toBe(1);
    expect((await t.query(api.directory.search, { q: "tape" })).listings[0].slug).toBe("nyc");
    // Free text reaches the tags and room types too, not just the name.
    expect((await t.query(api.directory.search, { q: "ssl" })).total).toBe(2);
  });

  it("reports the next open day and leads with studios you can actually book", async () => {
    const t = convexTest(schema);
    await studio(t, { orgId: "o1", slug: "busy", name: "Busy" });
    await studio(t, { orgId: "o2", slug: "free", name: "Free" });

    // Fill the next fortnight at "Busy" so it has no open day at all.
    await t.run(async (ctx) => {
      const artist = await ctx.db.insert("artists", {
        orgId: "o1", name: "A", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const room = (await ctx.db.query("rooms").collect()).find((r) => r.orgId === "o1")!;
      // Nudge each session an hour into the future and cover one extra day:
      // a session starting exactly at "now" has already fallen out of the
      // forward-looking window by the time the query runs.
      for (let i = 0; i <= 14; i++) {
        const startTime = Date.now() + i * DAY + 3_600_000;
        await ctx.db.insert("sessions", {
          orgId: "o1", title: `Day ${i}`, artistId: artist, roomId: room._id,
          serviceType: "recording",
          startTime, endTime: startTime + 3_600_000,
          status: "confirmed", rateCents: 10_000, depositCents: 0,
          depositPaid: true, amountPaidCents: 0, intakeCompleted: true,
        });
      }
    });

    const res = await t.query(api.directory.search, {});
    expect(res.listings[0].slug).toBe("free");
    expect(res.listings[0].nextOpenAt).not.toBeNull();
    expect(res.listings[1].nextOpenAt).toBeNull();
  });

  it("offers the cities and regions that are actually listed", async () => {
    const t = convexTest(schema);
    await studio(t, { orgId: "o1", slug: "a", name: "A", city: "Atlanta" });
    await studio(t, { orgId: "o2", slug: "b", name: "B", city: "Brooklyn" });
    const res = await t.query(api.directory.search, {});
    expect(res.cities).toEqual(["Atlanta", "Brooklyn"]);
    expect(res.regions).toEqual(["GA"]);
  });
});

describe("the studio's own controls", () => {
  it("starts off, and turning it on is one call", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "o1", name: "V", slug: "v", plan: "solo" });
      await ctx.db.insert("members", {
        orgId: "o1", name: "Owner", role: "owner", skills: [], clerkUserId: "u_own",
      });
      await ctx.db.insert("rooms", {
        orgId: "o1", name: "A", hourlyRateCents: 9_000, status: "available", bookable: true,
      });
    });
    const asOwner = t.withIdentity({ subject: "u_own", orgId: "o1" });

    expect((await asOwner.query(api.directory.mySettings, {})).listed).toBe(false);
    await asOwner.mutation(api.directory.updateSettings, {
      listed: true, city: "Atlanta", blurb: "  Warm room.  ",
    });
    const after = await asOwner.query(api.directory.mySettings, {});
    expect(after.listed).toBe(true);
    expect(after.blurb).toBe("Warm room.");
    expect((await t.query(api.directory.search, {})).total).toBe(1);
  });

  it("trims and caps tags so a listing cannot be stuffed", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "o1", name: "V", slug: "v", plan: "solo" });
      await ctx.db.insert("members", {
        orgId: "o1", name: "O", role: "owner", skills: [], clerkUserId: "u_own",
      });
    });
    const asOwner = t.withIdentity({ subject: "u_own", orgId: "o1" });
    await asOwner.mutation(api.directory.updateSettings, {
      tags: Array.from({ length: 30 }, (_, i) => ` tag${i} `),
    });
    const s = await asOwner.query(api.directory.mySettings, {});
    expect(s.tags).toHaveLength(8);
    expect(s.tags[0]).toBe("tag0");
  });

  it("tells a studio with no bookable room why it will not appear", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "o1", name: "V", slug: "v", plan: "solo" });
      await ctx.db.insert("members", {
        orgId: "o1", name: "O", role: "owner", skills: [], clerkUserId: "u_own",
      });
    });
    const asOwner = t.withIdentity({ subject: "u_own", orgId: "o1" });
    expect((await asOwner.query(api.directory.mySettings, {})).preview).toBeNull();
  });
});
