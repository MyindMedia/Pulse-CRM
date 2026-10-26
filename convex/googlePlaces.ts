/* ============================================================
   Settings > Integrations > Google reviews
   (openspec/changes/google-reviews-studio-seo).

   The team finds its business on Google and links that Google Listing.
   Pulse stores the place ID only (Google Places terms). Linking fills the
   review link the SMS thank-you sends; showing the rating and reviews on
   the public pages is a second, separate switch.

   Owners and managers (branding.edit, the settings gate). The public
   pages never call this file: the Next.js server fetches Google itself,
   so no public endpoint here can spend Pulse's Google quota.
   ============================================================ */
import { v, ConvexError } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { mutation } from "./functions";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { currentOrgWithCapability, currentActor } from "./lib/tenant";
import {
  PLACES_BASE,
  PLACE_FULL_FIELDS,
  PLACE_SEARCH_FIELDS,
  isPlaceId,
  parsePlace,
  parseSearch,
  writeReviewUrl,
  type GooglePlace,
  type PlaceCandidate,
} from "./lib/places";

const TIMEOUT_MS = 8_000;

function placesKey(): string | null {
  return process.env.GOOGLE_PLACES_API_KEY?.trim() || null;
}

async function orgDoc(db: QueryCtx["db"], orgId: string) {
  return db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
}

async function log(ctx: MutationCtx, org: Doc<"orgs">, summary: string) {
  const actor = await currentActor(ctx);
  await ctx.db.insert("activity", {
    orgId: org.orgId,
    kind: "settings.integrations",
    summary: `${summary} by ${actor}`,
    actorName: actor,
    entityType: "org",
    entityId: org.orgId,
    accent: "info",
  });
}

async function google(path: string, init: RequestInit & { fields: string }): Promise<unknown> {
  const key = placesKey();
  if (!key) throw new ConvexError({ code: "UNAVAILABLE", message: "Google reviews are not available yet." });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PLACES_BASE}${path}`, {
      ...init,
      headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": init.fields },
      signal: ctl.signal,
    });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`Google Places ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e instanceof ConvexError) throw e;
    console.error("google places", e instanceof Error ? e.message : e);
    throw new ConvexError({ code: "UPSTREAM", message: "Google did not answer. Try again in a minute." });
  } finally {
    clearTimeout(timer);
  }
}

/** The Integrations card. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "branding.edit");
    const org = await orgDoc(ctx.db, orgId);
    return {
      available: placesKey() !== null,
      placeId: org?.googlePlaceId ?? null,
      connectedAt: org?.googlePlaceConnectedAt ?? null,
      shown: org?.googleReviewsShown === true,
      studioName: org?.name ?? "",
    };
  },
});

/** Auth for the actions below: runs as the caller, so it carries their identity. */
export const _caller = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "branding.edit");
    const org = await orgDoc(ctx.db, orgId);
    return { orgId, placeId: org?.googlePlaceId ?? null, actor: await currentActor(ctx) };
  },
});

/** Find the studio on Google by name and city. */
export const search = action({
  args: { q: v.string() },
  handler: async (ctx, { q }): Promise<PlaceCandidate[]> => {
    await ctx.runQuery(internal.googlePlaces._caller, {});
    const textQuery = q.trim().slice(0, 120);
    if (textQuery.length < 2) return [];
    const json = await google("/places:searchText", {
      method: "POST",
      body: JSON.stringify({ textQuery, pageSize: 5 }),
      fields: PLACE_SEARCH_FIELDS,
    });
    return parseSearch(json);
  },
});

/** The linked listing as Google has it now, for the settings preview. */
export const details = action({
  args: {},
  handler: async (ctx): Promise<GooglePlace | null> => {
    const self = await ctx.runQuery(internal.googlePlaces._caller, {});
    if (!self.placeId) return null;
    const json = await google(`/places/${encodeURIComponent(self.placeId)}`, { method: "GET", fields: PLACE_FULL_FIELDS });
    return parsePlace(json, self.placeId);
  },
});

/** Link a Google Listing. Confirms with Google that the place exists first. */
export const connect = action({
  args: { placeId: v.string() },
  handler: async (ctx, { placeId }): Promise<GooglePlace> => {
    const self = await ctx.runQuery(internal.googlePlaces._caller, {});
    if (!isPlaceId(placeId)) throw new ConvexError({ code: "INVALID", message: "That is not a Google place." });
    const json = await google(`/places/${encodeURIComponent(placeId)}`, { method: "GET", fields: PLACE_FULL_FIELDS });
    const place = parsePlace(json, placeId);
    if (!place) throw new ConvexError({ code: "NOT_FOUND", message: "Google could not find that place. Search again." });
    await ctx.runMutation(internal.googlePlaces._link, {
      orgId: self.orgId,
      placeId,
      googleName: place.name ?? "",
      actor: self.actor,
    });
    return place;
  },
});

export const _link = internalMutation({
  args: { orgId: v.string(), placeId: v.string(), googleName: v.string(), actor: v.string() },
  handler: async (ctx, { orgId, placeId, googleName, actor }) => {
    const org = await orgDoc(ctx.db, orgId);
    if (!org) throw new ConvexError({ code: "NOT_FOUND", message: "Studio not found." });
    await ctx.db.patch(org._id, {
      googlePlaceId: placeId,
      googlePlaceConnectedAt: Date.now(),
      // A new listing starts hidden: linking and showing are two decisions.
      googleReviewsShown: org.googlePlaceId === placeId ? org.googleReviewsShown : false,
      googleReviewUrl: writeReviewUrl(placeId),
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "settings.integrations",
      summary: `Google Listing linked (${googleName || placeId}) by ${actor}`,
      actorName: actor,
      entityType: "org",
      entityId: orgId,
      accent: "info",
    });
  },
});

/** Show or hide the Google rating and reviews on the public pages. */
export const setShown = mutation({
  args: { shown: v.boolean() },
  handler: async (ctx, { shown }) => {
    const orgId = await currentOrgWithCapability(ctx, "branding.edit");
    const org = await orgDoc(ctx.db, orgId);
    if (!org?.googlePlaceId) throw new ConvexError({ code: "INVALID", message: "Link your Google Listing first." });
    if ((org.googleReviewsShown === true) === shown) return;
    await ctx.db.patch(org._id, { googleReviewsShown: shown });
    await log(ctx, org, shown ? "Google reviews shown publicly" : "Google reviews hidden");
  },
});

/** Unlink. The review link goes too, unless the studio pasted its own. */
export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "branding.edit");
    const org = await orgDoc(ctx.db, orgId);
    if (!org?.googlePlaceId) return;
    const derived = writeReviewUrl(org.googlePlaceId);
    await ctx.db.patch(org._id, {
      googlePlaceId: undefined,
      googlePlaceConnectedAt: undefined,
      googleReviewsShown: undefined,
      ...(org.googleReviewUrl === derived ? { googleReviewUrl: undefined } : {}),
    });
    await log(ctx, org, "Google Listing unlinked");
  },
});
