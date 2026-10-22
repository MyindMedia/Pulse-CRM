/* ============================================================
   Pure helpers for Catalog Import (convex/catalogImport.ts): artist
   links, credit-role mapping, and merging candidates from several
   sources into one list of songs. No fetch, no ctx.
   ============================================================ */
import { searchTitle, primaryArtist, geniusRole } from "./musicLink";

export const IMPORT_CAP = 500;

export type ArtistLink =
  | { provider: "spotify"; id: string }
  | { provider: "apple"; id: string; country: string }
  | { provider: "tidal"; id: string };

/** Recognise an artist page on Spotify, Apple Music or TIDAL. */
export function parseArtistLink(raw: string): ArtistLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === "open.spotify.com" || host.endsWith(".spotify.com")) {
    const m = url.pathname.match(/\/(?:intl-[a-z]{2}\/)?artist\/([A-Za-z0-9]+)/);
    return m ? { provider: "spotify", id: m[1] } : null;
  }
  if (host === "music.apple.com" || host === "itunes.apple.com" || host === "geo.music.apple.com") {
    const m = url.pathname.match(/\/artist\/(?:[^/]+\/)?(\d+)/);
    if (!m) return null;
    const country = url.pathname.match(/^\/([a-z]{2})\//)?.[1] ?? "us";
    return { provider: "apple", id: m[1], country };
  }
  if (host === "tidal.com" || host.endsWith(".tidal.com")) {
    const m = url.pathname.match(/\/artist\/(\d+)/);
    return m ? { provider: "tidal", id: m[1] } : null;
  }
  return null;
}

/** MusicBrainz relationship type (recording or work side) -> Credit Role. */
export function mbRelRole(type: string): string | null {
  const t = type.toLowerCase();
  if (t === "composer" || t === "lyricist" || t === "writer" || t === "librettist") return "Writer";
  if (t === "producer") return "Producer";
  if (t === "mix") return "Mix Engineer";
  if (t === "mastering") return "Mastering Engineer";
  if (t === "recording" || t === "engineer" || t === "audio" || t === "sound") return "Engineer";
  if (t === "vocal") return "Vocalist";
  if (t === "instrument" || t === "performer") return "Musician";
  return null;
}

export type CatalogRefs = {
  deezerTrackId?: number;
  mbRecordingId?: string;
  mbWorkId?: string;
  geniusSongId?: number;
  appleTrackId?: number;
};

export type Candidate = {
  title: string;
  artistName?: string;
  isrc?: string;
  album?: string;
  releaseDate?: number;
  coverUrl?: string;
  /** Credit Roles the identity holds on this song, when the source says so.
   *  Empty for Genius artist songs: the role is read from the song itself. */
  roles: string[];
  sources: string[];
  refs: CatalogRefs;
};

const norm = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function cleanIsrc(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(s) ? s : undefined;
}

export function titleKey(title: string): string {
  return norm(searchTitle(title));
}

function artistKeyOf(c: Candidate): string {
  return c.artistName ? norm(primaryArtist(c.artistName) ?? c.artistName) : "";
}

function absorb(into: Candidate, from: Candidate): void {
  for (const r of from.roles) if (!into.roles.includes(r)) into.roles.push(r);
  for (const s of from.sources) if (!into.sources.includes(s)) into.sources.push(s);
  into.refs = { ...from.refs, ...into.refs };
  into.artistName ??= from.artistName;
  into.isrc ??= from.isrc;
  into.album ??= from.album;
  into.releaseDate ??= from.releaseDate;
  into.coverUrl ??= from.coverUrl;
}

/**
 * One song per real recording: merge by ISRC, then by cleaned title plus
 * primary artist; a candidate with no artist (a MusicBrainz credit, a work)
 * joins the single entry with its title, or groups with other artist-less
 * entries of that title. Order is first seen. Everything past the cap is
 * counted, not kept.
 */
export function mergeCandidates(
  input: Candidate[],
  cap = IMPORT_CAP,
): { items: Candidate[]; capped: number } {
  const out: Candidate[] = [];
  const byIsrc = new Map<string, Candidate>();
  const byTitleArtist = new Map<string, Candidate>();
  const byTitle = new Map<string, Candidate[]>();

  const index = (c: Candidate) => {
    if (c.isrc) byIsrc.set(c.isrc, c);
    const t = titleKey(c.title);
    const a = artistKeyOf(c);
    if (a) byTitleArtist.set(`${t}|${a}`, c);
    const list = byTitle.get(t) ?? [];
    if (!list.includes(c)) list.push(c);
    byTitle.set(t, list);
  };

  for (const raw of input) {
    if (!raw.title?.trim()) continue;
    const c: Candidate = { ...raw, roles: [...raw.roles], sources: [...raw.sources], refs: { ...raw.refs } };
    const t = titleKey(c.title);
    const a = artistKeyOf(c);
    let hit = (c.isrc && byIsrc.get(c.isrc)) || (a ? byTitleArtist.get(`${t}|${a}`) : undefined);
    if (!hit) {
      const sameTitle = byTitle.get(t) ?? [];
      if (!a) {
        // No artist yet: merge only when the title is unambiguous.
        if (sameTitle.length === 1) hit = sameTitle[0];
      } else {
        // An earlier artist-less entry of this title takes this artist.
        const loose = sameTitle.filter((x) => !artistKeyOf(x));
        if (loose.length === 1 && sameTitle.length === 1) hit = loose[0];
      }
    }
    if (hit) {
      absorb(hit, c);
      index(hit);
    } else {
      out.push(c);
      index(c);
    }
  }
  return { items: out.slice(0, cap), capped: Math.max(0, out.length - cap) };
}

type GeniusPerson = { id?: unknown; name?: unknown };
export type GeniusSongFull = {
  id?: unknown;
  title?: unknown;
  primary_artist?: GeniusPerson;
  featured_artists?: GeniusPerson[];
  writer_artists?: GeniusPerson[];
  producer_artists?: GeniusPerson[];
  custom_performances?: { label?: unknown; artists?: GeniusPerson[] }[];
};

/** The Credit Roles one Genius artist holds on one song. */
export function geniusSongRoles(song: GeniusSongFull, geniusArtistId: number): string[] {
  const roles = new Set<string>();
  const has = (list: GeniusPerson[] | undefined) => (list ?? []).some((p) => p.id === geniusArtistId);
  if (song.primary_artist?.id === geniusArtistId || has(song.featured_artists)) roles.add("Artist");
  if (has(song.writer_artists)) roles.add("Writer");
  if (has(song.producer_artists)) roles.add("Producer");
  for (const p of song.custom_performances ?? []) {
    if (!has(p.artists) || typeof p.label !== "string") continue;
    const role = geniusRole(p.label);
    if (role) roles.add(role);
  }
  return [...roles];
}

/** Does the song hold at least one of the roles the person asked for. */
export function holdsChosenRole(found: string[], chosen: string[]): boolean {
  return found.some((r) => chosen.includes(r));
}

/** "2019-07-12" / "2019" / { year, month, day } -> epoch ms, or undefined. */
export function parseReleaseDate(raw: unknown): number | undefined {
  if (raw && typeof raw === "object") {
    const o = raw as { year?: unknown; month?: unknown; day?: unknown };
    if (typeof o.year !== "number") return undefined;
    const m = typeof o.month === "number" ? o.month : 1;
    const d = typeof o.day === "number" ? o.day : 1;
    return Date.UTC(o.year, m - 1, d);
  }
  if (typeof raw !== "string" || !raw.trim() || raw.startsWith("0000")) return undefined;
  const s = /^\d{4}$/.test(raw.trim()) ? `${raw.trim()}-01-01` : raw.trim();
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
}
