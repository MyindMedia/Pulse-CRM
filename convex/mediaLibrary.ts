import { query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { currentActor, currentOrg, currentOrgWithCapability } from "./lib/tenant";
import { requireCapability, resolveViewer, AccessError } from "./lib/access";
import type { AgencyViewer } from "./lib/accessTypes";
import { migrateTierValue } from "./lib/legacyPlans";
import { fileUrl, claimFile, deleteFile } from "./lib/media";
import { createUpload } from "./media";
import { assertWithinLimit, meterStorageUpload, recordUsage, tierForOrg } from "./usage";
import { orgGate } from "./lib/tier";
import { capabilitiesForTier, upgradeError } from "./lib/entitlements";
import { PLAN_LIMITS } from "./lib/plans";
import { GUEST_SCOPE_DEFAULT_TTL_MS } from "./lib/accessPolicies";
import { approvalV, mediaKindV, MEDIA_KINDS } from "./mediaLibraryTables";

/* ============================================================
   Media library: one searchable place for sessions, stems, mixes,
   masters, artwork and deliverables. Every upload is a numbered version
   with notes, client approval and a who/when trail.

   Storage: every file goes through the R2 helpers (lib/media.ts). The
   browser PUTs to a presigned URL in the studio's own private bucket,
   media.confirmUpload checks what arrived, and addVersion attaches it.
   Bytes never touch Convex. Downloads are short-lived signed URLs.

   Gating: Growth ("mediaLibrary"). The cross-studio view is Max
   ("sharedMediaLibrary"), is for the agency admin only (agency.viewAll, like
   projects.crossStudio) and only reaches studios inside that agency, inside
   the admin's staff scope, that opted in (orgs.shareMediaWithGroup). Studio
   staff never see another studio's files. The org always comes from the
   signed-in viewer, never from an argument. Permissions reuse the deliverables.* capabilities, with the
   library's own entitlement passed in place of Core's "finishedMixes".
   ============================================================ */

type Reader = QueryCtx | MutationCtx;

const LIB = { entitlement: "mediaLibrary" } as const;
const MAX_NOTE = 2000;
const MAX_TAGS = 20;
const MAX_GUEST_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Org of a signed-in studio user holding `cap`, with the Growth library entitlement.
 *  A guest-link viewer is refused: guests use the token functions below. */
async function libOrg(ctx: Reader, cap: "deliverables.read" | "deliverables.upload" | "deliverables.approve"): Promise<string> {
  const viewer = await resolveViewer(ctx);
  if (viewer.kind === "guest") throw new ConvexError("Only studio staff can use the media library.");
  return await currentOrgWithCapability(ctx, cap, undefined, LIB);
}

async function actorName(ctx: Reader): Promise<string> {
  return await currentActor(ctx);
}

export const cleanTags = (tags: string[] | undefined): string[] => {
  const out = new Set<string>();
  for (const t of tags ?? []) {
    const c = t.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32);
    if (c) out.add(c);
    if (out.size >= MAX_TAGS) break;
  }
  return [...out];
};

export function buildSearchText(parts: { name: string; tags: string[]; kind: string; songTitle?: string; sessionTitle?: string }): string {
  return [parts.name, parts.kind, parts.tags.join(" "), parts.songTitle ?? "", parts.sessionTitle ?? ""].join(" ").toLowerCase();
}

async function titlesFor(ctx: Reader, orgId: string, songId?: Id<"songs">, sessionId?: Id<"sessions">) {
  let songTitle: string | undefined;
  let sessionTitle: string | undefined;
  if (songId) {
    const s = await ctx.db.get(songId);
    if (!s || s.orgId !== orgId) throw new ConvexError("Song not found.");
    songTitle = s.title;
  }
  if (sessionId) {
    const s = await ctx.db.get(sessionId);
    if (!s || s.orgId !== orgId) throw new ConvexError("Session not found.");
    sessionTitle = s.title;
  }
  return { songTitle, sessionTitle };
}

async function logEvent(ctx: MutationCtx, orgId: string, assetId: Id<"mediaAssets">, action: string, actor: string, version?: number, detail?: string) {
  await ctx.db.insert("mediaEvents", { orgId, assetId, version, action, actor, detail, createdAt: Date.now() });
}

async function ownAsset(ctx: Reader, orgId: string, id: Id<"mediaAssets">): Promise<Doc<"mediaAssets">> {
  const a = await ctx.db.get(id);
  if (!a || a.orgId !== orgId) throw new ConvexError("File not found.");
  return a;
}

async function ownVersion(ctx: Reader, orgId: string, id: Id<"mediaVersions">): Promise<Doc<"mediaVersions">> {
  const r = await ctx.db.get(id);
  if (!r || r.orgId !== orgId) throw new ConvexError("Version not found.");
  return r;
}

/** What this studio's screens may show, without throwing. The pages call it first
 *  so a locked screen renders the locked state instead of an error. */
export const access = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await resolveViewer(ctx);
    if (viewer.kind === "guest") return { mixes: false, library: false, shared: false };
    const orgId = await currentOrg(ctx);
    const { tier, disabled } = await orgGate(ctx, orgId);
    const caps = capabilitiesForTier(tier);
    const on = (k: "finishedMixes" | "mediaLibrary" | "sharedMediaLibrary") => caps.has(k) && !disabled.has(k);
    // The all-studios view is the agency admin's (see sharedViewer below).
    const groupAdmin = viewer.kind === "agency_member" && viewer.capabilities.has("agency.viewAll");
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return {
      mixes: on("finishedMixes"),
      library: on("mediaLibrary"),
      shared: groupAdmin && on("mediaLibrary") && on("sharedMediaLibrary"),
      sharingWithGroup: org?.shareMediaWithGroup === true,
    };
  },
});

/* ── Upload ─────────────────────────────────────────────────── */

/** Step 1: a one-time signed PUT URL into the studio's private bucket. Checks the
 *  declared size against the plan's storage allowance first, so an over-cap file
 *  is refused before any bytes move. */
export const prepareUpload = mutation({
  args: { fileName: v.string(), mimeType: v.string(), size: v.number() },
  handler: async (ctx, a) => {
    const orgId = await libOrg(ctx, "deliverables.upload");
    await assertWithinLimit(ctx, orgId, "storage_bytes", Math.max(0, a.size));
    const viewer = await resolveViewer(ctx);
    const actor = "clerkUserId" in viewer ? String(viewer.clerkUserId) : viewer.kind;
    return await createUpload(ctx, { scope: orgId, purpose: "deliverable", fileName: a.fileName, mimeType: a.mimeType, size: a.size, actor });
  },
});

/** Step 3 (after media.confirmUpload): attach the confirmed file as a new numbered
 *  version. Pass `assetId` to add a version to an existing file, or `name` + `kind`
 *  to start a new one at version 1. */
export const addVersion = mutation({
  args: {
    mediaId: v.id("mediaFiles"),
    assetId: v.optional(v.id("mediaAssets")),
    name: v.optional(v.string()),
    kind: v.optional(mediaKindV),
    tags: v.optional(v.array(v.string())),
    songId: v.optional(v.id("songs")),
    sessionId: v.optional(v.id("sessions")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<{ assetId: Id<"mediaAssets">; versionId: Id<"mediaVersions">; version: number }> => {
    const orgId = await libOrg(ctx, "deliverables.upload");
    const actor = await actorName(ctx);
    const m = await ctx.db.get(a.mediaId);
    if (!m || m.orgId !== orgId || m.purpose !== "deliverable") throw new ConvexError("Upload not found.");
    if (m.status !== "ready") throw new ConvexError("The upload has not finished.");
    const used = await ctx.db.query("mediaVersions").withIndex("by_media", (q) => q.eq("mediaId", a.mediaId)).first();
    if (used) throw new ConvexError("That upload is already a version.");
    if (a.note && a.note.length > MAX_NOTE) throw new ConvexError("That note is too long.");

    // Real size against the plan's storage allowance. Throws LIMIT_REACHED, which
    // rolls everything in this mutation back.
    await meterStorageUpload(ctx, orgId, a.mediaId, null);
    await claimFile(ctx, a.mediaId, orgId);

    const now = Date.now();
    const size = m.size ?? 0;
    let asset: Doc<"mediaAssets">;
    if (a.assetId) {
      asset = await ownAsset(ctx, orgId, a.assetId);
    } else {
      const name = (a.name ?? "").trim() || m.fileName;
      const kind = a.kind ?? "other";
      if (!MEDIA_KINDS.includes(kind)) throw new ConvexError("Unknown kind.");
      const tags = cleanTags(a.tags);
      const t = await titlesFor(ctx, orgId, a.songId, a.sessionId);
      const id = await ctx.db.insert("mediaAssets", {
        orgId, name: name.slice(0, 160), kind, tags, songId: a.songId, sessionId: a.sessionId,
        currentVersion: 0, versionCount: 0, totalBytes: 0,
        searchText: buildSearchText({ name, tags, kind, ...t }),
        createdBy: actor, createdAt: now, updatedAt: now,
      });
      asset = (await ctx.db.get(id))!;
    }
    const version = asset.currentVersion + 1;
    const versionId = await ctx.db.insert("mediaVersions", {
      orgId, assetId: asset._id, version, mediaId: a.mediaId, fileName: m.fileName, size, mimeType: m.mimeType,
      note: a.note?.trim() || undefined, approval: "pending", uploadedBy: actor, uploadedAt: now,
    });
    await ctx.db.patch(asset._id, { currentVersion: version, versionCount: asset.versionCount + 1, totalBytes: asset.totalBytes + size, updatedAt: now });
    await logEvent(ctx, orgId, asset._id, "upload", actor, version, m.fileName);
    return { assetId: asset._id, versionId, version };
  },
});

/** Restore an older version by making it the newest one. History is never
 *  rewritten: the old number stays, and the new row records `restoredFrom`. The
 *  new version reuses the old file, so no extra storage is used. */
export const restoreVersion = mutation({
  args: { versionId: v.id("mediaVersions"), note: v.optional(v.string()) },
  handler: async (ctx, { versionId, note }) => {
    const orgId = await libOrg(ctx, "deliverables.upload");
    const actor = await actorName(ctx);
    const old = await ownVersion(ctx, orgId, versionId);
    const asset = await ownAsset(ctx, orgId, old.assetId);
    const now = Date.now();
    const version = asset.currentVersion + 1;
    const id = await ctx.db.insert("mediaVersions", {
      orgId, assetId: asset._id, version, mediaId: old.mediaId, fileName: old.fileName, size: old.size, mimeType: old.mimeType,
      note: note?.trim() || `Restored from version ${old.version}`, approval: "pending", restoredFrom: old.version, uploadedBy: actor, uploadedAt: now,
    });
    await ctx.db.patch(asset._id, { currentVersion: version, versionCount: asset.versionCount + 1, updatedAt: now });
    await logEvent(ctx, orgId, asset._id, "restore", actor, version, `from version ${old.version}`);
    return { versionId: id, version };
  },
});

/* ── Notes, approval, details ───────────────────────────────── */

export const addNote = mutation({
  args: { versionId: v.id("mediaVersions"), body: v.string() },
  handler: async (ctx, { versionId, body }) => {
    const orgId = await libOrg(ctx, "deliverables.upload");
    const ver = await ownVersion(ctx, orgId, versionId);
    const text = body.trim();
    if (!text) throw new ConvexError("Write a note first.");
    if (text.length > MAX_NOTE) throw new ConvexError("That note is too long.");
    const author = await actorName(ctx);
    const id = await ctx.db.insert("mediaNotes", { orgId, versionId, body: text, author, createdAt: Date.now() });
    await logEvent(ctx, orgId, ver.assetId, "note", author, ver.version);
    return id;
  },
});

/** Client approval state on one version. Staff set it here; a client sets it
 *  through a guest link (guestSetApproval). */
export const setApproval = mutation({
  args: { versionId: v.id("mediaVersions"), state: approvalV, note: v.optional(v.string()), approvedBy: v.optional(v.string()) },
  handler: async (ctx, { versionId, state, note, approvedBy }) => {
    const orgId = await libOrg(ctx, "deliverables.approve");
    const actor = await actorName(ctx);
    const ver = await ownVersion(ctx, orgId, versionId);
    const decided = state !== "pending";
    await ctx.db.patch(versionId, {
      approval: state,
      approvedBy: decided ? (approvedBy?.trim() || actor) : undefined,
      approvedAt: decided ? Date.now() : undefined,
      approvalNote: decided ? note?.trim().slice(0, MAX_NOTE) || undefined : undefined,
    });
    await logEvent(ctx, orgId, ver.assetId, state, actor, ver.version, note?.trim().slice(0, 200));
    return null;
  },
});

export const updateAsset = mutation({
  args: {
    assetId: v.id("mediaAssets"),
    name: v.optional(v.string()),
    kind: v.optional(mediaKindV),
    tags: v.optional(v.array(v.string())),
    songId: v.optional(v.union(v.id("songs"), v.null())),
    sessionId: v.optional(v.union(v.id("sessions"), v.null())),
  },
  handler: async (ctx, a) => {
    const orgId = await libOrg(ctx, "deliverables.upload");
    const actor = await actorName(ctx);
    const asset = await ownAsset(ctx, orgId, a.assetId);
    const songId = a.songId === undefined ? asset.songId : a.songId ?? undefined;
    const sessionId = a.sessionId === undefined ? asset.sessionId : a.sessionId ?? undefined;
    const name = a.name === undefined ? asset.name : a.name.trim().slice(0, 160) || asset.name;
    const kind = a.kind ?? asset.kind;
    const tags = a.tags === undefined ? asset.tags : cleanTags(a.tags);
    const t = await titlesFor(ctx, orgId, songId, sessionId);
    await ctx.db.patch(asset._id, { name, kind, tags, songId, sessionId, searchText: buildSearchText({ name, tags, kind, ...t }), updatedAt: Date.now() });
    await logEvent(ctx, orgId, asset._id, "edit", actor);
    return null;
  },
});

/** Delete a file and every version of it. Each distinct R2 object is removed and
 *  its bytes are returned to the storage allowance. */
export const deleteAsset = mutation({
  args: { assetId: v.id("mediaAssets") },
  handler: async (ctx, { assetId }) => {
    const orgId = await libOrg(ctx, "deliverables.upload");
    const asset = await ownAsset(ctx, orgId, assetId);
    const versions = await ctx.db.query("mediaVersions").withIndex("by_asset", (q) => q.eq("assetId", assetId)).collect();
    const files = new Map<Id<"mediaFiles">, number>();
    for (const ver of versions) files.set(ver.mediaId, ver.size);
    let freed = 0;
    for (const [mediaId, size] of files) {
      freed += size;
      await deleteFile(ctx, mediaId);
    }
    for (const ver of versions) {
      const notes = await ctx.db.query("mediaNotes").withIndex("by_version", (q) => q.eq("versionId", ver._id)).collect();
      for (const n of notes) await ctx.db.delete(n._id);
      await ctx.db.delete(ver._id);
    }
    const events = await ctx.db.query("mediaEvents").withIndex("by_asset", (q) => q.eq("assetId", assetId)).collect();
    for (const e of events) await ctx.db.delete(e._id);
    await ctx.db.delete(asset._id);
    if (freed > 0) await recordUsage(ctx, orgId, "storage_bytes", -freed);
    return null;
  },
});

/* ── Reads ──────────────────────────────────────────────────── */

export const search = query({
  args: {
    q: v.optional(v.string()),
    kind: v.optional(mediaKindV),
    tag: v.optional(v.string()),
    songId: v.optional(v.id("songs")),
    sessionId: v.optional(v.id("sessions")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const orgId = await libOrg(ctx, "deliverables.read");
    return await runSearch(ctx, [orgId], a);
  },
});

type SearchArgs = { q?: string; kind?: Doc<"mediaAssets">["kind"]; tag?: string; songId?: Id<"songs">; sessionId?: Id<"sessions">; limit?: number };

/** Search across one or more studios (the caller has already proven access to each). */
async function runSearch(ctx: QueryCtx, orgIds: string[], a: SearchArgs) {
  const limit = Math.min(Math.max(a.limit ?? 60, 1), 200);
  const q = a.q?.trim().toLowerCase();
  const tag = a.tag?.trim().toLowerCase();
  const out: Doc<"mediaAssets">[] = [];
  for (const orgId of orgIds) {
    let rows: Doc<"mediaAssets">[];
    if (q) {
      rows = await ctx.db
        .query("mediaAssets")
        .withSearchIndex("search_text", (s) => {
          const base = s.search("searchText", q).eq("orgId", orgId);
          return a.kind ? base.eq("kind", a.kind) : base;
        })
        .take(limit);
      // Partial words: the search index matches whole words, so also keep any asset whose text contains the query.
      if (rows.length < limit) {
        const recent = await ctx.db.query("mediaAssets").withIndex("by_org", (x) => x.eq("orgId", orgId)).order("desc").take(400);
        const have = new Set(rows.map((r) => r._id));
        for (const r of recent) if (!have.has(r._id) && r.searchText.includes(q) && (!a.kind || r.kind === a.kind)) rows.push(r);
      }
    } else if (a.songId) {
      rows = await ctx.db.query("mediaAssets").withIndex("by_org_song", (x) => x.eq("orgId", orgId).eq("songId", a.songId)).take(400);
    } else if (a.sessionId) {
      rows = await ctx.db.query("mediaAssets").withIndex("by_org_session", (x) => x.eq("orgId", orgId).eq("sessionId", a.sessionId)).take(400);
    } else {
      rows = await ctx.db.query("mediaAssets").withIndex("by_org", (x) => x.eq("orgId", orgId)).order("desc").take(400);
    }
    for (const r of rows) {
      if (r.orgId !== orgId) continue; // belt and braces: never return another studio's row
      if (a.kind && r.kind !== a.kind) continue;
      if (a.songId && r.songId !== a.songId) continue;
      if (a.sessionId && r.sessionId !== a.sessionId) continue;
      if (tag && !r.tags.includes(tag)) continue;
      out.push(r);
    }
  }
  out.sort((x, y) => y.updatedAt - x.updatedAt);
  return await Promise.all(
    out.slice(0, limit).map(async (r) => ({
      ...r,
      songTitle: r.songId ? (await ctx.db.get(r.songId))?.title ?? null : null,
      sessionTitle: r.sessionId ? (await ctx.db.get(r.sessionId))?.title ?? null : null,
    })),
  );
}

/** One file with its full history: versions (newest first) with notes, approval
 *  and who/when, plus the audit trail. */
export const detail = query({
  args: { assetId: v.id("mediaAssets") },
  handler: async (ctx, { assetId }) => {
    const orgId = await libOrg(ctx, "deliverables.read");
    const asset = await ownAsset(ctx, orgId, assetId);
    return await assetDetail(ctx, asset);
  },
});

async function assetDetail(ctx: QueryCtx, asset: Doc<"mediaAssets">) {
  const versions = await ctx.db.query("mediaVersions").withIndex("by_asset", (q) => q.eq("assetId", asset._id)).order("desc").collect();
  const withNotes = await Promise.all(
    versions.map(async (ver) => ({
      ...ver,
      notes: await ctx.db.query("mediaNotes").withIndex("by_version", (q) => q.eq("versionId", ver._id)).order("asc").collect(),
    })),
  );
  const events = await ctx.db.query("mediaEvents").withIndex("by_asset", (q) => q.eq("assetId", asset._id)).order("desc").take(100);
  return { asset, versions: withNotes, events };
}

/** Signed download URL for one version (an hour). Private bucket, studio-checked. */
export const downloadUrl = query({
  args: { versionId: v.id("mediaVersions") },
  handler: async (ctx, { versionId }) => {
    const orgId = await libOrg(ctx, "deliverables.read");
    const ver = await ownVersion(ctx, orgId, versionId);
    const url = await fileUrl(ctx, ver.mediaId, { expiresIn: 3600 });
    if (!url) throw new ConvexError("File is no longer available.");
    return { url, fileName: ver.fileName };
  },
});

/** Songs and sessions the library can tag a file to (titles only). */
export const linkChoices = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await libOrg(ctx, "deliverables.read");
    const songs = await ctx.db.query("songs").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(200);
    const sessions = await ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(200);
    return {
      songs: songs.map((s) => ({ _id: s._id, title: s.title })),
      sessions: sessions.map((s) => ({ _id: s._id, title: s.title })),
    };
  },
});

/** Storage used against this plan's allowance. */
export const storage = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await libOrg(ctx, "deliverables.read");
    const limits = PLAN_LIMITS[await tierForOrg(ctx, orgId)];
    const row = await ctx.db
      .query("usageCounters")
      .withIndex("by_org_period_metric", (q) => q.eq("orgId", orgId).eq("period", "all").eq("metric", "storage_bytes"))
      .first();
    return { usedBytes: row?.value ?? 0, capBytes: limits.storageGb * 1024 * 1024 * 1024, capGb: limits.storageGb };
  },
});

/* ── Guest links (reuse collaboratorGrants) ─────────────────── */

/** An expiring link to one file for someone without an account (a client or an
 *  outside mixer). It is a collaboratorGrants row, so it counts against the same
 *  monthly link allowance, expires the same way and is revoked with grants.revoke. */
export const issueGuestLink = mutation({
  args: {
    assetId: v.id("mediaAssets"),
    email: v.string(),
    name: v.string(),
    ttlMs: v.optional(v.number()),
    canApprove: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const viewer = await requireCapability(ctx, "grants.issue", { entitlement: "mediaLibrary" });
    const orgId = "orgId" in viewer ? viewer.orgId : undefined;
    if (!orgId) throw new ConvexError("Issuing a link needs an active studio.");
    const asset = await ownAsset(ctx, orgId, a.assetId);
    await assertWithinLimit(ctx, orgId, "magic_links", 1);
    const ttl = Math.min(Math.max(a.ttlMs ?? GUEST_SCOPE_DEFAULT_TTL_MS.deliverable, 60_000), MAX_GUEST_TTL_MS);
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const caps = a.canApprove === false ? ["deliverables.read"] : ["deliverables.read", "deliverables.approve"];
    const id = await ctx.db.insert("collaboratorGrants", {
      orgId,
      agencyId: "agencyId" in viewer ? viewer.agencyId : undefined,
      email: a.email.trim().toLowerCase(),
      name: a.name.trim() || a.email,
      scope: "deliverable",
      entityId: asset._id,
      capabilities: caps,
      token,
      expiresAt: Date.now() + ttl,
      invitedBy: "clerkUserId" in viewer ? viewer.clerkUserId : "system",
      useCount: 0,
    });
    await recordUsage(ctx, orgId, "magic_links", 1);
    await logEvent(ctx, orgId, asset._id, "guest_link", await actorName(ctx), undefined, a.email.trim().toLowerCase());
    return { grantId: id, token, expiresAt: Date.now() + ttl };
  },
});

export const guestLinks = query({
  args: { assetId: v.id("mediaAssets") },
  handler: async (ctx, { assetId }) => {
    const orgId = await libOrg(ctx, "deliverables.read");
    const asset = await ownAsset(ctx, orgId, assetId);
    const grants = await ctx.db.query("collaboratorGrants").withIndex("by_entity", (q) => q.eq("entityId", asset._id)).collect();
    const now = Date.now();
    return grants
      .filter((g) => g.orgId === orgId && g.scope === "deliverable")
      .map((g) => ({ _id: g._id, token: g.token, email: g.email, name: g.name, expiresAt: g.expiresAt, revoked: !!g.revoked, expired: g.expiresAt < now, canApprove: g.capabilities.includes("deliverables.approve"), useCount: g.useCount }));
  },
});

/** The grant behind a token, only while it is live and points at a library file. */
async function liveGrant(ctx: Reader, token: string) {
  const g = await ctx.db.query("collaboratorGrants").withIndex("by_token", (q) => q.eq("token", token)).first();
  if (!g || g.revoked || g.expiresAt < Date.now() || g.scope !== "deliverable") return null;
  const assetId = ctx.db.normalizeId("mediaAssets", g.entityId);
  if (!assetId) return null;
  const asset = await ctx.db.get(assetId);
  if (!asset || asset.orgId !== g.orgId) return null;
  return { grant: g, asset };
}

/** Public: what a guest link shows. Null when the link is expired, revoked or unknown. */
export const guestAsset = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const live = await liveGrant(ctx, token);
    if (!live) return null;
    const { grant, asset } = live;
    const versions = await ctx.db.query("mediaVersions").withIndex("by_asset", (q) => q.eq("assetId", asset._id)).order("desc").take(20);
    return {
      name: asset.name,
      kind: asset.kind,
      guestName: grant.name,
      expiresAt: grant.expiresAt,
      canApprove: grant.capabilities.includes("deliverables.approve"),
      versions: await Promise.all(
        versions.map(async (ver) => ({
          _id: ver._id,
          version: ver.version,
          fileName: ver.fileName,
          size: ver.size,
          uploadedAt: ver.uploadedAt,
          note: ver.note ?? null,
          approval: ver.approval,
          url: await fileUrl(ctx, ver.mediaId, { expiresIn: 3600 }),
        })),
      ),
    };
  },
});

/** Public: a client approves or asks for changes on one version through their link. */
export const guestSetApproval = mutation({
  args: { token: v.string(), versionId: v.id("mediaVersions"), state: v.union(v.literal("approved"), v.literal("changes_requested")), note: v.optional(v.string()) },
  handler: async (ctx, { token, versionId, state, note }) => {
    const live = await liveGrant(ctx, token);
    if (!live) throw new ConvexError("This link has expired.");
    const { grant, asset } = live;
    if (!grant.capabilities.includes("deliverables.approve")) throw new ConvexError("This link can view the file but not approve it.");
    const ver = await ctx.db.get(versionId);
    if (!ver || ver.assetId !== asset._id || ver.orgId !== grant.orgId) throw new ConvexError("Version not found.");
    await ctx.db.patch(versionId, { approval: state, approvedBy: grant.name, approvedAt: Date.now(), approvalNote: note?.trim().slice(0, MAX_NOTE) || undefined });
    await logEvent(ctx, grant.orgId, asset._id, state, `${grant.name} (guest link)`, ver.version, note?.trim().slice(0, 200));
    await ctx.db.patch(grant._id, { lastUsedAt: Date.now(), firstUsedAt: grant.firstUsedAt ?? Date.now(), useCount: grant.useCount + 1 });
    return null;
  },
});

/* ── Shared library across studios (Max) ────────────────────── */

/** The caller of the all-studios view, mirroring projects.crossStudio: an agency
 *  viewer holding agency.viewAll, on an agency plan that includes the shared
 *  library. Studio staff (owners and interns alike) and guests are refused. */
async function sharedViewer(ctx: Reader): Promise<AgencyViewer> {
  const viewer = await resolveViewer(ctx);
  if (viewer.kind !== "agency_member" || !viewer.capabilities.has("agency.viewAll")) {
    throw new AccessError("CAPABILITY_DENIED", "The all-studios library is for the group admin.");
  }
  const agency = await ctx.db.query("agencies").withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId)).first();
  const tier = migrateTierValue(agency?.plan) ?? "core";
  if (!capabilitiesForTier(tier).has("sharedMediaLibrary")) throw upgradeError("sharedMediaLibrary", tier);
  return viewer;
}

/** Studios whose library the agency admin may see: the agency's own studios,
 *  inside the admin's staff scope, on a tier with the shared library, that
 *  opted in (orgs.shareMediaWithGroup). The workspace the admin is currently
 *  acting as is included without the flag (they can open it directly anyway).
 *  Derived from the viewer, never from arguments. */
async function sharedGroup(ctx: Reader, viewer: AgencyViewer): Promise<Doc<"orgs">[]> {
  const orgs = await ctx.db.query("orgs").withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId)).collect();
  const out: Doc<"orgs">[] = [];
  for (const o of orgs) {
    if (o.agencyId !== viewer.agencyId) continue;
    if (viewer.scopedSubAccountOrgIds !== "all" && !viewer.scopedSubAccountOrgIds.includes(o.orgId)) continue;
    if (o.orgId !== viewer.orgId && o.shareMediaWithGroup !== true) continue;
    const gate = await orgGate(ctx, o.orgId);
    if (!capabilitiesForTier(gate.tier).has("sharedMediaLibrary") || gate.disabled.has("mediaLibrary")) continue;
    out.push(o);
  }
  return out;
}

/** A studio owner opts the studio's library in or out of the agency admin's
 *  all-studios view. Off by default. Only the studio's own owner decides. */
export const setGroupSharing = mutation({
  args: { on: v.boolean() },
  handler: async (ctx, { on }) => {
    const viewer = await resolveViewer(ctx);
    if (viewer.kind !== "studio_member" || viewer.role !== "owner") {
      throw new AccessError("CAPABILITY_DENIED", "Only the studio's owner can share its library with the group.");
    }
    const orgId = await libOrg(ctx, "deliverables.approve");
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) throw new ConvexError("Studio not found.");
    await ctx.db.patch(org._id, { shareMediaWithGroup: on });
    return { on };
  },
});

/** The studios in the shared view, for the picker. */
export const sharedStudios = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await sharedViewer(ctx);
    return (await sharedGroup(ctx, viewer)).map((o) => ({ orgId: o.orgId, name: o.name, isThisStudio: o.orgId === viewer.orgId }));
  },
});

/** Search every studio in the agency group at once. Read-only. */
export const sharedSearch = query({
  args: { q: v.optional(v.string()), kind: v.optional(mediaKindV), tag: v.optional(v.string()), studioOrgId: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const viewer = await sharedViewer(ctx);
    const group = await sharedGroup(ctx, viewer);
    let ids = group.map((o) => o.orgId);
    if (a.studioOrgId) ids = ids.filter((i) => i === a.studioOrgId); // a filter inside the group, never a widening
    const names = new Map(group.map((o) => [o.orgId, o.name]));
    const rows = await runSearch(ctx, ids, a);
    return rows.map((r) => ({ ...r, studioName: names.get(r.orgId) ?? "Studio", isThisStudio: r.orgId === viewer.orgId }));
  },
});

/** Signed download for a version that lives in a sibling studio of the same group. */
export const sharedDownloadUrl = query({
  args: { versionId: v.id("mediaVersions") },
  handler: async (ctx, { versionId }) => {
    const viewer = await sharedViewer(ctx);
    const ver = await ctx.db.get(versionId);
    if (!ver) throw new ConvexError("Version not found.");
    const group = await sharedGroup(ctx, viewer);
    if (!group.some((o) => o.orgId === ver.orgId)) throw new ConvexError("Version not found.");
    const url = await fileUrl(ctx, ver.mediaId, { expiresIn: 3600 });
    if (!url) throw new ConvexError("File is no longer available.");
    return { url, fileName: ver.fileName };
  },
});

/** A sibling studio's file with its history, for the shared view. */
export const sharedDetail = query({
  args: { assetId: v.id("mediaAssets") },
  handler: async (ctx, { assetId }) => {
    const viewer = await sharedViewer(ctx);
    const asset = await ctx.db.get(assetId);
    if (!asset) throw new ConvexError("File not found.");
    const group = await sharedGroup(ctx, viewer);
    if (!group.some((o) => o.orgId === asset.orgId)) throw new ConvexError("File not found.");
    return await assetDetail(ctx, asset);
  },
});
