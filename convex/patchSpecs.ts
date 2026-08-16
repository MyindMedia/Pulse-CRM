import { v, ConvexError } from "convex/values";
import {
  action,
  internalAction,
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { currentOrgWithCapability, currentActor } from "./lib/tenant";
import { conventionalPortGender } from "./lib/connectors";
import { logPatch } from "./patchManager";
import {
  researchDeviceIO,
  hasDeviceResearch,
  readDeviceSpec,
  fetchSourceText,
  MAX_SOURCE_CHARS,
} from "./lib/deviceResearch";
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
      orgId: profile.orgId,
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
    if (!hasDeviceResearch()) return { status: "no-model" };

    await ctx.runMutation(internal.patchSpecs.markLookupStarted, { profileId });

    const answer = await researchDeviceIO<SpecCandidate>(
      specPrompt({
        name: profile.name,
        manufacturer: profile.manufacturer,
        category: profile.category,
        note: profile.catalogId
          ? GEAR_CATALOG.find((g) => g.id === profile.catalogId)?.note
          : undefined,
      }),
      "You are a studio technician cataloguing the back panel of audio hardware. " +
        "You answer only about physical connectors, and you say so when you do not " +
        "know a specific model rather than inventing plausible I/O. " +
        "Respond with ONLY a single valid JSON object matching this shape: " +
        JSON.stringify(SPEC_SCHEMA.schema),
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

    if (resolved.gaps.length && profile.orgId) {
      await ctx.runMutation(internal.patchSpecs.recordVocabGaps, {
        orgId: profile.orgId,
        device: profile.name,
        gaps: resolved.gaps,
      });
    }

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

/* ============================================================
   Configuring a device from a spec sheet the studio supplies.

   Two steps on purpose. `propose` reads the source and returns
   what it found, writing nothing. `applyProposal` writes exactly
   the changes that came back approved. A jack can have a cable
   in it, and destroying one silently un-patches a run somebody
   documented - so every removal is shown and refusable before
   anything happens.
   ============================================================ */

const SPEC_SYSTEM =
  "You are a studio technician reading a manufacturer's documentation and " +
  "listing the physical connectors on the device's chassis. Use ONLY what the " +
  "document states. If the document does not describe this device's I/O, set " +
  "confident to false and return no ports. Respond with ONLY a single valid " +
  "JSON object matching this shape: ";

export const deviceForProposal = internalQuery({
  args: { deviceInstanceId: v.id("deviceInstances") },
  handler: async (ctx, { deviceInstanceId }) => {
    const device = await ctx.db.get(deviceInstanceId);
    if (!device) return null;
    const profile = await ctx.db.get(device.profileId);
    return {
      orgId: device.orgId,
      label: device.label,
      category: profile?.category ?? "other",
      manufacturer: profile?.manufacturer ?? "",
    };
  },
});

/**
 * Read a source and return the ports it describes. Writes nothing.
 *
 * Exactly one of url / text / storageId is used, in that order. The result
 * goes through the same validator as every other lookup, so a document
 * cannot introduce a connector the mating engine has never heard of.
 */
export const proposeFromSource = action({
  args: {
    deviceInstanceId: v.id("deviceInstances"),
    url: v.optional(v.string()),
    text: v.optional(v.string()),
    /** An uploaded photo of the back panel. */
    imageId: v.optional(v.id("_storage")),
  },
  handler: async (
    ctx,
    { deviceInstanceId, url, text, imageId },
  ): Promise<{
    ok: boolean;
    reason?: string;
    ports?: unknown[];
    summary?: string;
    model?: string;
    rejected?: number;
  }> => {
    const device = await ctx.runQuery(internal.patchSpecs.deviceForProposal, {
      deviceInstanceId,
    });
    if (!device) return { ok: false, reason: "That device is gone." };
    if (!hasDeviceResearch()) {
      return { ok: false, reason: "No device research key is configured." };
    }

    let sourceText: string | null = null;
    let images: string[] | undefined;
    let sourceLabel = "";

    if (imageId) {
      const blob = await ctx.storage.get(imageId);
      if (!blob) return { ok: false, reason: "That upload is gone." };
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      images = [btoa(binary)];
      sourceLabel = "the photo";
    } else if (url?.trim()) {
      sourceText = await fetchSourceText(url.trim());
      if (!sourceText) {
        return {
          ok: false,
          reason:
            "Could not read that link. If it is a PDF, download it and upload the file instead.",
        };
      }
      sourceLabel = url.trim();
    } else if (text?.trim()) {
      sourceText = text.trim().slice(0, MAX_SOURCE_CHARS);
      sourceLabel = "the pasted text";
    } else {
      return { ok: false, reason: "Give a link, a file or some text to read." };
    }

    const prompt = [
      `Device: ${[device.manufacturer, device.label].filter(Boolean).join(" ")}`,
      `Category: ${device.category}`,
      "",
      images
        ? "The image shows the rear panel of this device. List every jack visible on it."
        : `Documentation follows. List the connectors it describes.\n\n${sourceText}`,
    ].join("\n");

    const answer = await readDeviceSpec<SpecCandidate>(
      prompt,
      SPEC_SYSTEM + JSON.stringify(SPEC_SCHEMA.schema),
      images,
    );

    if (!answer || answer.data?.confident === false) {
      return {
        ok: false,
        reason: `Nothing about this device's I/O could be read from ${sourceLabel}.`,
      };
    }

    const resolved = resolveSpec(answer.data, device.category);

    // Record the words we could not place either way. A sheet that failed
    // outright is the richest source of missing vocabulary there is.
    if (resolved.gaps.length) {
      await ctx.runMutation(internal.patchSpecs.recordVocabGaps, {
        orgId: device.orgId,
        device: device.label,
        gaps: resolved.gaps,
      });
    }

    if (resolved.source !== "ai") {
      // Say what was actually seen. "Nothing usable" with no detail leaves
      // someone re-uploading the same file hoping for a different answer.
      const seen = (answer.data?.ports ?? [])
        .slice(0, 3)
        .map((p) => `${p.label ?? "?"} (${p.connector ?? "no connector"})`)
        .join(", ");
      return {
        ok: false,
        reason:
          `Read ${answer.data?.ports?.length ?? 0} entries but could not use them` +
          (seen ? `: ${seen}` : "") +
          ". Try the paste option with just the connector list.",
      };
    }

    return {
      ok: true,
      ports: resolved.ports,
      summary: resolved.summary,
      model: answer.model,
      rejected: resolved.rejected,
    };
  },
});

/**
 * Write the approved changes, and only those.
 *
 * The caller sends what a human agreed to after seeing the diff, so this
 * adds the ports it was given and removes the ports it was told to. The
 * device is marked hand-configured, which stops any later lookup from
 * quietly undoing the work.
 */
export const applyProposal = mutation({
  args: {
    deviceInstanceId: v.id("deviceInstances"),
    add: v.array(portTemplateV),
    removePortIds: v.array(v.id("ports")),
    sourceLabel: v.optional(v.string()),
  },
  handler: async (ctx, { deviceInstanceId, add, removePortIds, sourceLabel }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const actor = await currentActor(ctx);
    const device = await ctx.db.get(deviceInstanceId);
    if (!device || device.orgId !== orgId) {
      throw new ConvexError("That device belongs to another studio.");
    }

    let pulled = 0;
    for (const portId of removePortIds) {
      const port = await ctx.db.get(portId);
      // Silently skip anything that moved under us rather than failing the
      // whole apply half way through.
      if (!port || port.deviceInstanceId !== deviceInstanceId) continue;

      for (const index of ["by_fromPort", "by_toPort"] as const) {
        const edges = await ctx.db
          .query("connections")
          .withIndex(index, (q) =>
            index === "by_fromPort" ? q.eq("fromPortId", portId) : q.eq("toPortId", portId),
          )
          .collect();
        for (const edge of edges) {
          await ctx.db.delete(edge._id);
          pulled += 1;
        }
      }
      await ctx.db.delete(portId);
    }

    for (const template of add) {
      await ctx.db.insert("ports", {
        orgId,
        patchSpaceId: device.patchSpaceId,
        deviceInstanceId,
        label: template.label,
        direction: template.direction,
        signalLevel: template.signalLevel,
        connector: template.connector,
        gender: template.gender ?? conventionalPortGender(template.connector, template.direction),
        channelIndex: template.channelIndex,
        capabilities: template.capabilities,
        state: {},
      });
    }

    // A person read a manual and agreed with it. That outranks any later
    // guess, so the profile stops being a candidate for re-lookup.
    await ctx.db.patch(device.profileId, {
      specSource: "manual",
      specVerifiedAt: Date.now(),
      specVerifiedBy: actor,
      specNote: sourceLabel ? `Configured from ${sourceLabel}` : undefined,
    });

    await logPatch(ctx, actor, {
      orgId,
      patchSpaceId: device.patchSpaceId,
      entityType: "device",
      entityId: deviceInstanceId,
      changeType: "update",
      summary:
        `Configured ${device.label} from a spec sheet: ` +
        `${add.length} port${add.length === 1 ? "" : "s"} added, ` +
        `${removePortIds.length} removed` +
        (pulled ? `, ${pulled} cable${pulled === 1 ? "" : "s"} pulled` : ""),
    });

    return { added: add.length, removed: removePortIds.length, cablesPulled: pulled };
  },
});

/* ============================================================
   Words the vocabulary does not know yet.

   A connector we cannot name is a port we drop, and a dropped
   port is invisible: nobody finds out that "EtherCON" turned up
   nine times last month. Recording the term turns that silence
   into a short list - and a term on a list is a term that can be
   promoted into the mating table, which is the only way the
   vocabulary actually grows.
   ============================================================ */

export const recordVocabGaps = internalMutation({
  args: {
    orgId: v.string(),
    device: v.optional(v.string()),
    gaps: v.array(
      v.object({
        kind: v.union(
          v.literal("connector"),
          v.literal("signalLevel"),
          v.literal("direction"),
        ),
        term: v.string(),
        onPort: v.string(),
      }),
    ),
  },
  handler: async (ctx, { orgId, device, gaps }) => {
    const now = Date.now();
    for (const gap of gaps) {
      const term = gap.term.trim().toLowerCase();
      if (!term || term.length > 60) continue;

      const existing = await ctx.db
        .query("patchVocabGaps")
        .withIndex("by_org_term", (q) =>
          q.eq("orgId", orgId).eq("kind", gap.kind).eq("term", term),
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, { seen: existing.seen + 1, lastSeenAt: now });
        continue;
      }

      await ctx.db.insert("patchVocabGaps", {
        orgId,
        kind: gap.kind,
        term,
        rawTerm: gap.term.trim(),
        seen: 1,
        exampleDevice: device,
        examplePort: gap.onPort,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }
  },
});

/**
 * What the vocabulary is missing, commonest first.
 *
 * This is the queue that turns "a jack went missing" into "add EtherCON".
 */
export const vocabGaps = query({
  args: { includeResolved: v.optional(v.boolean()) },
  handler: async (ctx, { includeResolved }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.read");
    const rows = await ctx.db
      .query("patchVocabGaps")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    return rows
      .filter((r) => includeResolved || !r.resolvedAt)
      .sort((a, b) => b.seen - a.seen || b.lastSeenAt - a.lastSeenAt)
      .map((r) => ({
        _id: r._id,
        kind: r.kind,
        term: r.rawTerm,
        seen: r.seen,
        exampleDevice: r.exampleDevice ?? null,
        examplePort: r.examplePort ?? null,
        lastSeenAt: r.lastSeenAt,
        resolvedAs: r.resolvedAs ?? null,
      }));
  },
});

/** Mark a gap dealt with, once the term is in the vocabulary or refused. */
export const resolveVocabGap = mutation({
  args: { id: v.id("patchVocabGaps"), resolvedAs: v.optional(v.string()) },
  handler: async (ctx, { id, resolvedAs }) => {
    const orgId = await currentOrgWithCapability(ctx, "patch.edit");
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new ConvexError("That entry is gone.");
    await ctx.db.patch(id, { resolvedAt: Date.now(), resolvedAs });
  },
});
