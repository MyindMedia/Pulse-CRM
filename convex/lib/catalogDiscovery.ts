/* ============================================================
   Catalog Import discovery: find a person at the credit sources, and
   list the songs they hold a Credit Role on. Plain fetch, no ctx, so
   it runs against the live services outside Convex (like
   catalogLookup.ts). Every call is best-effort: a source that fails
   contributes nothing and the others carry on.

   Sources and what each discovers:
     deezer       Artist role: the artist's albums, then their tracks.
     apple        Artist role: iTunes lookup of the artist's songs.
     musicbrainz  Artist role: recordings credited to the artist (ISRCs).
                  Other roles: the artist's recording and work
                  relationships (producer, mix, writer, ...).
     genius       Every role: the artist's songs; the role is read from
                  each song at enrichment (Genius lists producers' and
                  writers' songs too). Needs GENIUS_ACCESS_TOKEN.
   ============================================================ */
import { fetchJson, fetchWithTimeout } from "./catalogLookup";
import { metaContent, upscaleAppleArt } from "./musicLink";
import {
  IMPORT_CAP,
  cleanIsrc,
  mbRelRole,
  parseReleaseDate,
  type ArtistLink,
  type Candidate,
} from "./catalogMerge";
import type { CreditSource } from "../catalogTables";

export const MB_HEADERS = {
  "User-Agent": "Pulse-StudioOS/1.0 (https://studiopulse.tech)",
  Accept: "application/json",
};
const MB = "https://musicbrainz.org/ws/2";
export const MB_PAUSE_MS = 1100;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function geniusAuth(): Record<string, string> | null {
  const token = process.env.GENIUS_ACCESS_TOKEN?.trim();
  return token ? { Authorization: `Bearer ${token}`, Accept: "application/json" } : null;
}

export type IdentityCandidate = {
  source: CreditSource;
  sourceId: string;
  name: string;
  imageUrl?: string;
  /** What tells two same-name people apart: MusicBrainz's disambiguation,
   *  a country, a fan count. */
  detail?: string;
  topSongs: string[];
};

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Search every source for people with this name. */
export async function searchIdentities(name: string): Promise<IdentityCandidate[]> {
  const q = name.trim();
  if (!q) return [];
  const [dz, mb, gn] = await Promise.all([deezerArtists(q), mbArtists(q), geniusArtists(q)]);
  return [...gn, ...mb, ...dz];
}

async function deezerArtists(q: string): Promise<IdentityCandidate[]> {
  try {
    const found = await fetchJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}&limit=4`);
    const rows = (found?.data ?? []) as { id?: number; name?: string; picture_medium?: string; nb_fan?: number }[];
    return await Promise.all(
      rows.filter((r) => typeof r.id === "number" && r.name).map(async (r) => {
        const top = await fetchJson(`https://api.deezer.com/artist/${r.id}/top?limit=3`).catch(() => null);
        return {
          source: "deezer" as const,
          sourceId: String(r.id),
          name: r.name!,
          imageUrl: s(r.picture_medium),
          detail: typeof r.nb_fan === "number" ? `${r.nb_fan.toLocaleString("en-US")} fans on Deezer` : undefined,
          topSongs: ((top?.data ?? []) as { title?: string }[]).flatMap((t) => (t.title ? [t.title] : [])),
        };
      }),
    );
  } catch {
    return [];
  }
}

async function mbArtists(q: string): Promise<IdentityCandidate[]> {
  try {
    const quoted = `"${q.replace(/"/g, "")}"`;
    const found = await fetchJson(`${MB}/artist/?query=artist:${encodeURIComponent(quoted)}&fmt=json&limit=5`, MB_HEADERS);
    type A = { id?: string; name?: string; score?: number; disambiguation?: string; country?: string; type?: string };
    return ((found?.artists ?? []) as A[])
      .filter((a) => a.id && a.name && (a.score ?? 0) >= 80)
      .map((a) => ({
        source: "musicbrainz" as const,
        sourceId: a.id!,
        name: a.name!,
        detail: [a.disambiguation, a.type, a.country].filter(Boolean).join(" · ") || undefined,
        topSongs: [],
      }));
  } catch {
    return [];
  }
}

async function geniusArtists(q: string): Promise<IdentityCandidate[]> {
  const auth = geniusAuth();
  if (!auth) return [];
  try {
    const found = await fetchJson(`https://api.genius.com/search?q=${encodeURIComponent(q)}&per_page=20`, auth);
    type Hit = { result?: { title?: string; primary_artist?: { id?: number; name?: string; image_url?: string } } };
    const byId = new Map<number, IdentityCandidate>();
    const want = q.toLowerCase();
    for (const h of (found?.response?.hits ?? []) as Hit[]) {
      const a = h.result?.primary_artist;
      if (typeof a?.id !== "number" || !a.name) continue;
      if (!a.name.toLowerCase().includes(want) && !want.includes(a.name.toLowerCase())) continue;
      const entry = byId.get(a.id) ?? {
        source: "genius" as const,
        sourceId: String(a.id),
        name: a.name,
        imageUrl: s(a.image_url),
        topSongs: [],
      };
      if (h.result?.title && entry.topSongs.length < 3) entry.topSongs.push(h.result.title);
      byId.set(a.id, entry);
    }
    return [...byId.values()].slice(0, 4);
  } catch {
    return [];
  }
}

/** An artist link -> the name to search, plus a ready identity when the link
 *  itself names one (Apple's artist ID is an iTunes ID, usable as is).
 *  TIDAL's pages carry no readable name, so a TIDAL link asks for it. */
export async function resolveArtistLink(
  link: ArtistLink,
): Promise<{ name: string | null; direct: IdentityCandidate | null }> {
  try {
    if (link.provider === "apple") {
      const data = await fetchJson(`https://itunes.apple.com/lookup?id=${link.id}&entity=song&limit=4&country=${link.country}`);
      const rows = (data?.results ?? []) as { wrapperType?: string; artistName?: string; trackName?: string; artworkUrl100?: string }[];
      const artist = rows.find((r) => r.wrapperType === "artist");
      if (!artist?.artistName) return { name: null, direct: null };
      const songs = rows.filter((r) => r.wrapperType === "track");
      return {
        name: artist.artistName,
        direct: {
          source: "apple",
          sourceId: link.id,
          name: artist.artistName,
          imageUrl: songs[0]?.artworkUrl100 ? upscaleAppleArt(songs[0].artworkUrl100, 250) : undefined,
          detail: "Apple Music artist",
          topSongs: songs.flatMap((t) => (t.trackName ? [t.trackName] : [])).slice(0, 3),
        },
      };
    }
    if (link.provider === "spotify") {
      const page = await fetchWithTimeout(`https://open.spotify.com/artist/${link.id}`, {
        "User-Agent": "Mozilla/5.0 (compatible; Pulse-StudioOS/1.0)",
      });
      if (!page.ok) return { name: null, direct: null };
      return { name: metaContent(await page.text(), "og:title"), direct: null };
    }
  } catch {
    // fall through
  }
  return { name: null, direct: null };
}

export type DiscoverIdentity = { source: CreditSource; sourceId: string; name: string };

/** Every song this identity holds one of `roles` on, as raw candidates. */
export async function discover(identity: DiscoverIdentity, roles: string[], limit = IMPORT_CAP + 200): Promise<Candidate[]> {
  try {
    switch (identity.source) {
      case "deezer":
        return roles.includes("Artist") ? await deezerDiscography(identity, limit) : [];
      case "apple":
        return roles.includes("Artist") ? await appleDiscography(identity) : [];
      case "musicbrainz":
        return await mbDiscovery(identity, roles, limit);
      case "genius":
        return await geniusDiscovery(identity, limit);
    }
  } catch {
    return [];
  }
  return [];
}

async function deezerDiscography(id: DiscoverIdentity, limit: number): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const albums: { id?: number }[] = [];
  let next: string | null = `https://api.deezer.com/artist/${id.sourceId}/albums?limit=100`;
  for (let page = 0; next && page < 5; page++) {
    const res: { data?: { id?: number }[]; next?: string } = await fetchJson(next);
    albums.push(...(res.data ?? []));
    next = res.next ?? null;
  }
  for (const a of albums) {
    if (out.length >= limit || typeof a.id !== "number") break;
    // Deezer allows 50 requests per 5 seconds.
    await pause(120);
    const album = await fetchJson(`https://api.deezer.com/album/${a.id}`).catch(() => null);
    if (!album || album.error) continue;
    type T = { id?: number; title?: string; artist?: { name?: string } };
    for (const t of (album.tracks?.data ?? []) as T[]) {
      if (!t.title || typeof t.id !== "number") continue;
      out.push({
        title: t.title,
        artistName: t.artist?.name ?? s(album.artist?.name),
        album: s(album.title),
        releaseDate: parseReleaseDate(album.release_date),
        coverUrl: s(album.cover_xl) ?? s(album.cover_big),
        roles: ["Artist"],
        sources: ["deezer"],
        refs: { deezerTrackId: t.id },
      });
    }
  }
  return out;
}

async function appleDiscography(id: DiscoverIdentity): Promise<Candidate[]> {
  const data = await fetchJson(`https://itunes.apple.com/lookup?id=${id.sourceId}&entity=song&limit=200`);
  type R = { wrapperType?: string; trackId?: number; trackName?: string; artistName?: string; collectionName?: string; releaseDate?: string; artworkUrl100?: string };
  return ((data?.results ?? []) as R[])
    .filter((r) => r.wrapperType === "track" && r.trackName)
    .map((r) => ({
      title: r.trackName!,
      artistName: r.artistName,
      album: r.collectionName,
      releaseDate: parseReleaseDate(r.releaseDate),
      coverUrl: r.artworkUrl100 ? upscaleAppleArt(r.artworkUrl100) : undefined,
      roles: ["Artist"],
      sources: ["apple"],
      refs: { appleTrackId: r.trackId },
    }));
}

async function mbDiscovery(id: DiscoverIdentity, roles: string[], limit: number): Promise<Candidate[]> {
  const out: Candidate[] = [];
  if (roles.includes("Artist")) {
    type Rec = { id?: string; title?: string; isrcs?: string[]; "first-release-date"?: string; "artist-credit"?: { name?: string }[] };
    for (let offset = 0; offset < limit && offset < 1000; offset += 100) {
      const page = await fetchJson(
        `${MB}/recording?artist=${id.sourceId}&inc=isrcs+artist-credits&limit=100&offset=${offset}&fmt=json`,
        MB_HEADERS,
      );
      const recs = (page?.recordings ?? []) as Rec[];
      for (const r of recs) {
        if (!r.id || !r.title) continue;
        out.push({
          title: r.title,
          artistName: r["artist-credit"]?.[0]?.name ?? id.name,
          isrc: cleanIsrc(r.isrcs?.[0]),
          releaseDate: parseReleaseDate(r["first-release-date"]),
          roles: ["Artist"],
          sources: ["musicbrainz"],
          refs: { mbRecordingId: r.id },
        });
      }
      await pause(MB_PAUSE_MS);
      if (recs.length < 100) break;
    }
  }
  const otherRoles = roles.filter((r) => r !== "Artist");
  if (otherRoles.length > 0) {
    const artist = await fetchJson(`${MB}/artist/${id.sourceId}?inc=recording-rels+work-rels&fmt=json`, MB_HEADERS);
    type Rel = { type?: string; "target-type"?: string; recording?: { id?: string; title?: string }; work?: { id?: string; title?: string } };
    for (const rel of (artist?.relations ?? []) as Rel[]) {
      const role = rel.type ? mbRelRole(rel.type) : null;
      if (!role || !otherRoles.includes(role)) continue;
      if (rel["target-type"] === "recording" && rel.recording?.id && rel.recording.title) {
        out.push({ title: rel.recording.title, roles: [role], sources: ["musicbrainz"], refs: { mbRecordingId: rel.recording.id } });
      } else if (rel["target-type"] === "work" && rel.work?.id && rel.work.title) {
        out.push({ title: rel.work.title, roles: [role], sources: ["musicbrainz"], refs: { mbWorkId: rel.work.id } });
      }
    }
    await pause(MB_PAUSE_MS);
  }
  return out;
}

async function geniusDiscovery(id: DiscoverIdentity, limit: number): Promise<Candidate[]> {
  const auth = geniusAuth();
  if (!auth) return [];
  const out: Candidate[] = [];
  type Song = {
    id?: number; title?: string; artist_names?: string; primary_artist?: { name?: string };
    song_art_image_url?: string; release_date_components?: unknown;
  };
  for (let page = 1; page && out.length < limit && page <= 20; ) {
    const res = await fetchJson(
      `https://api.genius.com/artists/${id.sourceId}/songs?per_page=50&page=${page}&sort=popularity`,
      auth,
    );
    for (const song of (res?.response?.songs ?? []) as Song[]) {
      if (typeof song.id !== "number" || !song.title) continue;
      out.push({
        title: song.title,
        artistName: song.primary_artist?.name ?? song.artist_names,
        releaseDate: parseReleaseDate(song.release_date_components),
        coverUrl: s(song.song_art_image_url),
        roles: [],
        sources: ["genius"],
        refs: { geniusSongId: song.id },
      });
    }
    page = typeof res?.response?.next_page === "number" ? res.response.next_page : 0;
  }
  return out;
}
