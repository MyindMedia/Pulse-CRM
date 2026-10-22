/* ============================================================
   Catalog Import enrichment: one discovered song -> everything Pulse
   keeps (ISRC, ISWC, BPM, genre, release, cover, credits), using the
   same sources and rules as the single-link importer. Plain fetch, no
   ctx. Order matters: MusicBrainz first pins the recording (artist,
   ISRC), so Deezer and Genius can look it up exactly.
   ============================================================ */
import { fetchJson, musicBrainz, deezer, genius } from "./catalogLookup";
import { MB_HEADERS, MB_PAUSE_MS } from "./catalogDiscovery";
import { dedupeCredits, deezerMeta, geniusCredits, primaryArtist, searchTitle, creditRole, type ImportedCredit } from "./musicLink";
import {
  cleanIsrc,
  geniusSongRoles,
  holdsChosenRole,
  parseReleaseDate,
  type CatalogRefs,
  type GeniusSongFull,
} from "./catalogMerge";

export type EnrichInput = {
  title: string;
  artistName?: string;
  isrc?: string;
  album?: string;
  releaseDate?: number;
  coverUrl?: string;
  roles: string[];
  refs: CatalogRefs;
};

export type Enriched = {
  title: string;
  artistName: string;
  isrc?: string;
  iswc?: string;
  bpm?: number;
  genre?: string;
  album?: string;
  releaseDate?: number;
  coverUrl?: string;
  roles: string[];
  credits: ImportedCredit[];
};

export type EnrichOutcome =
  | { kind: "ok"; song: Enriched }
  | { kind: "skip"; reason: string }
  | { kind: "fail"; reason: string };

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export async function enrichItem(
  item: EnrichInput,
  chosenRoles: string[],
  geniusArtistIds: number[],
): Promise<EnrichOutcome> {
  const roles = new Set(item.roles);
  const credits: ImportedCredit[] = [];
  const title = item.title;
  let artist = item.artistName;
  let isrc = item.isrc;
  let iswc: string | undefined;
  let album = item.album;
  let releaseDate = item.releaseDate;
  let coverUrl = item.coverUrl;
  let recordingId = item.refs.mbRecordingId;
  const auth = process.env.GENIUS_ACCESS_TOKEN?.trim()
    ? { Authorization: `Bearer ${process.env.GENIUS_ACCESS_TOKEN.trim()}`, Accept: "application/json" }
    : null;

  // 1. Genius song: the person's role on it, its credits and art.
  let geniusDone = false;
  if (item.refs.geniusSongId && auth) {
    const res = await fetchJson(`https://api.genius.com/songs/${item.refs.geniusSongId}?text_format=plain`, auth).catch(() => null);
    const song = (res?.response?.song ?? null) as (GeniusSongFull & {
      song_art_image_url?: unknown; album?: { name?: unknown }; release_date_components?: unknown;
    }) | null;
    if (song) {
      geniusDone = true;
      for (const id of geniusArtistIds) for (const r of geniusSongRoles(song, id)) roles.add(r);
      credits.push(...geniusCredits(song));
      artist ??= str(song.primary_artist?.name);
      coverUrl ??= str(song.song_art_image_url);
      album ??= str(song.album?.name);
      releaseDate ??= parseReleaseDate(song.release_date_components);
    }
  }
  if (!holdsChosenRole([...roles], chosenRoles)) {
    return { kind: "skip", reason: "Not credited in a chosen role" };
  }

  // 2. A MusicBrainz work (writer credit): its ISWC, writers, and a recording.
  if (item.refs.mbWorkId && !recordingId) {
    const work = await fetchJson(
      `https://musicbrainz.org/ws/2/work/${item.refs.mbWorkId}?inc=recording-rels+artist-rels&fmt=json`,
      MB_HEADERS,
    ).catch(() => null);
    await pause(MB_PAUSE_MS);
    if (work) {
      iswc = str((work.iswcs as unknown[] | undefined)?.[0]);
      type Rel = { type?: string; "target-type"?: string; artist?: { name?: string }; recording?: { id?: string } };
      for (const rel of (work.relations ?? []) as Rel[]) {
        if (rel["target-type"] === "recording") recordingId ??= rel.recording?.id;
        const role = rel.type ? creditRole(rel.type) : null;
        if (role === "Writer" && rel.artist?.name) credits.push({ name: rel.artist.name, role });
      }
    }
  }

  // 3. MusicBrainz recording: credited artist, ISRC, first release, credits, ISWC.
  const cleanTitle = searchTitle(title);
  const mb = await musicBrainz(cleanTitle, primaryArtist(artist ?? null), isrc ?? null, {
    recordingId,
    maxRecordings: 1,
  });
  credits.push(...mb.credits);
  artist ??= mb.artist ?? undefined;
  isrc ??= cleanIsrc(mb.isrc);
  iswc ??= mb.iswc ?? undefined;
  releaseDate ??= mb.releaseDate ?? undefined;

  if (!artist) return { kind: "fail", reason: "No artist found for this song" };

  // 4. Deezer: BPM, genre, album, art; by its own track id, else ISRC, else search.
  let bpm: number | undefined;
  let genre: string | undefined;
  try {
    let meta = null;
    if (item.refs.deezerTrackId) {
      const track = await fetchJson(`https://api.deezer.com/track/${item.refs.deezerTrackId}`);
      const albumId = (track?.album as { id?: number } | undefined)?.id;
      const alb = albumId ? await fetchJson(`https://api.deezer.com/album/${albumId}`).catch(() => null) : null;
      meta = deezerMeta(track ?? {}, alb);
      coverUrl ??= str(alb?.cover_xl);
    } else {
      meta = await deezer(cleanTitle, primaryArtist(artist), isrc ?? null);
    }
    if (meta) {
      isrc ??= meta.isrc ?? undefined;
      bpm = meta.bpm ?? undefined;
      genre = meta.genre ?? undefined;
      album ??= meta.album ?? undefined;
      releaseDate ??= meta.releaseDate ?? undefined;
    }
  } catch {
    // BPM and genre are a bonus.
  }

  // 5. Genius credits by search when discovery did not come from Genius.
  if (!geniusDone) credits.push(...(await genius(cleanTitle, primaryArtist(artist))));

  return {
    kind: "ok",
    song: {
      title: title.trim().slice(0, 200),
      artistName: artist.trim().slice(0, 200),
      isrc: cleanIsrc(isrc),
      iswc,
      bpm,
      genre,
      album,
      releaseDate,
      coverUrl,
      roles: [...roles],
      credits: dedupeCredits(credits),
    },
  };
}
