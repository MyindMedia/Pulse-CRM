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
  return [...byName.values()]
    .map((e) => ({ name: e.name, role: e.roles.join(" / ") }))
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
