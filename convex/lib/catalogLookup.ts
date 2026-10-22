/* ============================================================
   Open-catalog lookups behind the song importer (convex/songImport.ts):
   Deezer, MusicBrainz and Genius. Plain fetch, no ctx, so they can be
   exercised against the live services outside Convex.
   ============================================================ */
import {
  creditRole,
  dedupeCredits,
  deezerMeta,
  geniusCredits,
  pickGeniusHit,
  pickDeezerHit,
  type CatalogMeta,
  type ImportedCredit,
} from "./musicLink";

export const FETCH_TIMEOUT_MS = 8000;
export const MAX_COVER_BYTES = 4 * 1024 * 1024;
const MB_HEADERS = {
  // MusicBrainz requires an identifying User-Agent on API traffic.
  "User-Agent": "Pulse-StudioOS/1.0 (https://studiopulse.tech)",
  Accept: "application/json",
};

export async function fetchWithTimeout(url: string, headers?: Record<string, string>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url: string, headers?: Record<string, string>) {
  const res = await fetchWithTimeout(url, headers);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

type MbRel = {
  type?: string;
  artist?: { name?: string };
  work?: { id?: string };
  ["target-type"]?: string;
};

/** Best-effort credits from MusicBrainz. The ISRC pins the exact recording;
    without one, a search on the cleaned title and primary artist. One song
    often has several recording entries (single, album, deluxe) and only some
    carry relationships, so up to three are read and merged. Recording rels
    give producers and engineers; the linked work gives writers and the ISWC.
    Calls are spaced a second apart (MusicBrainz's rate limit). Any failure
    returns what was gathered so far: credits are a bonus, never a blocker. */
export async function musicBrainz(
  title: string,
  artist: string | null,
  isrc: string | null,
  opts: {
    /** A known recording (Catalog Import found it): skips the lookup. */
    recordingId?: string;
    /** Recordings read for relationships; fewer is faster. */
    maxRecordings?: number;
  } = {},
): Promise<{
  credits: ImportedCredit[];
  iswc: string | null;
  isrc: string | null;
  /** From the first recording read: its credited artist and first release. */
  artist: string | null;
  releaseDate: number | null;
}> {
  const credits: ImportedCredit[] = [];
  let iswc: string | null = null;
  let foundIsrc: string | null = null;
  let foundArtist: string | null = null;
  let releaseDate: number | null = null;
  try {
    let ids: string[] = opts.recordingId ? [opts.recordingId] : [];
    if (ids.length === 0 && isrc) {
      const hit = await fetchJson(`https://musicbrainz.org/ws/2/isrc/${encodeURIComponent(isrc)}?fmt=json`, MB_HEADERS).catch(() => null);
      ids = ((hit?.recordings ?? []) as { id?: string }[]).flatMap((r) => (r.id ? [r.id] : []));
    }
    if (ids.length === 0) {
      if (isrc) await pause(1100);
      const quote = (x: string) => `"${x.replace(/"/g, "")}"`;
      const query = `recording:${quote(title)}${artist ? ` AND artist:${quote(artist)}` : ""}`;
      const search = await fetchJson(
        `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=5`,
        MB_HEADERS,
      );
      type Rec = { id?: string; score?: number; isrcs?: string[] };
      const recs = ((search.recordings ?? []) as Rec[]).filter((r) => r.id && (r.score ?? 0) >= 90);
      foundIsrc = recs.find((r) => r.isrcs?.length)?.isrcs?.[0] ?? null;
      ids = recs.map((r) => r.id!);
    }

    let workId: string | undefined;
    for (const id of ids.slice(0, opts.maxRecordings ?? 3)) {
      await pause(1100);
      const rec = await fetchJson(
        `https://musicbrainz.org/ws/2/recording/${id}?inc=artist-rels+work-rels+isrcs+artist-credits&fmt=json`,
        MB_HEADERS,
      );
      foundIsrc ??= (rec.isrcs as string[] | undefined)?.[0] ?? null;
      foundArtist ??= (rec["artist-credit"] as { name?: string }[] | undefined)?.[0]?.name ?? null;
      if (releaseDate === null && typeof rec["first-release-date"] === "string") {
        const t = Date.parse(rec["first-release-date"].length === 4 ? `${rec["first-release-date"]}-01-01` : rec["first-release-date"]);
        releaseDate = Number.isFinite(t) ? t : null;
      }
      const rels: MbRel[] = rec.relations ?? [];
      for (const rel of rels) {
        const role = rel.type ? creditRole(rel.type) : null;
        if (role && rel.artist?.name) credits.push({ name: rel.artist.name, role });
      }
      workId ??= rels.find((r) => r["target-type"] === "work" && r.work?.id)?.work?.id;
    }

    if (workId) {
      await pause(1100);
      const work = await fetchJson(
        `https://musicbrainz.org/ws/2/work/${workId}?inc=artist-rels&fmt=json`,
        MB_HEADERS,
      );
      iswc = (work.iswcs as string[] | undefined)?.[0] ?? null;
      for (const rel of (work.relations ?? []) as MbRel[]) {
        const role = rel.type ? creditRole(rel.type) : null;
        if (role === "Writer" && rel.artist?.name) {
          credits.push({ name: rel.artist.name, role });
        }
      }
    }
  } catch {
    // Rate limits / lookup misses just mean fewer prefilled credits.
  }
  return { credits: dedupeCredits(credits), iswc, isrc: foundIsrc, artist: foundArtist, releaseDate };
}

/** Deezer's open API: ISRC, release date, album genre and (when known) BPM.
    No key needed. Looked up by ISRC when the link gave one, else by search. */
export async function deezer(title: string, artist: string | null, isrc: string | null): Promise<CatalogMeta | null> {
  try {
    let track: Record<string, unknown> | null = null;
    if (isrc) {
      const t = await fetchJson(`https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`);
      if (t && !t.error) track = t;
    }
    if (!track) {
      // Plain search: Deezer's track:"" artist:"" syntax intermittently returns nothing.
      const q = [title, artist].filter(Boolean).join(" ");
      const found = await fetchJson(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=10`);
      const id = pickDeezerHit(found?.data ?? [], title, artist);
      if (!id) return null;
      track = await fetchJson(`https://api.deezer.com/track/${id}`);
    }
    const albumId = (track?.album as { id?: number } | undefined)?.id;
    const album = albumId ? await fetchJson(`https://api.deezer.com/album/${albumId}`).catch(() => null) : null;
    return deezerMeta(track ?? {}, album);
  } catch {
    return null;
  }
}

/** Genius has the fullest writer/producer credits for most commercial songs.
    Needs a free API client token in GENIUS_ACCESS_TOKEN; skipped without one. */
export async function genius(title: string, artist: string | null): Promise<ImportedCredit[]> {
  const token = process.env.GENIUS_ACCESS_TOKEN?.trim();
  if (!token) return [];
  const auth = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  try {
    const q = [title, artist].filter(Boolean).join(" ");
    const found = await fetchJson(`https://api.genius.com/search?q=${encodeURIComponent(q)}`, auth);
    const id = pickGeniusHit(found?.response?.hits ?? [], title, artist);
    if (!id) return [];
    const song = await fetchJson(`https://api.genius.com/songs/${id}?text_format=plain`, auth);
    return geniusCredits(song?.response?.song ?? {});
  } catch {
    return [];
  }
}

