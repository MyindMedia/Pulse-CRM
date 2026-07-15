import { describe, it, expect } from "vitest";
import {
  parseMusicLink,
  upscaleAppleArt,
  creditRole,
  dedupeCredits,
  buildContributors,
  metaContent,
  artistFromSpotifyDescription,
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
