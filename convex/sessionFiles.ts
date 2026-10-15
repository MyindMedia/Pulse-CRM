import { query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { createUpload } from "./media";
import { claimFile, fileUrl } from "./lib/media";
import { assertWithinLimit, meterStorageUpload } from "./usage";
import { buildSearchText, removeAsset } from "./mediaLibrary";
import { mediaKindV, type MediaKind } from "./mediaLibraryTables";
import {
  staffSession,
  staffSessionOrNull,
  canEditSession,
  canModerate,
  holds,
  type SessionAccess,
} from "./lib/sessionAccess";

/* ============================================================
   Files and songs attached to one booking, from the session modal.

   Bytes: Cloudflare R2 only, never Convex storage. The same three steps as
   every other upload (convex/media.ts):
     1. prepareUpload   checks the caller and the file, mints a one-time
                        presigned PUT into the studio's PRIVATE bucket
     2. the browser PUTs the file straight to R2
     3. media.confirmUpload asks R2 what arrived, then attach() files it
   Downloads are presigned GETs minted here after the same staff check, and
   they expire in ten minutes.

   Rows: a file is a media library asset (mediaAssets + mediaVersions) with
   `sessionId` set, so a Growth studio also finds it in its library. Extra
   songs live in `sessionSongs`; `sessions.songId` stays the main song.

   Who:
     see / download      sessions.read
     upload              deliverables.upload (owner, manager, engineers)
     delete a file       its uploader, or an owner / manager
     link / unlink song  sessions.edit, or sessions.edit.own on their booking
   ============================================================ */

const MB = 1024 * 1024;
/** Audio, stems, video and session archives. */
export const BIG_FILE_MAX = 2048 * MB;
/** Documents and images. */
export const DOC_FILE_MAX = 100 * MB;
const DOWNLOAD_TTL_S = 600;

const BIG_TYPES =
  /^(audio\/[\w.+-]+|video\/[\w.+-]+|application\/(zip|x-zip|x-zip-compressed|x-7z-compressed|x-rar-compressed|vnd\.rar|x-tar|gzip|x-gzip|octet-stream))$/i;
const DOC_TYPES =
  /^(image\/(png|jpe?g|webp|gif|avif|heic|heif|tiff)|application\/(pdf|json|rtf|msword|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.[\w.-]+|vnd\.apple\.(pages|numbers|keynote)|x-midi)|text\/(plain|csv|rtf|markdown))$/i;

/** The size cap for a content type, or null when the type is not accepted.
 *  Anything a browser could run (HTML, SVG, scripts) is refused outright. */
export function sessionFileLimit(mimeType: string): number | null {
  const t = (mimeType || "application/octet-stream").trim().toLowerCase();
  if (BIG_TYPES.test(t)) return BIG_FILE_MAX;
  if (DOC_TYPES.test(t)) return DOC_FILE_MAX;
  return null;
}

function kindFor(mimeType: string): MediaKind {
  const t = mimeType.toLowerCase();
  if (t.startsWith("image/")) return "artwork";
  if (t.startsWith("audio/") || t.startsWith("video/") || BIG_TYPES.test(t)) return "session";
  return "other";
}

function checkFile(mimeType: string, size: number): number {
  const max = sessionFileLimit(mimeType);
  if (max === null) {
    throw new ConvexError("That file type is not supported. Upload audio, video, stems (zip), PDFs, images or text.");
  }
  if (!Number.isFinite(size) || size <= 0) throw new ConvexError("That file is empty.");
  if (size > max) throw new ConvexError(`That file is too large (limit ${max >= 1024 * MB ? `${max / (1024 * MB)} GB` : `${max / MB} MB`}).`);
  return max;
}

async function songInOrg(ctx: QueryCtx, orgId: string, songId: Id<"songs">): Promise<Doc<"songs">> {
  const song = await ctx.db.get(songId);
  if (!song || song.orgId !== orgId) throw new ConvexError("Song not found.");
  return song;
}

/* ── Reads ──────────────────────────────────────────────────── */

/** Files and songs on a booking, plus what the caller may do with them.
 *  Null when the caller may not see this booking. */
export const list = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const access = await staffSessionOrNull(ctx, sessionId);
    if (!access) return null;
    const { orgId, session } = access;
    const moderator = canModerate(access.viewer);

    const assets = await ctx.db
      .query("mediaAssets")
      .withIndex("by_org_session", (q) => q.eq("orgId", orgId).eq("sessionId", sessionId))
      .take(200);
    const files = [];
    for (const asset of assets) {
      if (asset.orgId !== orgId) continue;
      const latest = await ctx.db
        .query("mediaVersions")
        .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
        .order("desc")
        .first();
      if (!latest) continue;
      const media = await ctx.db.get(latest.mediaId);
      const uploaderId = media?.uploadedBy ?? null;
      files.push({
        assetId: asset._id,
        versionId: latest._id,
        name: asset.name,
        kind: asset.kind,
        fileName: latest.fileName,
        size: latest.size,
        mimeType: latest.mimeType,
        version: latest.version,
        uploadedBy: latest.uploadedBy,
        uploadedAt: latest.uploadedAt,
        songId: asset.songId ?? null,
        canDelete: moderator || (uploaderId !== null && uploaderId === access.actorId),
      });
    }
    files.sort((a, b) => b.uploadedAt - a.uploadedAt);

    const songs: { linkId: Id<"sessionSongs"> | null; songId: Id<"songs">; title: string; artistName: string | null; primary: boolean }[] = [];
    const seen = new Set<string>();
    if (session.songId) {
      const s = await ctx.db.get(session.songId);
      if (s && s.orgId === orgId) {
        const artist = await ctx.db.get(s.artistId);
        songs.push({ linkId: null, songId: s._id, title: s.title, artistName: artist?.name ?? null, primary: true });
        seen.add(s._id);
      }
    }
    const links = await ctx.db
      .query("sessionSongs")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .take(100);
    for (const link of links) {
      if (link.orgId !== orgId || seen.has(link.songId)) continue;
      const s = await ctx.db.get(link.songId);
      if (!s || s.orgId !== orgId) continue;
      const artist = await ctx.db.get(s.artistId);
      songs.push({ linkId: link._id, songId: s._id, title: s.title, artistName: artist?.name ?? null, primary: false });
      seen.add(s._id);
    }

    return {
      files,
      songs,
      canUpload: holds(access.viewer, "deliverables.upload"),
      canEditSongs: canEditSession(access),
      canCreateSong: holds(access.viewer, "songs.edit"),
    };
  },
});

/** Songs in this studio the booking could link to, the client's own first. */
export const songChoices = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const access = await staffSessionOrNull(ctx, sessionId);
    if (!access) return null;
    const rows = await ctx.db
      .query("songs")
      .withIndex("by_org", (q) => q.eq("orgId", access.orgId))
      .order("desc")
      .take(300);
    const artistId = access.session.artistId;
    return rows
      .map((s) => ({ _id: s._id, title: s.title, own: s.artistId === artistId }))
      .sort((a, b) => Number(b.own) - Number(a.own) || a.title.localeCompare(b.title));
  },
});

/** A presigned GET for one file, good for ten minutes. Called on demand (play
 *  or download), never kept in a live query result. */
export const downloadUrl = query({
  args: { versionId: v.id("mediaVersions") },
  handler: async (ctx, { versionId }) => {
    const ver = await ctx.db.get(versionId);
    if (!ver) throw new ConvexError("File not found.");
    const asset = await ctx.db.get(ver.assetId);
    if (!asset?.sessionId) throw new ConvexError("File not found.");
    const access = await staffSession(ctx, asset.sessionId);
    if (asset.orgId !== access.orgId || ver.orgId !== access.orgId) throw new ConvexError("File not found.");
    const url = await fileUrl(ctx, ver.mediaId, { expiresIn: DOWNLOAD_TTL_S });
    if (!url) throw new ConvexError("That file is no longer available.");
    return { url, fileName: ver.fileName, mimeType: ver.mimeType, expiresIn: DOWNLOAD_TTL_S };
  },
});

/* ── Upload ─────────────────────────────────────────────────── */

/** Step 1: a one-time presigned PUT into the studio's private R2 bucket. The
 *  declared type and size are checked here (and the real size again on attach). */
export const prepareUpload = mutation({
  args: { sessionId: v.id("sessions"), fileName: v.string(), mimeType: v.string(), size: v.number() },
  handler: async (ctx, a) => {
    const access = await staffSession(ctx, a.sessionId, "deliverables.upload");
    const mimeType = a.mimeType.trim() || "application/octet-stream";
    checkFile(mimeType, a.size);
    await assertWithinLimit(ctx, access.orgId, "storage_bytes", Math.max(0, a.size));
    return await createUpload(ctx, {
      scope: access.orgId,
      purpose: "deliverable",
      fileName: a.fileName,
      mimeType,
      size: a.size,
      actor: access.actorId,
    });
  },
});

/** Step 3 (after media.confirmUpload): file the upload on the booking. With
 *  `songId` it is also tagged to that song and the song is linked. */
export const attach = mutation({
  args: {
    sessionId: v.id("sessions"),
    mediaId: v.id("mediaFiles"),
    name: v.optional(v.string()),
    kind: v.optional(mediaKindV),
    songId: v.optional(v.id("songs")),
  },
  handler: async (ctx, a): Promise<{ assetId: Id<"mediaAssets">; versionId: Id<"mediaVersions"> }> => {
    const access = await staffSession(ctx, a.sessionId, "deliverables.upload");
    const { orgId, session } = access;
    const m = await ctx.db.get(a.mediaId);
    if (!m || m.orgId !== orgId || m.purpose !== "deliverable") throw new ConvexError("Upload not found.");
    if (m.status !== "ready") throw new ConvexError("The upload has not finished.");
    // The real size R2 reported, against the cap for its type.
    checkFile(m.mimeType, m.size ?? 0);
    const used = await ctx.db.query("mediaVersions").withIndex("by_media", (q) => q.eq("mediaId", a.mediaId)).first();
    if (used) throw new ConvexError("That upload is already filed.");
    const song = a.songId ? await songInOrg(ctx, orgId, a.songId) : null;

    await meterStorageUpload(ctx, orgId, a.mediaId, null);
    await claimFile(ctx, a.mediaId, orgId);

    const now = Date.now();
    const size = m.size ?? 0;
    const name = ((a.name ?? "").trim() || m.fileName).slice(0, 160);
    const kind = a.kind ?? kindFor(m.mimeType);
    const assetId = await ctx.db.insert("mediaAssets", {
      orgId,
      name,
      kind,
      tags: ["session"],
      songId: song?._id,
      sessionId: session._id,
      currentVersion: 1,
      versionCount: 1,
      totalBytes: size,
      searchText: buildSearchText({ name, tags: ["session"], kind, songTitle: song?.title, sessionTitle: session.title }),
      createdBy: access.actorName,
      createdAt: now,
      updatedAt: now,
    });
    const versionId = await ctx.db.insert("mediaVersions", {
      orgId,
      assetId,
      version: 1,
      mediaId: a.mediaId,
      fileName: m.fileName,
      size,
      mimeType: m.mimeType,
      approval: "pending",
      uploadedBy: access.actorName,
      uploadedAt: now,
    });
    await ctx.db.insert("mediaEvents", {
      orgId, assetId, version: 1, action: "upload", actor: access.actorName, detail: `session: ${session.title}`.slice(0, 200), createdAt: now,
    });
    if (song) await linkSongRow(ctx, access, song._id);
    return { assetId, versionId };
  },
});

/** Removes a file from the booking and deletes its bytes from R2. */
export const remove = mutation({
  args: { assetId: v.id("mediaAssets") },
  handler: async (ctx, { assetId }) => {
    const asset = await ctx.db.get(assetId);
    if (!asset?.sessionId) throw new ConvexError("File not found.");
    const access = await staffSession(ctx, asset.sessionId);
    if (asset.orgId !== access.orgId) throw new ConvexError("File not found.");
    if (!canModerate(access.viewer)) {
      const latest = await ctx.db
        .query("mediaVersions")
        .withIndex("by_asset", (q) => q.eq("assetId", assetId))
        .order("desc")
        .first();
      const media = latest ? await ctx.db.get(latest.mediaId) : null;
      if (!media || media.uploadedBy !== access.actorId) {
        throw new ConvexError("Only the person who uploaded this file or an owner or manager can delete it.");
      }
    }
    await removeAsset(ctx, access.orgId, asset);
    return null;
  },
});

/* ── Songs ──────────────────────────────────────────────────── */

async function linkSongRow(
  ctx: MutationCtx,
  access: SessionAccess,
  songId: Id<"songs">,
): Promise<Id<"sessionSongs"> | null> {
  if (access.session.songId === songId) return null;
  const existing = await ctx.db
    .query("sessionSongs")
    .withIndex("by_session", (q) => q.eq("sessionId", access.session._id))
    .filter((q) => q.eq(q.field("songId"), songId))
    .first();
  if (existing) return existing._id;
  return await ctx.db.insert("sessionSongs", {
    orgId: access.orgId,
    sessionId: access.session._id,
    songId,
    linkedBy: access.actorName,
    linkedAt: Date.now(),
  });
}

export const linkSong = mutation({
  args: { sessionId: v.id("sessions"), songId: v.id("songs") },
  handler: async (ctx, { sessionId, songId }) => {
    const access = await staffSession(ctx, sessionId, "sessions.edit");
    if (!canEditSession(access)) throw new ConvexError("You can only link songs to your own bookings.");
    await songInOrg(ctx, access.orgId, songId);
    return await linkSongRow(ctx, access, songId);
  },
});

export const unlinkSong = mutation({
  args: { linkId: v.id("sessionSongs") },
  handler: async (ctx, { linkId }) => {
    const link = await ctx.db.get(linkId);
    if (!link) throw new ConvexError("Link not found.");
    const access = await staffSession(ctx, link.sessionId, "sessions.edit");
    if (link.orgId !== access.orgId) throw new ConvexError("Link not found.");
    if (!canEditSession(access)) throw new ConvexError("You can only change songs on your own bookings.");
    await ctx.db.delete(linkId);
    return null;
  },
});
