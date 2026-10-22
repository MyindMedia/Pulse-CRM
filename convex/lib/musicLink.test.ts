import { describe, it, expect } from "vitest";
import {
  parseMusicLink,
  upscaleAppleArt,
  creditRole,
  dedupeCredits,
  buildContributors,
  metaContent,
  artistFromSpotifyDescription,
  searchTitle,
  primaryArtist,
  deezerMeta,
  geniusCredits,
  pickGeniusHit,
  pickDeezerHit,
} from "./musicLink";

describe("parseMusicLink", () => {
  it("recognizes Spotify track links, including intl paths", () => {
    expect(parseMusicLink("https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp")).toEqual({
      provider: "spotify", kind: "track", id: "3n3Ppam7vgaVa1iaRUc9Lp",
    });
    expect(
      parseMusicLink("https://open.spotify.com/intl-de/track/3n3Ppam7vgaVa1iaRUc9Lp?si=abc"),
    ).toMatchObject({ provider: "spotify", id: "3n3Ppam7vgaVa1iaRUc9Lp" });
  });

  it("recognizes Apple Music album-track and song links", () => {
    expect(
      parseMusicLink("https://music.apple.com/us/album/hello/123456789?i=987654321"),
    ).toEqual({ provider: "apple", kind: "track", id: "987654321", country: "us" });
    expect(parseMusicLink("https://music.apple.com/gb/song/hello/555")).toEqual({
      provider: "apple", kind: "track", id: "555", country: "gb",
    });
    expect(parseMusicLink("https://music.apple.com/us/album/hello/123456789")).toEqual({
      provider: "apple", kind: "album", id: "123456789", country: "us",
    });
  });

  it("rejects everything else", () => {
    expect(parseMusicLink("https://youtube.com/watch?v=x")).toBeNull();
    expect(parseMusicLink("not a url")).toBeNull();
    expect(parseMusicLink("https://open.spotify.com/playlist/xyz")).toBeNull();
  });
});

describe("art + meta helpers", () => {
  it("upscales Apple artwork URLs in place", () => {
    expect(upscaleAppleArt("https://is1-ssl.mzstatic.com/image/thumb/a/100x100bb.jpg")).toBe(
      "https://is1-ssl.mzstatic.com/image/thumb/a/600x600bb.jpg",
    );
  });

  it("reads og meta tags in either attribute order", () => {
    const html = `<meta property="og:title" content="Song &amp; Dance"/>` +
      `<meta content="https://img/x.jpg" property="og:image"/>`;
    expect(metaContent(html, "og:title")).toBe("Song & Dance");
    expect(metaContent(html, "og:image")).toBe("https://img/x.jpg");
    expect(metaContent(html, "og:nope")).toBeNull();
  });

  it("pulls the artist from Spotify's og:description", () => {
    expect(artistFromSpotifyDescription("Kendrick Lamar · Song · 2024")).toBe("Kendrick Lamar");
    expect(artistFromSpotifyDescription("")).toBeNull();
  });
});

describe("credits -> contributors", () => {
  it("maps MusicBrainz relation types onto sheet roles", () => {
    expect(creditRole("composer")).toBe("Writer");
    expect(creditRole("Producer")).toBe("Producer");
    expect(creditRole("mix")).toBe("Mix Engineer");
    expect(creditRole("release")).toBeNull();
  });

  it("dedupes people and merges their roles, writers first", () => {
    const merged = dedupeCredits([
      { name: "Mix Max", role: "Mix Engineer" },
      { name: "Jo Writer", role: "Writer" },
      { name: "jo writer", role: "Producer" },
    ]);
    expect(merged).toEqual([
      { name: "Jo Writer", role: "Writer / Producer" },
      { name: "Mix Max", role: "Mix Engineer" },
    ]);
  });

  it("builds a balanced sheet with the primary artist included", () => {
    const rows = buildContributors(
      [
        { name: "Jo Writer", role: "Writer" },
        { name: "Pro Ducer", role: "Producer" },
      ],
      "Nova Reign",
    );
    expect(rows.map((r) => r.name)).toEqual(["Nova Reign", "Jo Writer", "Pro Ducer"]);
    expect(rows.reduce((s, r) => s + r.masterPct, 0)).toBe(100);
    expect(rows.reduce((s, r) => s + r.publishingPct, 0)).toBe(100);
    expect(rows[0].masterPct).toBe(34); // remainder lands on the first row
    expect(rows.every((r) => r.signed === false)).toBe(true);
  });

  it("doesn't duplicate the primary artist when already credited", () => {
    const rows = buildContributors([{ name: "Nova Reign", role: "Writer" }], "nova reign");
    expect(rows).toHaveLength(1);
    expect(rows[0].masterPct).toBe(100);
  });

  it("returns empty for no credits and no artist", () => {
    expect(buildContributors([])).toEqual([]);
  });
});

describe("catalog lookup helpers", () => {
  it("cleans Spotify titles to the name catalogs index", () => {
    expect(searchTitle("Hear Me Clearly (feat. Nigo)")).toBe("Hear Me Clearly");
    expect(searchTitle("Song [with Someone]")).toBe("Song");
    expect(searchTitle("Track - feat. B")).toBe("Track");
    expect(searchTitle("Old Hit - 2011 Remaster")).toBe("Old Hit");
    expect(searchTitle("Old Hit - Remastered 2009")).toBe("Old Hit");
    expect(searchTitle("Hello (Remix)")).toBe("Hello (Remix)");
  });

  it("takes the first credited artist", () => {
    expect(primaryArtist("Pusha T, Nigo")).toBe("Pusha T");
    expect(primaryArtist("A feat. B")).toBe("A");
    expect(primaryArtist("Simon & Garfunkel")).toBe("Simon & Garfunkel");
    expect(primaryArtist(null)).toBeNull();
  });

  it("maps Deezer's track and album to Pulse fields", () => {
    const meta = deezerMeta(
      { isrc: "usum72202697", bpm: 0, release_date: "2022-04-22", album: { title: "It's Almost Dry" } },
      { genres: { data: [{ name: "Rap/Hip Hop" }] } },
    );
    expect(meta).toEqual({
      isrc: "USUM72202697",
      bpm: null,
      releaseDate: Date.parse("2022-04-22"),
      genre: "Rap/Hip Hop",
      album: "It's Almost Dry",
    });
    expect(deezerMeta({ bpm: 92.6, release_date: "0000-00-00", isrc: "nope" })).toMatchObject({
      bpm: 93,
      releaseDate: null,
      isrc: null,
    });
  });

  it("turns Genius credits into split-sheet roles and skips non-people", () => {
    const credits = geniusCredits({
      writer_artists: [{ name: "Pusha T" }, { name: "Pharrell Williams" }],
      producer_artists: [{ name: "Pharrell Williams" }],
      custom_performances: [
        { label: "Mixing Engineer", artists: [{ name: "Manny Marroquin" }] },
        { label: "Mastering Engineer", artists: [{ name: "Mike Dean" }] },
        { label: "Recorded At", artists: [{ name: "Some Studio" }] },
        { label: "Label", artists: [{ name: "GOOD Music" }] },
        { label: "Publisher", artists: [{ name: "Sony" }] },
      ],
    });
    expect(credits).toEqual([
      { name: "Pusha T", role: "Writer" },
      { name: "Pharrell Williams", role: "Writer / Producer" },
      { name: "Manny Marroquin", role: "Mix Engineer" },
      { name: "Mike Dean", role: "Mastering Engineer" },
    ]);
  });

  it("only accepts a Genius hit with the same title and artist", () => {
    const hits = [
      { result: { id: 1, title: "Hear Me Clearly (Remix)", artist_names: "Pusha T" } },
      { result: { id: 2, title: "Hear Me Clearly", artist_names: "Someone Else" } },
      { result: { id: 3, title: "Hear Me Clearly", artist_names: "Pusha T & NIGO" } },
    ];
    expect(pickGeniusHit(hits, "Hear Me Clearly (feat. Nigo)", "Pusha T")).toBe(3);
    expect(pickGeniusHit(hits, "Other Song", "Pusha T")).toBeNull();
  });

  it("only accepts a Deezer hit with the same title and primary artist", () => {
    const hits = [
      { id: 1, title: "Blinding Lights (Karaoke)", artist: { name: "The Weeknd" } },
      { id: 2, title: "Blinding Lights", artist: { name: "Cover Band" } },
      { id: 3, title: "Blinding Lights", artist: { name: "The Weeknd" } },
    ];
    expect(pickDeezerHit(hits, "Blinding Lights", "The Weeknd")).toBe(3);
    expect(pickDeezerHit(hits, "Blinding Lights", "Nobody")).toBeNull();
  });
});
