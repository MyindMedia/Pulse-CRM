import { describe, it, expect } from "vitest";
import {
  parseArtistLink,
  mbRelRole,
  mergeCandidates,
  geniusSongRoles,
  holdsChosenRole,
  parseReleaseDate,
  cleanIsrc,
  type Candidate,
} from "./catalogMerge";

const c = (over: Partial<Candidate>): Candidate => ({ title: "Song", roles: [], sources: [], refs: {}, ...over });

describe("parseArtistLink", () => {
  it("reads Spotify, Apple Music and TIDAL artist pages", () => {
    expect(parseArtistLink("https://open.spotify.com/artist/0Y5tJX1MQlPlqiwlOH1tJY?si=x")).toEqual({ provider: "spotify", id: "0Y5tJX1MQlPlqiwlOH1tJY" });
    expect(parseArtistLink("https://open.spotify.com/intl-de/artist/abc123")).toEqual({ provider: "spotify", id: "abc123" });
    expect(parseArtistLink("https://music.apple.com/gb/artist/travis-scott/549236696")).toEqual({ provider: "apple", id: "549236696", country: "gb" });
    expect(parseArtistLink("https://tidal.com/browse/artist/3528326")).toEqual({ provider: "tidal", id: "3528326" });
    expect(parseArtistLink("https://listen.tidal.com/artist/3528326")).toEqual({ provider: "tidal", id: "3528326" });
  });
  it("rejects tracks, albums and other sites", () => {
    expect(parseArtistLink("https://open.spotify.com/track/abc")).toBeNull();
    expect(parseArtistLink("https://music.apple.com/us/album/x/123")).toBeNull();
    expect(parseArtistLink("https://example.com/artist/1")).toBeNull();
    expect(parseArtistLink("not a url")).toBeNull();
  });
});

describe("mbRelRole", () => {
  it("maps recording and work relationship types to Credit Roles", () => {
    expect(mbRelRole("producer")).toBe("Producer");
    expect(mbRelRole("mix")).toBe("Mix Engineer");
    expect(mbRelRole("mastering")).toBe("Mastering Engineer");
    expect(mbRelRole("recording")).toBe("Engineer");
    expect(mbRelRole("composer")).toBe("Writer");
    expect(mbRelRole("lyricist")).toBe("Writer");
    expect(mbRelRole("instrument")).toBe("Musician");
    expect(mbRelRole("vocal")).toBe("Vocalist");
    expect(mbRelRole("arranger")).toBeNull();
  });
});

describe("mergeCandidates", () => {
  it("merges by ISRC first, keeping every role and source", () => {
    const { items } = mergeCandidates([
      c({ title: "SICKO MODE", artistName: "Travis Scott", isrc: "USSM11806411", roles: ["Producer"], sources: ["musicbrainz"] }),
      c({ title: "Sicko Mode (feat. Drake)", artistName: "Travis Scott, Drake", isrc: "USSM11806411", roles: ["Mix Engineer"], sources: ["deezer"], coverUrl: "x" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].roles).toEqual(["Producer", "Mix Engineer"]);
    expect(items[0].sources).toEqual(["musicbrainz", "deezer"]);
    expect(items[0].coverUrl).toBe("x");
  });

  it("then by cleaned title plus primary artist", () => {
    const { items } = mergeCandidates([
      c({ title: "Mercy", artistName: "Kanye West", roles: ["Producer"] }),
      c({ title: "Mercy (feat. Big Sean)", artistName: "Kanye West, Big Sean", roles: ["Writer"] }),
      c({ title: "Mercy", artistName: "Shawn Mendes", roles: ["Producer"] }),
    ]);
    expect(items.map((i) => `${i.title}/${i.artistName}`)).toEqual(["Mercy/Kanye West", "Mercy/Shawn Mendes"]);
    expect(items[0].roles).toEqual(["Producer", "Writer"]);
  });

  it("an artist-less credit joins the one song with its title, never an ambiguous one", () => {
    const one = mergeCandidates([
      c({ title: "Stronger", artistName: "Kanye West", roles: ["Producer"] }),
      c({ title: "Stronger", roles: ["Mix Engineer"], refs: { mbRecordingId: "r1" } }),
    ]);
    expect(one.items).toHaveLength(1);
    expect(one.items[0].refs.mbRecordingId).toBe("r1");
    const two = mergeCandidates([
      c({ title: "Home", artistName: "A" }),
      c({ title: "Home", artistName: "B" }),
      c({ title: "Home", roles: ["Writer"] }),
    ]);
    expect(two.items).toHaveLength(3);
  });

  it("caps at 500 and counts what was left out", () => {
    const many = Array.from({ length: 620 }, (_, i) => c({ title: `Track ${i}`, artistName: "X" }));
    const { items, capped } = mergeCandidates(many);
    expect(items).toHaveLength(500);
    expect(capped).toBe(120);
  });
});

describe("geniusSongRoles", () => {
  const song = {
    primary_artist: { id: 1, name: "Travis Scott" },
    featured_artists: [{ id: 2, name: "Drake" }],
    writer_artists: [{ id: 1 }, { id: 3 }],
    producer_artists: [{ id: 3 }, { id: 4 }],
    custom_performances: [
      { label: "Mixing Engineer", artists: [{ id: 4 }] },
      { label: "Recorded At", artists: [{ id: 4 }] },
    ],
  };
  it("reads each role the artist holds on the song", () => {
    expect(geniusSongRoles(song, 1).sort()).toEqual(["Artist", "Writer"]);
    expect(geniusSongRoles(song, 2)).toEqual(["Artist"]);
    expect(geniusSongRoles(song, 4).sort()).toEqual(["Mix Engineer", "Producer"]);
    expect(geniusSongRoles(song, 99)).toEqual([]);
  });
  it("keeps a song only when a chosen role is held", () => {
    expect(holdsChosenRole(["Mix Engineer", "Producer"], ["Producer"])).toBe(true);
    expect(holdsChosenRole(["Vocalist"], ["Producer"])).toBe(false);
  });
});

describe("parsing", () => {
  it("release dates in the shapes the sources use", () => {
    expect(parseReleaseDate("2018-08-03")).toBe(Date.UTC(2018, 7, 3));
    expect(parseReleaseDate("2018")).toBe(Date.UTC(2018, 0, 1));
    expect(parseReleaseDate({ year: 2018, month: 8, day: 3 })).toBe(Date.UTC(2018, 7, 3));
    expect(parseReleaseDate("0000-00-00")).toBeUndefined();
    expect(parseReleaseDate(null)).toBeUndefined();
  });
  it("ISRCs", () => {
    expect(cleanIsrc("us-sm1-18-06411")).toBe("USSM11806411");
    expect(cleanIsrc("nope")).toBeUndefined();
  });
});
