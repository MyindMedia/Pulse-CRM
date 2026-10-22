/* ============================================================
   Pure helpers for the Spotify / Apple Music song importer.
   No fetch, no ctx - everything here is unit-testable. The
   action in convex/songImport.ts does the network work.
   ============================================================ */

export type MusicLink =
  | { provider: "spotify"; kind: "track"; id: string }
  | { provider: "apple"; kind: "track" | "album"; id: string; country: string };

/** Recognize a Spotify track link or an Apple Music song/album link. */
export function parseMusicLink(raw: string): MusicLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();

  if (host === "open.spotify.com" || host.endsWith(".spotify.com")) {
    // Paths: /track/<id> or /intl-xx/track/<id>
    const m = url.pathname.match(/\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]+)/);
    if (m) return { provider: "spotify", kind: "track", id: m[1] };
    return null;
  }

  if (host === "music.apple.com" || host === "itunes.apple.com" || host === "geo.music.apple.com") {
    const country = url.pathname.match(/^\/([a-z]{2})\//)?.[1] ?? "us";
    // Song page: /us/song/<slug>/<id>; album track: /us/album/<slug>/<albumId>?i=<trackId>
    const trackParam = url.searchParams.get("i");
    if (trackParam && /^\d+$/.test(trackParam)) {
      return { provider: "apple", kind: "track", id: trackParam, country };
    }
    const song = url.pathname.match(/\/song\/[^/]+\/(\d+)/);
    if (song) return { provider: "apple", kind: "track", id: song[1], country };
    const album = url.pathname.match(/\/album\/[^/]+\/(\d+)/);
    if (album) return { provider: "apple", kind: "album", id: album[1], country };
    return null;
  }

  return null;
}

/** iTunes artwork URLs embed their size ("…/100x100bb.jpg") - swap for a
    print-quality square. The CDN renders any requested size. */
export function upscaleAppleArt(artworkUrl: string, size = 600): string {
  return artworkUrl.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)/, `/${size}x${size}$1.$2`);
}

/** MusicBrainz relation type -> the split-sheet role label, or null to skip. */
export function creditRole(mbType: string): string | null {
  const t = mbType.toLowerCase();
  if (t === "composer" || t === "lyricist" || t === "writer") return "Writer";
  if (t === "producer") return "Producer";
  if (t === "mix") return "Mix Engineer";
  if (t === "recording" || t === "engineer" || t === "audio") return "Engineer";
  if (t === "vocal") return "Vocalist";
  if (t === "instrument") return "Musician";
  return null;
}

export type ImportedCredit = { name: string; role: string };

/** Dedupe credits by person, merging roles ("Writer / Producer"). Order is
    kept stable: writers first, then producers, then everyone else. */
export function dedupeCredits(credits: ImportedCredit[]): ImportedCredit[] {
  const rank = (role: string) =>
    role.includes("Writer") ? 0 : role.includes("Producer") ? 1 : 2;
  const byName = new Map<string, { name: string; roles: string[] }>();
  for (const c of credits) {
    const key = c.name.trim().toLowerCase();
    if (!key) continue;
    const entry = byName.get(key);
    if (!entry) byName.set(key, { name: c.name.trim(), roles: [c.role] });
    else if (!entry.roles.includes(c.role)) entry.roles.push(c.role);
  }
  // Within one person, list the roles that carry splits first.
  const order = ["Writer", "Producer", "Artist", "Vocalist", "Musician", "Mix Engineer", "Mastering Engineer", "Engineer"];
  const pos = (r: string) => (order.indexOf(r) < 0 ? order.length : order.indexOf(r));
  return [...byName.values()]
    .map((e) => ({ name: e.name, role: [...e.roles].sort((x, y) => pos(x) - pos(y)).join(" / ") }))
    .sort((a, b) => rank(a.role) - rank(b.role));
}

export type PrefillContributor = {
  name: string;
  role: string;
  masterPct: number;
  publishingPct: number;
  signed: boolean;
};

/**
 * Turn imported credits into a balanced draft split sheet: everyone gets an
 * equal share of both columns, remainders land on the first row, totals are
 * always exactly 100. The studio edits the numbers before sending for
 * signature - this is a starting point, not a legal opinion.
 */
export function buildContributors(
  credits: ImportedCredit[],
  primaryArtist?: string,
): PrefillContributor[] {
  const merged = dedupeCredits(credits);
  // The song's primary artist belongs on the sheet even when the credit
  // sources missed them.
  if (
    primaryArtist?.trim() &&
    !merged.some((c) => c.name.toLowerCase() === primaryArtist.trim().toLowerCase())
  ) {
    merged.unshift({ name: primaryArtist.trim(), role: "Artist" });
  }
  if (merged.length === 0) return [];

  const n = merged.length;
  const base = Math.floor(100 / n);
  const remainder = 100 - base * n;
  return merged.map((c, i) => ({
    name: c.name,
    role: c.role,
    masterPct: base + (i === 0 ? remainder : 0),
    publishingPct: base + (i === 0 ? remainder : 0),
    signed: false,
  }));
}

/** Pull og:/meta content out of raw HTML without a DOM. Handles either
    attribute order and both quote styles. */
export function metaContent(html: string, property: string): string | null {
  const esc = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${esc}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeHtmlEntities(m[1]);
  }
  return null;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x?([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, _.startsWith("&#x") ? 16 : 10)),
    );
}

/** Spotify's og:description reads "Artist · Song · Year" (segments vary) -
    the artist is the first segment. */
export function artistFromSpotifyDescription(description: string): string | null {
  const first = description.split("·")[0]?.trim();
  return first || null;
}

/** The title as catalogs index it: Spotify's "(feat. Nigo)", "[with X]" and
    "- 2011 Remaster" suffixes make MusicBrainz and Deezer searches miss. */
export function searchTitle(title: string): string {
  return (
    title
      .replace(/\s*[([](?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi, "")
      .replace(/\s+-\s+(?:feat\.?|ft\.?|featuring)\s.*$/i, "")
      .replace(/\s+-\s+(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?$/i, "")
      .trim() || title.trim()
  );
}

/** "Pusha T, Nigo" / "A feat. B" -> the first credited artist. Spotify joins
    several artists with commas; "&" is left alone (Simon & Garfunkel is one act). */
export function primaryArtist(artistName: string | null): string | null {
  if (!artistName) return null;
  const first = artistName.split(/,|\s(?:feat\.?|ft\.?|featuring)\s/i)[0]?.trim();
  return first || null;
}

export type CatalogMeta = {
  isrc: string | null;
  bpm: number | null;
  releaseDate: number | null;
  genre: string | null;
  album: string | null;
};

type DeezerTrack = {
  isrc?: unknown;
  bpm?: unknown;
  release_date?: unknown;
  album?: { title?: unknown };
};
type DeezerAlbum = { genres?: { data?: { name?: unknown }[] }; release_date?: unknown };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Deezer's public track + album objects -> the fields Pulse keeps. Deezer
    reports an unknown tempo as 0 and an unknown date as "0000-00-00". */
export function deezerMeta(track: DeezerTrack, album?: DeezerAlbum | null): CatalogMeta {
  const isrc = str(track.isrc);
  const bpm = typeof track.bpm === "number" && track.bpm > 0 ? Math.round(track.bpm) : null;
  const date = str(track.release_date) ?? str(album?.release_date);
  const parsed = date && !date.startsWith("0000") ? Date.parse(date) : NaN;
  return {
    isrc: isrc && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(isrc) ? isrc.toUpperCase() : null,
    bpm,
    releaseDate: Number.isFinite(parsed) ? parsed : null,
    genre: str(album?.genres?.data?.[0]?.name),
    album: str(track.album?.title),
  };
}

/** Genius credit label -> split-sheet role, or null for labels, publishers,
    copyright lines and other non-people credits. */
export function geniusRole(label: string): string | null {
  const t = label.toLowerCase();
  // "Recorded At" / "Mastered At" name a place, not a person.
  if (/\bat$|label|publisher|copyright|phonographic|distribut|a&r|management|artwork|photograph|video/.test(t)) return null;
  if (t.includes("writ") || t.includes("compos") || t.includes("lyric")) return "Writer";
  if (t.includes("mix")) return "Mix Engineer";
  if (t.includes("master")) return "Mastering Engineer";
  if (t.includes("produc")) return "Producer";
  if (t.includes("engineer") || t.includes("record")) return "Engineer";
  if (t.includes("vocal")) return "Vocalist";
  if (/guitar|bass|drum|keys|keyboard|piano|synth|horn|string|percussion|instrument/.test(t)) return "Musician";
  return null;
}

type GeniusArtist = { name?: unknown };
type GeniusSong = {
  writer_artists?: GeniusArtist[];
  producer_artists?: GeniusArtist[];
  custom_performances?: { label?: unknown; artists?: GeniusArtist[] }[];
};

/** A Genius /songs/:id payload -> credits. Writers and producers come from
    their own lists; engineers, mixers and players from custom_performances. */
export function geniusCredits(song: GeniusSong): ImportedCredit[] {
  const out: ImportedCredit[] = [];
  const add = (artists: GeniusArtist[] | undefined, role: string) => {
    for (const a of artists ?? []) {
      const name = str(a.name);
      if (name) out.push({ name, role });
    }
  };
  add(song.writer_artists, "Writer");
  add(song.producer_artists, "Producer");
  for (const p of song.custom_performances ?? []) {
    const role = typeof p.label === "string" ? geniusRole(p.label) : null;
    if (role) add(p.artists, role);
  }
  return dedupeCredits(out);
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

/** Pick the Genius search hit for this exact song: the title must match after
    cleanup, and the primary artist must appear in the hit's artist line. */
export function pickGeniusHit(
  hits: { result?: { id?: unknown; title?: unknown; primary_artist?: { name?: unknown }; artist_names?: unknown } }[],
  title: string,
  artist: string | null,
): number | null {
  const want = norm(searchTitle(title));
  const who = artist ? norm(artist) : null;
  for (const h of hits) {
    const r = h.result;
    if (typeof r?.id !== "number" || typeof r.title !== "string") continue;
    if (norm(searchTitle(r.title)) !== want) continue;
    const names = norm(`${str(r.artist_names) ?? ""} ${str(r.primary_artist?.name) ?? ""}`);
    if (who && !names.includes(who)) continue;
    return r.id;
  }
  return null;
}

/** Pick the Deezer search hit for this song: same cleaned title, and the
    primary artist matches the hit's artist. Plain search returns covers and
    karaoke versions too, so a loose first hit is never trusted. */
export function pickDeezerHit(
  hits: { id?: unknown; title?: unknown; artist?: { name?: unknown } }[],
  title: string,
  artist: string | null,
): number | null {
  const want = norm(searchTitle(title));
  const who = artist ? norm(artist) : null;
  for (const h of hits) {
    if (typeof h.id !== "number" || typeof h.title !== "string") continue;
    if (norm(searchTitle(h.title)) !== want) continue;
    if (who && norm(str(h.artist?.name) ?? "") !== who) continue;
    return h.id;
  }
  return null;
}
