import { action, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { claimFile, retireFile, type FileRef } from "./lib/media";
import { fileRefV } from "./lib/fileRef";
import { storeBytes } from "./media";
import { mutation } from "./functions";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { currentOrgWithCapability, assertOrg } from "./lib/tenant";
import {
  parseMusicLink,
  upscaleAppleArt,
  dedupeCredits,
  buildContributors,
  metaContent,
  artistFromSpotifyDescription,
  searchTitle,
  primaryArtist,
  type ImportedCredit,
} from "./lib/musicLink";
import { MAX_COVER_BYTES, fetchWithTimeout, fetchJson, musicBrainz, deezer, genius } from "./lib/catalogLookup";

/* ============================================================
   Song importer - paste a Spotify or Apple Music link and pull
   the track's cover art + metadata, plus songwriter/producer
   credits. Neither streaming service exposes credits or ISRCs
   without a developer account, so the link only identifies the
   song; the details come from open catalogs, all best-effort:
   Deezer (ISRC, release date, genre, BPM), MusicBrainz (credits,
   ISWC) and Genius (writer/producer credits, only when
   GENIUS_ACCESS_TOKEN is set).

   `fetchFromLink` (action) does the network work and stores the
   cover into _storage; it writes nothing else. The client then
   applies the result - prefilling the create dialog, or calling
   `applyToSong` for an existing song, which also drafts the
   split sheet from the credits.
   ============================================================ */

export type LinkImportResult = {
  provider: "spotify" | "apple";
  title: string | null;
  artistName: string | null;
  album: string | null;
  genre: string | null;
  releaseDate: number | null;
  isrc: string | null;
  iswc: string | null;
  bpm: number | null;
  /** An R2 mediaFiles id (a Convex storage id only on a deployment without R2). */
  coverStorageId: FileRef | null;
  coverPreviewUrl: string | null;
  credits: ImportedCredit[];
};

/** Capability gate for the action - actions cannot touch ctx.db directly. */
export const access = internalQuery({
  args: {},
  handler: async (ctx) => currentOrgWithCapability(ctx, "songs.edit"),
});

/** Pull the cover image into the studio's R2 bucket so the song owns a copy -
    the CDN URL on the streaming service is neither stable nor hotlink-safe. */
async function storeCover(
  ctx: ActionCtx,
  orgId: string,
  artUrl: string | null,
): Promise<FileRef | null> {
  if (!artUrl) return null;
  try {
    const res = await fetchWithTimeout(artUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size === 0 || blob.size > MAX_COVER_BYTES) return null;
    return await storeBytes(ctx, { scope: orgId, purpose: "cover", blob, fileName: "cover.jpg", actor: "song-import" });
  } catch {
    return null;
  }
}

export const fetchFromLink = action({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<LinkImportResult> => {
    const orgId: string = await ctx.runQuery(internal.songImport.access, {});

    const link = parseMusicLink(url);
    if (!link) {
      throw new Error("Paste a Spotify track link or an Apple Music song link.");
    }

    let title: string | null = null;
    let artistName: string | null = null;
    let album: string | null = null;
    let genre: string | null = null;
    let releaseDate: number | null = null;
    let artUrl: string | null = null;

    if (link.provider === "apple") {
      const data = await fetchJson(
        `https://itunes.apple.com/lookup?id=${link.id}&country=${link.country}`,
      );
      const item = data.results?.[0];
      if (!item) throw new Error("Apple Music didn't return anything for that link.");
      title = item.trackName ?? null;
      artistName = item.artistName ?? null;
      album = item.collectionName ?? null;
      genre = item.primaryGenreName ?? null;
      releaseDate = item.releaseDate ? Date.parse(item.releaseDate) || null : null;
      artUrl = item.artworkUrl100 ? upscaleAppleArt(item.artworkUrl100) : null;
    } else {
      // Spotify without API credentials: oEmbed gives the title + a 640px
      // thumbnail; the page's og tags carry the artist and full-size art.
      const oembed = await fetchJson(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
      );
      title = oembed.title ?? null;
      artUrl = oembed.thumbnail_url ?? null;
      try {
        const page = await fetchWithTimeout(`https://open.spotify.com/track/${link.id}`, {
          "User-Agent": "Mozilla/5.0 (compatible; Pulse-StudioOS/1.0)",
        });
        if (page.ok) {
          const html = await page.text();
          title = metaContent(html, "og:title") ?? title;
          artUrl = metaContent(html, "og:image") ?? artUrl;
          const desc = metaContent(html, "og:description");
          if (desc) artistName = artistFromSpotifyDescription(desc);
        }
      } catch {
        // The oEmbed data alone is still a useful import.
      }
    }

    if (!title && !artUrl) {
      throw new Error("Couldn't read that link - double-check it and try again.");
    }

    const cleanTitle = title ? searchTitle(title) : null;
    const mainArtist = primaryArtist(artistName);
    const [catalog, coverStorageId, geniusFound] = await Promise.all([
      cleanTitle ? deezer(cleanTitle, mainArtist, null) : Promise.resolve(null),
      storeCover(ctx, orgId, artUrl),
      cleanTitle ? genius(cleanTitle, mainArtist) : Promise.resolve([]),
    ]);
    // MusicBrainz goes after Deezer so the ISRC can pin the exact recording.
    const mb = cleanTitle
      ? await musicBrainz(cleanTitle, mainArtist, catalog?.isrc ?? null)
      : { credits: [], iswc: null, isrc: null };

    return {
      provider: link.provider,
      title,
      artistName,
      album: album ?? catalog?.album ?? null,
      genre: genre ?? catalog?.genre ?? null,
      releaseDate: releaseDate ?? catalog?.releaseDate ?? null,
      isrc: catalog?.isrc ?? mb.isrc,
      iswc: mb.iswc,
      bpm: catalog?.bpm ?? null,
      coverStorageId,
      coverPreviewUrl: coverStorageId ? await ctx.runQuery(internal.media._fileUrl, { ref: coverStorageId }) : artUrl,
      // Genius first: its writer/producer lists are fuller; dedupe merges roles.
      credits: dedupeCredits([...geniusFound, ...mb.credits]),
    };
  },
});

const creditV = v.object({ name: v.string(), role: v.string() });

/** Write an import result onto an existing song: cover art, metadata that is
    still blank, the source link as a reference track, and a drafted split
    sheet from the credits (never clobbers a sheet the studio already built). */
export const applyToSong = mutation({
  args: {
    songId: v.id("songs"),
    sourceUrl: v.string(),
    coverStorageId: v.optional(fileRefV),
    genre: v.optional(v.string()),
    releaseDate: v.optional(v.number()),
    isrc: v.optional(v.string()),
    iswc: v.optional(v.string()),
    bpm: v.optional(v.number()),
    artistName: v.optional(v.string()),
    credits: v.array(creditV),
  },
  handler: async (ctx, { songId, sourceUrl, coverStorageId, genre, releaseDate, isrc, iswc, bpm, artistName, credits }) => {
    const orgId = await currentOrgWithCapability(ctx, "songs.edit");
    const song = await ctx.db.get(songId);
    assertOrg(song, orgId);

    // The imported cover must be this studio's own upload; it replaces the old one.
    await claimFile(ctx, coverStorageId, orgId);
    const previousCover = coverStorageId ? song!.coverArtId : undefined;
    // Imported metadata fills blanks; it never overwrites studio-entered data.
    await ctx.db.patch(songId, {
      ...(coverStorageId ? { coverArtId: coverStorageId } : {}),
      ...(genre && !song!.genre ? { genre } : {}),
      ...(releaseDate && !song!.releaseDate ? { releaseDate } : {}),
      ...(isrc && !song!.isrc ? { isrc: isrc.trim().toUpperCase().slice(0, 12) } : {}),
      ...(iswc && !song!.iswc ? { iswc: iswc.trim().slice(0, 20) } : {}),
      ...(bpm && bpm > 0 && bpm < 400 && !song!.bpm ? { bpm: Math.round(bpm) } : {}),
    });
    await retireFile(ctx, previousCover, coverStorageId);

    // Keep provenance: the source link joins the reference tracks once.
    if (!song!.referenceTracks.some((r) => r.url === sourceUrl)) {
      await ctx.db.patch(songId, {
        referenceTracks: [
          ...song!.referenceTracks,
          { title: "Imported source", url: sourceUrl },
        ],
      });
    }

    // Split-sheet prefill: only when there's no sheet yet, or the existing
    // sheet is an empty draft. A sheet with contributors is studio work.
    let sheetPrefilled = false;
    if (credits.length > 0) {
      const artist = await ctx.db.get(song!.artistId);
      const contributors = buildContributors(
        credits,
        artistName ?? artist?.name,
      );
      const existing = await ctx.db
        .query("splitSheets")
        .withIndex("by_song", (q) => q.eq("songId", songId))
        .first();
      if (!existing) {
        await ctx.db.insert("splitSheets", {
          orgId,
          songId,
          status: "draft",
          contributors,
          updatedAt: Date.now(),
        });
        sheetPrefilled = true;
      } else if (existing.status === "draft" && existing.contributors.length === 0) {
        await ctx.db.patch(existing._id, { contributors, updatedAt: Date.now() });
        sheetPrefilled = true;
      }
    }

    await ctx.db.insert("activity", {
      orgId,
      kind: "song.imported",
      summary: `"${song!.title}" enriched from a streaming link${
        sheetPrefilled ? ` - split sheet drafted with ${credits.length} credited contributors` : ""
      }`,
      entityType: "song",
      entityId: songId,
      accent: "info",
    });

    return { sheetPrefilled };
  },
});
