import { v, ConvexError } from "convex/values";
import {
  internalAction,
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { currentOrgWithCapability, currentActor } from "./lib/tenant";
import { completeJSON, hasOpenAI } from "./lib/openai";
import { portTemplateV } from "./lib/patchValidators";
import { CATALOG_PORTS } from "./lib/portTemplates";
import { GEAR_CATALOG } from "./lib/gearCatalog";
import {
  resolveSpec,
  specPrompt,
  SPEC_SCHEMA,
  type SpecCandidate,
} from "./lib/specLookup";

/* ============================================================
   Where a device's I/O comes from.

   Three tiers, in order of how much they deserve to be trusted:

     curated   a hand-written port map. 34 devices, exact, and the
               only tier that needs no human nod.
     ai        looked up once from the model name and cached on the
               profile. Correct far more often than a category
               guess, and still flagged until someone agrees.
     category  a generic template for the gear class. Honest about
               being a guess, and always the floor - a lookup that
               fails never leaves a device unpatchable.

   The tier is stored on the profile, so the canvas can say which
   one you are looking at rather than presenting every port list
   with the same confidence.
   ============================================================ */

/** How long a failed or in-flight lookup blocks a retry. */
const LOOKUP_COOLDOWN_MS = 10 * 60 * 1000;

export const profileSpec = internalQuery({
  args: { profileId: v.id("deviceProfiles") },
  handler: async (ctx, { profileId }) => {
    const profile = await ctx.db.get(profileId);
    if (!profile) return null;
    return {
      _id: profile._id,
      name: profile.name,
      manufacturer: profile.manufacturer,
      category: profile.category,
      catalogId: profile.catalogId,
      specSource: profile.specSource,
      specLookupAt: profile.specLookupAt,
      portCount: profile.portTemplate.length,
    };
  },
});

export const markLookupStarted = internalMutation({
  args: { profileId: v.id("deviceProfiles") },
  handler: async (ctx, { profileId }) => {
    await ctx.db.patch(profileId, { specLookupAt: Date.now() });
  },
});

export const storeSpec = internalMutation({
  args: {
    profileId: v.id("deviceProfiles"),
    ports: v.array(portTemplateV),
    source: v.union(v.literal("ai"), v.literal("category")),
    summary: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, { profileId, ports, source, summary, model }) => {
    const profile = await ctx.db.get(profileId);
    if (!profile) return;
    // Someone editing the ports by hand outranks anything a lookup finds
    // later. Their answer is the answer.
    if (profile.specSource === "manual" || profile.specSource === "curated") return;

    await ctx.db.patch(profileId, {
      portTemplate: ports,
      specSource: source,
      specNote: summary,
      specModel: model,
      specLookupAt: undefined,
      // A fresh lookup is not verified, whatever it replaced.
      specVerifiedAt: undefined,
      specVerifiedBy: undefined,
    });
  },
});

/**
 * Look up one device's I/O and cache it on the profile.
 *
 * Runs at most once per profile: the result is stored, so the second
 * studio to place a Scarlett 18i20 pays nothing. Never throws into the
 * caller - a failed lookup leaves the category default in place, which is
 * exactly what the device already had.
 */
export const lookupProfile = internalAction({
  args: { profileId: v.id("deviceProfiles") },
  handler: async (ctx, { profileId }): Promise<{ status: string }> => {
    const profile = await ctx.runQuery(internal.patchSpecs.profileSpec, { profileId });
    if (!profile) return { status: "missing" };

    // Curated and hand-edited profiles are already better than a lookup.
    if (profile.specSource === "curated" || profile.specSource === "manual") {
      return { status: "already-trusted" };
    }
    if (profile.specSource === "ai") return { status: "cached" };
    if (profile.specLookupAt && Date.now() - profile.specLookupAt < LOOKUP_COOLDOWN_MS) {
      return { status: "in-flight" };
    }
    if (!hasOpenAI()) return { status: "no-model" };

    await ctx.runMutation(internal.patchSpecs.markLookupStarted, { profileId });

    const answer = await completeJSON<SpecCandidate>(
      specPrompt({
        name: profile.name,
        manufacturer: profile.manufacturer,
        category: profile.category,
        note: profile.catalogId
          ? GEAR_CATALOG.find((g) => g.id === profile.catalogId)?.note
          : undefined,
      }),
      {
        system:
          "You are a studio technician cataloguing the back panel of audio hardware. " +
          "You answer only about physical connectors, and you say so when you do not " +
          "know a specific model rather than inventing plausible I/O.",
        schema: SPEC_SCHEMA,
        maxOutputTokens: 1400,
      },
    );

    // The model declining to be sure is a real answer, and a better one than
    // a confident fabrication. Treat it as no result.
    const candidate = answer?.data?.confident === false ? null : answer?.data;
    const resolved = resolveSpec(candidate, profile.category);

    await ctx.runMutation(internal.patchSpecs.storeSpec, {
      profileId,
      ports: resolved.ports,
      source: resolved.source,
      summary: resolved.summary,
      model: answer?.model,
    });

    return { status: resolved.source === "ai" ? "resolved" : "fell-back" };
  },
});

/** Kick a lookup for a profile the caller can see. Fire and forget. */
export const requestLookup = mutation({
  args: { profileId: v.id("deviceProfiles") },
  handler: async (ctx, { profileId }) => {
    await currentOrgWithCapability(ctx, "patch.edit");
    const profile = await ctx.db.get(profileId);
    if (!profile) throw new ConvexError("That device profile is gone.");
    await ctx.scheduler.runAfter(0, internal.patchSpecs.lookupProfile, { profileId });
  },
});

/**
 * A human agreeing with the ports. This is the whole point of the flag:
 * once someone who can see the actual rack says yes, the device stops
 * asking, forever.
 */
export const verifySpec = mutation({
  args: { profileId: v.id("deviceProfiles") },
  handler: async (ctx, { profileId }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const profile = await ctx.db.get(profileId);
    if (!profile) throw new ConvexError("That device profile is gone.");
    // Global profiles are shared, so a studio may only vouch for its own.
    if (profile.scope === "studio" && profile.orgId !== orgId) {
      throw new ConvexError("That device profile belongs to another studio.");
    }

    await ctx.db.patch(profileId, {
      specVerifiedAt: Date.now(),
      specVerifiedBy: actor,
    });
  },
});

/**
 * Replace a profile's ports by hand. Marks the spec `manual`, which stops
 * any future lookup from overwriting a person who has seen the hardware.
 */
export const setPorts = mutation({
  args: {
    profileId: v.id("deviceProfiles"),
    ports: v.array(portTemplateV),
  },
  handler: async (ctx, { profileId, ports }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const profile = await ctx.db.get(profileId);
    if (!profile) throw new ConvexError("That device profile is gone.");
    if (profile.scope === "studio" && profile.orgId !== orgId) {
      throw new ConvexError("That device profile belongs to another studio.");
    }
    if (ports.length === 0) throw new ConvexError("A device needs at least one port.");

    await ctx.db.patch(profileId, {
      portTemplate: ports,
      specSource: "manual",
      specVerifiedAt: Date.now(),
      specVerifiedBy: actor,
      specNote: undefined,
    });
  },
});

/**
 * What the studio should be asked to confirm.
 *
 * Deliberately only surfaces profiles whose ports are a guess, so the list
 * is a finite job that reaches zero, not a permanent chore.
 */
export const unverified = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.read");
    const mine = await ctx.db
      .query("deviceProfiles")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    return mine
      .filter(
        (p) =>
          !p.specVerifiedAt &&
          (p.specSource === "ai" || p.specSource === "category" || !p.specSource),
      )
      .map((p) => ({
        _id: p._id,
        name: p.name,
        manufacturer: p.manufacturer,
        category: p.category,
        source: p.specSource ?? "category",
        note: p.specNote ?? null,
        portCount: p.portTemplate.length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Which catalog ids ship a hand-written map. Used by the seed and tests. */
export const curatedCatalogIds = Object.keys(CATALOG_PORTS);
