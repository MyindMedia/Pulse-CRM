import { action, internalAction, internalQuery, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { fileRefV } from "./lib/fileRef";
import { buildStudioCaps, resolveViewer } from "./lib/access";
import type { StudioRole } from "./lib/accessTypes";
import { requireFeature, orgHasFeature } from "./lib/entitlements";
import { PLAN_LIMITS } from "./lib/plans";
import { tierForOrg } from "./lib/tier";
import { creditSourceV, CREDIT_ROLES } from "./catalogTables";
import { parseArtistLink, mergeCandidates, titleKey, type Candidate } from "./lib/catalogMerge";
import { searchIdentities, resolveArtistLink, discover, type IdentityCandidate } from "./lib/catalogDiscovery";
import { enrichItem, type EnrichOutcome } from "./lib/catalogEnrich";
import { artistKey, isClient } from "./lib/catalogArtists";
import { primaryArtist } from "./lib/musicLink";
import { fillSongFromImport } from "./lib/songEnrich";
import { storeCover } from "./songImport";

/* ============================================================
   Catalog Import (Grilled decisions 1, 2, 11, 12; openspec change
   catalog-import-and-royalties).

   A person picks their Credit Identity at one or more sources and the
   Credit Roles they want, and the songs land in ONE workspace they
   choose per import (the Import Destination): their own account or a
   studio they belong to. The destination's plan pays (Growth and
   above), and every row is written there only; copies in two
   workspaces never sync.

   The job is a chain of scheduled actions: discovery stores the
   merged candidates, then batches enrich a few songs at a time (the
   MusicBrainz pace, about one request a second) and a mutation creates
   or merges each Song. Progress is a reactive row.
   ============================================================ */

const BATCH = 4;
const roleV = v.string();
const identityArgV = v.object({
  source: creditSourceV,
  sourceId: v.string(),
  name: v.string(),
  imageUrl: v.optional(v.string()),
});

/** The caller's Clerk user id, or a refusal. */
async function callerId(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in first." });
  return identity.subject;
}

/** The caller's seat in a workspace, when it may create Songs there. */
async function seatIn(ctx: QueryCtx | MutationCtx, orgId: string, clerkUserId: string): Promise<Doc<"members"> | null> {
  const member = await ctx.db
    .query("members")
    .withIndex("by_org_clerk", (q) => q.eq("orgId", orgId).eq("clerkUserId", clerkUserId))
    .first();
  if (!member) return null;
  const caps = buildStudioCaps(member.role as StudioRole, member.capabilityOverrides);
  return caps.has("songs.edit") ? member : null;
}

/** Workspaces the caller can import into, each with whether its plan allows it. */
export const destinations = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) return [];
    const seats = await ctx.db
      .query("members")
      .withIndex("by_clerk", (q) => q.eq("clerkUserId", identity.subject))
      .collect();
    const viewer = await resolveViewer(ctx).catch(() => null);
    const activeOrgId = viewer && "orgId" in viewer ? viewer.orgId : undefined;
    const out = [];
    for (const m of seats) {
      if (!buildStudioCaps(m.role as StudioRole, m.capabilityOverrides).has("songs.edit")) continue;
      const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", m.orgId)).first();
      if (!org) continue;
      const tier = await tierForOrg(ctx, org.orgId);
      out.push({
        orgId: org.orgId,
        name: org.name,
        memberId: m._id,
        role: m.role,
        planLabel: PLAN_LIMITS[tier].label,
        eligible: await orgHasFeature(ctx, org.orgId, "catalogImport"),
        active: org.orgId === activeOrgId,
      });
    }
    return out.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  },
});

/** Find the person: a pasted Spotify / Apple Music / TIDAL artist link, or a
 *  name searched across MusicBrainz, Genius and Deezer. Nothing is stored. */
export const searchIdentity = action({
  args: { query: v.string() },
  handler: async (ctx, { query: raw }): Promise<{ name: string | null; needsName: boolean; candidates: IdentityCandidate[] }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in first." });
    const text = raw.trim().slice(0, 300);
    if (!text) return { name: null, needsName: false, candidates: [] };
    const link = parseArtistLink(text);
    if (link) {
      const { name, direct } = await resolveArtistLink(link);
      if (!name) return { name: null, needsName: true, candidates: direct ? [direct] : [] };
      const found = await searchIdentities(name);
      return { name, needsName: false, candidates: direct ? [direct, ...found] : found };
    }
    if (/^https?:\/\//i.test(text)) {
      throw new ConvexError({ code: "BAD_LINK", message: "Paste an artist page from Spotify, Apple Music or TIDAL, or type a name." });
    }
    return { name: text, needsName: false, candidates: await searchIdentities(text) };
  },
});

/** Start an import. A Member imports their own credits into a workspace they
 *  pick; an owner or manager imports a Roster Artist into this studio. */
export const start = mutation({
  args: {
    destinationOrgId: v.string(),
    subject: v.union(
      v.object({ kind: v.literal("member") }),
      v.object({ kind: v.literal("artist"), artistId: v.id("artists") }),
    ),
    roles: v.array(roleV),
    identities: v.array(identityArgV),
  },
  handler: async (ctx, { destinationOrgId, subject, roles, identities }) => {
    const clerkUserId = await callerId(ctx);
    const seat = await seatIn(ctx, destinationOrgId, clerkUserId);
    if (!seat) throw new ConvexError({ code: "SCOPE_DENIED", message: "You can't add songs to that workspace." });
    // The destination's own plan pays for the import.
    await requireFeature(ctx, destinationOrgId, "catalogImport");

    const chosen = [...new Set(roles)].filter((r) => (CREDIT_ROLES as readonly string[]).includes(r));
    if (chosen.length === 0) throw new ConvexError({ code: "BAD_REQUEST", message: "Pick at least one role." });
    if (identities.length === 0 || identities.length > 4) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Pick between one and four identities." });
    }

    let subjectId: string;
    let subjectName: string;
    if (subject.kind === "member") {
      subjectId = seat._id;
      subjectName = seat.name;
    } else {
      if (seat.role !== "owner" && seat.role !== "manager") {
        throw new ConvexError({ code: "CAPABILITY_DENIED", message: "Only an owner or manager can import an artist's catalog." });
      }
      const artist = await ctx.db.get(subject.artistId);
      if (!artist || artist.orgId !== destinationOrgId || !isClient(artist)) {
        throw new ConvexError({ code: "NOT_FOUND", message: "Artist not found in that workspace." });
      }
      subjectId = artist._id;
      subjectName = artist.name;
    }

    const running = await ctx.db
      .query("catalogImports")
      .withIndex("by_org_subject", (q) => q.eq("orgId", destinationOrgId).eq("subjectKind", subject.kind).eq("subjectId", subjectId))
      .order("desc")
      .first();
    if (running && (running.status === "discovering" || running.status === "importing")) {
      throw new ConvexError({ code: "IMPORT_RUNNING", message: "An import for this person is already running." });
    }

    // Identities are stored per workspace, never shared across workspaces.
    const existing = await ctx.db
      .query("creditIdentities")
      .withIndex("by_org_subject", (q) => q.eq("orgId", destinationOrgId).eq("subjectKind", subject.kind).eq("subjectId", subjectId))
      .collect();
    const identityIds: Id<"creditIdentities">[] = [];
    for (const i of identities) {
      const hit = existing.find((e) => e.source === i.source && e.sourceId === i.sourceId);
      identityIds.push(
        hit?._id ??
          (await ctx.db.insert("creditIdentities", {
            orgId: destinationOrgId,
            subjectKind: subject.kind,
            subjectId,
            source: i.source,
            sourceId: i.sourceId.slice(0, 80),
            name: i.name.slice(0, 200),
            imageUrl: i.imageUrl?.startsWith("https://") ? i.imageUrl.slice(0, 500) : undefined,
            createdAt: Date.now(),
          })),
      );
    }

    const importId = await ctx.db.insert("catalogImports", {
      orgId: destinationOrgId,
      subjectKind: subject.kind,
      subjectId,
      identityIds,
      roles: chosen,
      status: "discovering",
      found: 0, imported: 0, merged: 0, failed: 0, skipped: 0, capped: 0,
      startedBy: clerkUserId,
      startedByName: subjectName,
      startedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.catalogImport.runDiscovery, { importId });
    return { importId };
  },
});

/** One import's progress, for anyone with a seat in its workspace. */
export const get = query({
  args: { importId: v.id("catalogImports") },
  handler: async (ctx, { importId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) return null;
    const job = await ctx.db.get(importId);
    if (!job) return null;
    const member = await ctx.db
      .query("members")
      .withIndex("by_org_clerk", (q) => q.eq("orgId", job.orgId).eq("clerkUserId", identity.subject))
      .first();
    if (!member) return null;
    const identities = (await Promise.all(job.identityIds.map((id) => ctx.db.get(id)))).filter(Boolean);
    return {
      _id: job._id,
      status: job.status,
      roles: job.roles,
      found: job.found,
      imported: job.imported,
      merged: job.merged,
      failed: job.failed,
      skipped: job.skipped,
      capped: job.capped,
      done: job.imported + job.merged + job.failed + job.skipped,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt ?? null,
      error: job.error ?? null,
      identities: identities.map((i) => ({ source: i!.source, name: i!.name })),
    };
  },
});

/** The latest import for a subject in the caller's current workspace. */
export const latest = query({
  args: { subject: v.union(v.object({ kind: v.literal("member") }), v.object({ kind: v.literal("artist"), artistId: v.id("artists") })) },
  handler: async (ctx, { subject }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) return null;
    const seats = await ctx.db.query("members").withIndex("by_clerk", (q) => q.eq("clerkUserId", identity.subject)).collect();
    let best: Doc<"catalogImports"> | null = null;
    for (const seat of seats) {
      const subjectId = subject.kind === "member" ? seat._id : subject.artistId;
      const row = await ctx.db
        .query("catalogImports")
        .withIndex("by_org_subject", (q) => q.eq("orgId", seat.orgId).eq("subjectKind", subject.kind).eq("subjectId", subjectId))
        .order("desc")
        .first();
      if (row && (!best || row.startedAt > best.startedAt)) best = row;
    }
    return best ? { importId: best._id, status: best.status, orgId: best.orgId } : null;
  },
});

/* ── The job ─────────────────────────────────────────────── */

export const _job = internalQuery({
  args: { importId: v.id("catalogImports") },
  handler: async (ctx, { importId }) => {
    const job = await ctx.db.get(importId);
    if (!job) return null;
    const identities = (await Promise.all(job.identityIds.map((id) => ctx.db.get(id)))).filter(Boolean) as Doc<"creditIdentities">[];
    return { job, identities };
  },
});

const refsV = v.object({
  deezerTrackId: v.optional(v.number()),
  mbRecordingId: v.optional(v.string()),
  mbWorkId: v.optional(v.string()),
  geniusSongId: v.optional(v.number()),
  appleTrackId: v.optional(v.number()),
});
const itemV = v.object({
  title: v.string(),
  artistName: v.optional(v.string()),
  isrc: v.optional(v.string()),
  album: v.optional(v.string()),
  releaseDate: v.optional(v.number()),
  coverUrl: v.optional(v.string()),
  roles: v.array(v.string()),
  sources: v.array(v.string()),
  refs: refsV,
});

export const _addItems = internalMutation({
  args: { importId: v.id("catalogImports"), items: v.array(itemV) },
  handler: async (ctx, { importId, items }) => {
    const job = await ctx.db.get(importId);
    if (!job) return;
    for (const i of items) {
      await ctx.db.insert("catalogImportItems", { ...i, orgId: job.orgId, importId, state: "pending" });
    }
  },
});

export const _setStatus = internalMutation({
  args: {
    importId: v.id("catalogImports"),
    status: v.union(v.literal("importing"), v.literal("done"), v.literal("failed")),
    found: v.optional(v.number()),
    capped: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { importId, status, found, capped, error }) => {
    const job = await ctx.db.get(importId);
    if (!job) return;
    await ctx.db.patch(importId, {
      status,
      ...(found !== undefined ? { found } : {}),
      ...(capped !== undefined ? { capped } : {}),
      ...(error ? { error } : {}),
      ...(status !== "importing" ? { finishedAt: Date.now() } : {}),
    });
    if (status === "done") {
      await ctx.db.insert("activity", {
        orgId: job.orgId,
        kind: "catalog.imported",
        summary: `Catalog import for ${job.startedByName ?? "a teammate"}: ${job.imported} new songs, ${job.merged} matched to existing songs${job.capped ? `, ${job.capped} left out by the 500-song limit` : ""}`,
        entityType: job.subjectKind === "artist" ? "artist" : "member",
        entityId: job.subjectId,
        accent: "info",
      });
    }
  },
});

export const runDiscovery = internalAction({
  args: { importId: v.id("catalogImports") },
  handler: async (ctx, { importId }) => {
    const loaded = await ctx.runQuery(internal.catalogImport._job, { importId });
    if (!loaded) return;
    try {
      const raw: Candidate[] = [];
      for (const identity of loaded.identities) {
        raw.push(...(await discover(identity, loaded.job.roles)));
      }
      // Genius first in the merge: its lists come ordered by popularity.
      raw.sort((a, b) => Number(b.sources.includes("genius")) - Number(a.sources.includes("genius")));
      const { items, capped } = mergeCandidates(raw);
      for (let i = 0; i < items.length; i += 100) {
        await ctx.runMutation(internal.catalogImport._addItems, { importId, items: items.slice(i, i + 100) });
      }
      await ctx.runMutation(internal.catalogImport._setStatus, { importId, status: "importing", found: items.length, capped });
      if (items.length === 0) {
        await ctx.runMutation(internal.catalogImport._setStatus, { importId, status: "done" });
        return;
      }
      await ctx.scheduler.runAfter(0, internal.catalogImport.runBatch, { importId });
    } catch (err) {
      await ctx.runMutation(internal.catalogImport._setStatus, {
        importId,
        status: "failed",
        error: err instanceof Error ? err.message.slice(0, 300) : "Discovery failed",
      });
    }
  },
});

export const _nextPending = internalQuery({
  args: { importId: v.id("catalogImports"), limit: v.number() },
  handler: async (ctx, { importId, limit }) =>
    ctx.db
      .query("catalogImportItems")
      .withIndex("by_import_state", (q) => q.eq("importId", importId).eq("state", "pending"))
      .take(limit),
});

export const runBatch = internalAction({
  args: { importId: v.id("catalogImports") },
  handler: async (ctx, { importId }) => {
    const loaded = await ctx.runQuery(internal.catalogImport._job, { importId });
    if (!loaded || loaded.job.status !== "importing") return;
    const items = await ctx.runQuery(internal.catalogImport._nextPending, { importId, limit: BATCH });
    if (items.length === 0) {
      await ctx.runMutation(internal.catalogImport._setStatus, { importId, status: "done" });
      return;
    }
    const geniusIds = loaded.identities.filter((i) => i.source === "genius").map((i) => Number(i.sourceId)).filter(Number.isFinite);
    for (const item of items) {
      let outcome: EnrichOutcome;
      try {
        outcome = await enrichItem(item, loaded.job.roles, geniusIds);
      } catch (err) {
        outcome = { kind: "fail", reason: err instanceof Error ? err.message.slice(0, 200) : "Lookup failed" };
      }
      const coverStorageId =
        outcome.kind === "ok" ? await storeCover(ctx, loaded.job.orgId, outcome.song.coverUrl ?? null) : null;
      await ctx.runMutation(internal.catalogImport._applyItem, {
        importId,
        itemId: item._id,
        outcome: outcome.kind === "ok" ? { kind: "ok", song: { ...outcome.song } } : outcome,
        coverStorageId: coverStorageId ?? undefined,
      });
    }
    await ctx.scheduler.runAfter(0, internal.catalogImport.runBatch, { importId });
  },
});

const creditV = v.object({ name: v.string(), role: v.string() });
const outcomeV = v.union(
  v.object({
    kind: v.literal("ok"),
    song: v.object({
      title: v.string(),
      artistName: v.string(),
      isrc: v.optional(v.string()),
      iswc: v.optional(v.string()),
      bpm: v.optional(v.number()),
      genre: v.optional(v.string()),
      album: v.optional(v.string()),
      releaseDate: v.optional(v.number()),
      coverUrl: v.optional(v.string()),
      roles: v.array(v.string()),
      credits: v.array(creditV),
    }),
  }),
  v.object({ kind: v.literal("skip"), reason: v.string() }),
  v.object({ kind: v.literal("fail"), reason: v.string() }),
);

/** The song's artist row: the roster artist being imported when it is them,
 *  an existing row with that name, else a catalog-only artist (not a client). */
async function artistFor(ctx: MutationCtx, job: Doc<"catalogImports">, name: string): Promise<Id<"artists">> {
  const main = primaryArtist(name) ?? name;
  const key = artistKey(main);
  if (job.subjectKind === "artist") {
    const subject = await ctx.db.get(job.subjectId as Id<"artists">);
    if (subject && artistKey(subject.name) === key) return subject._id;
  }
  const hits = await ctx.db
    .query("artists")
    .withSearchIndex("search_name", (q) => q.search("name", main).eq("orgId", job.orgId))
    .take(10);
  const same = hits.find((a) => artistKey(a.name) === key && !a.erasedAt);
  if (same) return same._id;
  return ctx.db.insert("artists", {
    orgId: job.orgId,
    name: main.slice(0, 200),
    type: "artist",
    genres: [],
    tags: [],
    status: "dormant",
    lifetimeValueCents: 0,
    sessionCount: 0,
    reliability: "solid",
    source: "catalog_import",
    catalogOnly: true,
  });
}

/** An existing Song this recording already is: same ISRC, else same cleaned
 *  title by the same primary artist. */
async function existingSong(ctx: MutationCtx, orgId: string, title: string, artistName: string, isrc?: string) {
  if (isrc) {
    const byIsrc = await ctx.db.query("songs").withIndex("by_org_isrc", (q) => q.eq("orgId", orgId).eq("isrc", isrc)).first();
    if (byIsrc) return byIsrc;
  }
  const want = titleKey(title);
  const who = artistKey(primaryArtist(artistName) ?? artistName);
  const hits = await ctx.db
    .query("songs")
    .withSearchIndex("search_title", (q) => q.search("title", title).eq("orgId", orgId))
    .take(20);
  for (const s of hits) {
    if (titleKey(s.title) !== want) continue;
    const a = await ctx.db.get(s.artistId);
    if (a && artistKey(a.name) === who) return s;
  }
  return null;
}

export const _applyItem = internalMutation({
  args: {
    importId: v.id("catalogImports"),
    itemId: v.id("catalogImportItems"),
    outcome: outcomeV,
    coverStorageId: v.optional(fileRefV),
  },
  handler: async (ctx, { importId, itemId, outcome, coverStorageId }) => {
    const job = await ctx.db.get(importId);
    const item = await ctx.db.get(itemId);
    if (!job || !item || item.importId !== importId || item.state !== "pending") return;

    if (outcome.kind !== "ok") {
      await ctx.db.patch(itemId, { state: outcome.kind === "skip" ? "skipped" : "failed", error: outcome.reason });
      await ctx.db.patch(importId, outcome.kind === "skip" ? { skipped: job.skipped + 1 } : { failed: job.failed + 1 });
      return;
    }

    const s = outcome.song;
    const memberId = job.subjectKind === "member" ? (job.subjectId as Id<"members">) : undefined;
    let song = await existingSong(ctx, job.orgId, s.title, s.artistName, s.isrc);
    const merged = Boolean(song);
    if (!song) {
      const artistId = await artistFor(ctx, job, s.artistName);
      const songId = await ctx.db.insert("songs", {
        orgId: job.orgId,
        title: s.title,
        artistId,
        kind: "single",
        stage: "released",
        moodTags: [],
        referenceTracks: [],
        revisionsIncluded: 0,
        revisionsUsed: 0,
        importedAt: Date.now(),
        importedFrom: { importId, identityId: job.identityIds[0], source: item.sources[0] ?? "catalog" },
        ...(memberId ? { creditedMembers: [memberId] } : {}),
      });
      song = (await ctx.db.get(songId))!;
    } else if (memberId && !(song.creditedMembers ?? []).includes(memberId)) {
      await ctx.db.patch(song._id, { creditedMembers: [...(song.creditedMembers ?? []), memberId] });
      song = (await ctx.db.get(song._id))!;
    }

    await fillSongFromImport(ctx, job.orgId, song, {
      coverStorageId,
      replaceCover: false,
      genre: s.genre,
      releaseDate: s.releaseDate,
      isrc: s.isrc,
      iswc: s.iswc,
      bpm: s.bpm,
      artistName: primaryArtist(s.artistName) ?? s.artistName,
      credits: s.credits,
    });

    // A Member's credits stay internal until an owner or manager approves them.
    if (memberId) {
      const have = await ctx.db
        .query("importedCredits")
        .withIndex("by_member_song", (q) => q.eq("memberId", memberId).eq("songId", song!._id))
        .collect();
      for (const role of s.roles.filter((r) => job.roles.includes(r))) {
        if (have.some((h) => h.role === role)) continue;
        await ctx.db.insert("importedCredits", {
          orgId: job.orgId,
          memberId,
          songId: song._id,
          role,
          source: item.sources[0] ?? "catalog",
          approved: false,
          createdAt: Date.now(),
        });
      }
    }

    await ctx.db.patch(itemId, { state: merged ? "merged" : "imported", songId: song._id });
    await ctx.db.patch(importId, merged ? { merged: job.merged + 1 } : { imported: job.imported + 1 });
  },
});

/** Restart a chain that stopped (a crashed batch leaves pending items). */
export const resume = mutation({
  args: { importId: v.id("catalogImports") },
  handler: async (ctx, { importId }) => {
    const clerkUserId = await callerId(ctx);
    const job = await ctx.db.get(importId);
    if (!job || !(await seatIn(ctx, job.orgId, clerkUserId))) throw new ConvexError({ code: "NOT_FOUND", message: "Import not found." });
    if (job.status !== "importing") return { resumed: false };
    await ctx.scheduler.runAfter(0, internal.catalogImport.runBatch, { importId });
    return { resumed: true };
  },
});
