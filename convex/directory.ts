import { fileUrl } from "./lib/media";
import { query } from "./_generated/server";
import { mutation } from "./functions";
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireCapability } from "./lib/access";
import { currentOrg } from "./lib/tenant";
import { localDayKey, orgTz } from "./lib/tz";
import { bookingFeatures } from "./lib/roomBusy";
import { citySlug, CITY_PAGE_MIN_STUDIOS } from "./lib/places";

/* ============================================================
   Find a Studio on Pulse - the public directory.

   Studiotime is gone and Stufinder takes ten percent. Pulse already
   knows which rooms exist, what they cost and when they are free, so
   it can answer "where can I record on Saturday" without charging
   anybody a commission for the answer.

   That is the point: for a studio, Pulse stops being a cost line and
   starts being a lead source. For Pulse, every listing is a booking
   page carrying its name.

   SAFETY: every query here is PUBLIC and unauthenticated. Nothing in
   this file may return a field that is not already visible on the
   studio's own public booking page. Opt-in, off by default.
   ============================================================ */

const MAX_RESULTS = 60;
const DAY = 86_400_000;

/** The only fields a listing may expose. Anything not built here does not
 *  leave the building. */
type Listing = {
  slug: string;
  name: string;
  blurb: string | null;
  city: string | null;
  region: string | null;
  tags: string[];
  logoUrl: string | null;
  heroUrl: string | null;
  roomCount: number;
  fromHourlyCents: number | null;
  services: string[];
  nextOpenAt: number | null;
  bookingPath: string;
  /** City Page key, when the studio named its city. */
  citySlug: string | null;
  /** Only when the studio chose to show its Google reviews. A place ID is
   *  public on Google Maps; the rating itself is fetched, never stored. */
  googlePlaceId: string | null;
};

async function buildListing(
  ctx: QueryCtx,
  org: Doc<"orgs">,
  opts: { withAvailability: boolean },
): Promise<Listing | null> {
  const rooms = (await ctx.db
    .query("rooms")
    .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
    .collect()).filter((r) => r.bookable !== false && r.status !== "retired");
  // A studio with nothing bookable is not a search result, it is a dead end.
  if (rooms.length === 0) return null;

  const rates = rooms
    .map((r) => r.hourlyRateCents ?? 0)
    .filter((c) => c > 0);

  let nextOpenAt: number | null = null;
  if (opts.withAvailability) {
    // "Next open day" is the honest, cheap version of live availability: the
    // first of the next fourteen days with no confirmed session in any room.
    const now = Date.now();
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", org.orgId).gte("startTime", now).lt("startTime", now + 14 * DAY),
      )
      .collect();
    // In the STUDIO's timezone, not UTC. A session at 8pm Pacific is 4am UTC
    // the next day, so a UTC bucket would call a booked Saturday free.
    const tz = orgTz(org);
    const busyDays = new Set(
      sessions
        .filter((s) => s.status !== "cancelled")
        .map((s) => localDayKey(s.startTime, tz)),
    );
    for (let i = 0; i < 14; i++) {
      const at = now + i * DAY;
      if (!busyDays.has(localDayKey(at, tz))) {
        nextOpenAt = at;
        break;
      }
    }
  }

  return {
    slug: org.slug,
    name: org.name,
    blurb: org.directoryBlurb ?? org.tagline ?? null,
    city: org.directoryCity ?? null,
    region: org.directoryRegion ?? null,
    tags: org.directoryTags ?? [],
    logoUrl: org.logoId ? await fileUrl(ctx, org.logoId) : null,
    heroUrl: org.bookingHeroId
      ? await fileUrl(ctx, org.bookingHeroId)
      : org.generatedHeroId
        ? await fileUrl(ctx, org.generatedHeroId)
        : null,
    roomCount: rooms.length,
    // A studio that hides pricing on its booking link hides it here too. Null
    // also keeps it out of a max-price search, which would otherwise reveal
    // the rate one filter at a time.
    fromHourlyCents: bookingFeatures(org).hidePricing ? null : rates.length ? Math.min(...rates) : null,
    services: [...new Set(rooms.map((r) => r.roomType).filter(Boolean) as string[])].slice(0, 4),
    nextOpenAt,
    bookingPath: `/book/${org.slug}`,
    citySlug: org.directoryCity ? citySlug(org.directoryCity, org.directoryRegion) || null : null,
    googlePlaceId: org.googleReviewsShown === true && org.googlePlaceId ? org.googlePlaceId : null,
  };
}

function listedOrgs(orgs: Doc<"orgs">[]): Doc<"orgs">[] {
  return orgs.filter(
    (o) => o.directoryListed === true && (o.status ?? "active") === "active" && o.orgId !== "pulse-demo",
  );
}

/**
 * PUBLIC. Search listed studios.
 *
 * Unauthenticated by design - this is the front door for artists who have
 * never heard of Pulse. Only opted-in studios are ever returned.
 */
export const search = query({
  args: {
    q: v.optional(v.string()),
    city: v.optional(v.string()),
    region: v.optional(v.string()),
    maxHourlyCents: v.optional(v.number()),
    openWithinDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgs = listedOrgs(await ctx.db.query("orgs").collect());

    const listings: Listing[] = [];
    for (const org of orgs.slice(0, MAX_RESULTS * 2)) {
      const l = await buildListing(ctx, org, { withAvailability: true });
      if (l) listings.push(l);
    }

    const needle = args.q?.trim().toLowerCase();
    const city = args.city?.trim().toLowerCase();
    const region = args.region?.trim().toLowerCase();
    const openBy = args.openWithinDays ? Date.now() + args.openWithinDays * DAY : null;

    const filtered = listings.filter((l) => {
      if (needle) {
        const hay = [l.name, l.blurb, l.city, l.region, ...l.tags, ...l.services]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (city && (l.city ?? "").toLowerCase() !== city) return false;
      if (region && (l.region ?? "").toLowerCase() !== region) return false;
      if (args.maxHourlyCents && (l.fromHourlyCents ?? Infinity) > args.maxHourlyCents) return false;
      if (openBy && (l.nextOpenAt === null || l.nextOpenAt > openBy)) return false;
      return true;
    });

    // Studios with real availability first: a directory that leads with places
    // you cannot book is the thing that killed the last one.
    filtered.sort((a, b) => {
      if ((a.nextOpenAt === null) !== (b.nextOpenAt === null)) return a.nextOpenAt === null ? 1 : -1;
      return (a.nextOpenAt ?? 0) - (b.nextOpenAt ?? 0);
    });

    return {
      total: filtered.length,
      listings: filtered.slice(0, MAX_RESULTS),
      // Facets for the filter UI, from what is actually listed.
      cities: [...new Set(listings.map((l) => l.city).filter(Boolean) as string[])].sort(),
      regions: [...new Set(listings.map((l) => l.region).filter(Boolean) as string[])].sort(),
      // Cities that have a City Page, for links from the directory.
      cityPages: cityPagesOf(listings),
    };
  },
});

/** PUBLIC. One listing by slug, for the directory detail page. */
export const listing = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!org || listedOrgs([org]).length === 0) return null;
    return await buildListing(ctx, org, { withAvailability: true });
  },
});

/** Cities with enough Listed Studios for a City Page, from listings in hand. */
function cityPagesOf(listings: Listing[]) {
  const seen = new Map<string, { slug: string; city: string; region: string | null; count: number }>();
  for (const l of listings) {
    if (!l.city || !l.citySlug) continue;
    const c = seen.get(l.citySlug) ?? { slug: l.citySlug, city: l.city, region: l.region, count: 0 };
    c.count++;
    seen.set(l.citySlug, c);
  }
  return [...seen.values()]
    .filter((c) => c.count >= CITY_PAGE_MIN_STUDIOS)
    .map(({ slug, city, region }) => ({ slug, city, region }))
    .sort((a, b) => a.city.localeCompare(b.city));
}

type CityGroup = { slug: string; city: string; region: string | null; listings: Listing[] };

async function cityGroups(ctx: QueryCtx, withAvailability: boolean): Promise<CityGroup[]> {
  const groups = new Map<string, CityGroup>();
  for (const org of listedOrgs(await ctx.db.query("orgs").collect()).slice(0, MAX_RESULTS * 4)) {
    const l = await buildListing(ctx, org, { withAvailability });
    if (!l || !l.city || !l.citySlug) continue;
    const g = groups.get(l.citySlug) ?? { slug: l.citySlug, city: l.city, region: l.region, listings: [] };
    g.listings.push(l);
    groups.set(l.citySlug, g);
  }
  return [...groups.values()].filter((g) => g.listings.length >= CITY_PAGE_MIN_STUDIOS);
}

/** PUBLIC. A City Page: the Listed Studios in one city, or null when fewer
 *  than CITY_PAGE_MIN_STUDIOS share it (a thin page is worse than none). */
export const city = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const g = (await cityGroups(ctx, true)).find((c) => c.slug === slug);
    if (!g) return null;
    g.listings.sort((a, b) => a.name.localeCompare(b.name));
    return g;
  },
});

/** PUBLIC. What the sitemap and llms.txt list: every Listed Studio with
 *  something bookable, and every city that has a City Page. */
export const sitemapEntries = query({
  args: {},
  handler: async (ctx) => {
    const studios: Array<{ slug: string; name: string; city: string | null; region: string | null; blurb: string | null }> = [];
    for (const org of listedOrgs(await ctx.db.query("orgs").collect()).slice(0, MAX_RESULTS * 4)) {
      const l = await buildListing(ctx, org, { withAvailability: false });
      if (l) studios.push({ slug: l.slug, name: l.name, city: l.city, region: l.region, blurb: l.blurb });
    }
    const cities = (await cityGroups(ctx, false)).map((g) => ({
      slug: g.slug,
      city: g.city,
      region: g.region,
      count: g.listings.length,
    }));
    studios.sort((a, b) => a.name.localeCompare(b.name));
    cities.sort((a, b) => a.city.localeCompare(b.city));
    return { studios, cities };
  },
});

/** The studio's own directory settings. */
export const mySettings = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    const preview = org ? await buildListing(ctx, org, { withAvailability: false }) : null;
    return {
      listed: org?.directoryListed === true,
      blurb: org?.directoryBlurb ?? "",
      city: org?.directoryCity ?? "",
      region: org?.directoryRegion ?? "",
      tags: org?.directoryTags ?? [],
      // Null means there is nothing bookable yet, which is the real reason a
      // listing would not appear. Say that rather than showing an empty card.
      preview,
    };
  },
});

export const updateSettings = mutation({
  args: {
    listed: v.optional(v.boolean()),
    blurb: v.optional(v.string()),
    city: v.optional(v.string()),
    region: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "branding.edit");
    const orgId = await currentOrg(ctx);
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error("Workspace not found.");
    await ctx.db.patch(org._id, {
      ...(args.listed !== undefined ? { directoryListed: args.listed } : {}),
      ...(args.blurb !== undefined ? { directoryBlurb: args.blurb.trim().slice(0, 200) || undefined } : {}),
      ...(args.city !== undefined ? { directoryCity: args.city.trim().slice(0, 80) || undefined } : {}),
      ...(args.region !== undefined ? { directoryRegion: args.region.trim().slice(0, 80) || undefined } : {}),
      ...(args.tags !== undefined
        ? {
            directoryTags: [...new Set(
              args.tags.map((t) => t.trim().slice(0, 40)).filter(Boolean),
            )].slice(0, 8),
          }
        : {}),
    });
  },
});
