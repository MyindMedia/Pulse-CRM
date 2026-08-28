import { action, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { currentOrgWithCapability, assertOrg } from "./lib/tenant";
import {
  parseMusicLink,
  upscaleAppleArt,
  creditRole,
  dedupeCredits,
  buildContributors,
  metaContent,
  artistFromSpotifyDescription,
  type ImportedCredit,
} from "./lib/musicLink";

/* ============================================================
   Song importer - paste a Spotify or Apple Music link and pull
   the track's cover art + metadata, plus songwriter/producer
   credits (best-effort, via the open MusicBrainz database -
   neither streaming service exposes credits publicly).

   `fetchFromLink` (action) does the network work and stores the
   cover into _storage; it writes nothing else. The client then
   applies the result - prefilling the create dialog, or calling
   `applyToSong` for an existing song, which also drafts the
   split sheet from the credits.
   ============================================================ */

const FETCH_TIMEOUT_MS = 8000;
const MAX_COVER_BYTES = 4 * 1024 * 1024;
const MB_HEADERS = {
  // MusicBrainz requires an identifying User-Agent on API traffic.
  "User-Agent": "Pulse-StudioOS/1.0 (https://studiopulse.tech)",
  Accept: "application/json",
};

export type LinkImportResult = {
  provider: "spotify" | "apple";
  title: string | null;
  artistName: string | null;
  album: string | null;
  genre: string | null;
  releaseDate: number | null;
  coverStorageId: Id<"_storage"> | null;
  coverPreviewUrl: string | null;
  credits: ImportedCredit[];
};

/** Capability gate for the action - actions cannot touch ctx.db directly. */
export const access = internalQuery({
  args: {},
  handler: async (ctx) => currentOrgWithCapability(ctx, "songs.edit"),
});

async function fetchWithTimeout(url: string, headers?: Record<string, string>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url: string, headers?: Record<string, string>) {
  const res = await fetchWithTimeout(url, headers);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** Best-effort credits from MusicBrainz: recording rels give producers and
    engineers; the linked work's rels give the writers. Any failure returns
    what was gathered so far - credits are a bonus, never a blocker. */
async function musicBrainzCredits(
  title: string,
  artist: string | null,
): Promise<ImportedCredit[]> {
  const credits: ImportedCredit[] = [];
  try {
    const quote = (s: string) => `"${s.replace(/"/g, "")}"`;
    const query = `recording:${quote(title)}${artist ? ` AND artist:${quote(artist)}` : ""}`;
    const search = await fetchJson(
      `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=1`,
      MB_HEADERS,
    );
    const recordingId: string | undefined = search.recordings?.[0]?.id;
    if (!recordingId) return credits;

    const rec = await fetchJson(
      `https://musicbrainz.org/ws/2/recording/${recordingId}?inc=artist-rels+work-rels&fmt=json`,
      MB_HEADERS,
    );
    type Rel = {
      type?: string;
      artist?: { name?: string };
      work?: { id?: string };
      ["target-type"]?: string;
    };
    const rels: Rel[] = rec.relations ?? [];
    for (const rel of rels) {
      const role = rel.type ? creditRole(rel.type) : null;
      if (role && rel.artist?.name) credits.push({ name: rel.artist.name, role });
    }

    const workId = rels.find((r) => r["target-type"] === "work" && r.work?.id)?.work?.id;
    if (workId) {
      const work = await fetchJson(
        `https://musicbrainz.org/ws/2/work/${workId}?inc=artist-rels&fmt=json`,
        MB_HEADERS,
      );
      for (const rel of (work.relations ?? []) as Rel[]) {
        const role = rel.type ? creditRole(rel.type) : null;
        if (role === "Writer" && rel.artist?.name) {
          credits.push({ name: rel.artist.name, role });
        }
      }
    }
  } catch {
    // Rate limits / lookup misses just mean fewer prefilled credits.
  }
  return dedupeCredits(credits);
}

/** Pull the cover image into Convex storage so the song owns a copy - the
    CDN URL on the streaming service is neither stable nor hotlink-safe. */
async function storeCover(
  ctx: { storage: { store: (b: Blob) => Promise<Id<"_storage">> } },
  artUrl: string | null,
): Promise<Id<"_storage"> | null> {
  if (!artUrl) return null;
  try {
    const res = await fetchWithTimeout(artUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size === 0 || blob.size > MAX_COVER_BYTES) return null;
    return await ctx.storage.store(blob);
  } catch {
    return null;
  }
}

export const fetchFromLink = action({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<LinkImportResult> => {
    await ctx.runQuery(internal.songImport.access, {});

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

    const [credits, coverStorageId] = await Promise.all([
      title ? musicBrainzCredits(title, artistName) : Promise.resolve([]),
      storeCover(ctx, artUrl),
    ]);

    return {
      provider: link.provider,
      title,
      artistName,
      album,
      genre,
      releaseDate,
      coverStorageId,
      coverPreviewUrl: coverStorageId ? await ctx.storage.getUrl(coverStorageId) : artUrl,
      credits,
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
    coverStorageId: v.optional(v.id("_storage")),
    genre: v.optional(v.string()),
    releaseDate: v.optional(v.number()),
    artistName: v.optional(v.string()),
    credits: v.array(creditV),
  },
  handler: async (ctx, { songId, sourceUrl, coverStorageId, genre, releaseDate, artistName, credits }) => {
    const orgId = await currentOrgWithCapability(ctx, "songs.edit");
    const song = await ctx.db.get(songId);
    assertOrg(song, orgId);

    // Imported metadata fills blanks; it never overwrites studio-entered data.
    await ctx.db.patch(songId, {
      ...(coverStorageId ? { coverArtId: coverStorageId } : {}),
      ...(genre && !song!.genre ? { genre } : {}),
      ...(releaseDate && !song!.releaseDate ? { releaseDate } : {}),
    });

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
