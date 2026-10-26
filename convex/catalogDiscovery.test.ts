import { describe, it, expect, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { appleTrack } from "./lib/catalogEnrich";

/* Catalog Import reads every source: the person picks one Genius profile,
   and discovery also finds them at MusicBrainz, Apple Music and Deezer by
   name, keeps only the profiles whose songs overlap, and merges the songs
   into one list with no duplicates. */

const GENIUS_SONGS = [
  { id: 11, title: "Blue Room", primary_artist: { name: "Lena Vox" }, song_art_image_url: "https://genius/blue.jpg" },
  { id: 12, title: "Night Drive", primary_artist: { name: "Lena Vox" } },
];

function route(url: string): unknown {
  const u = new URL(url);
  const p = u.pathname;
  if (u.host === "api.genius.com" && p === "/artists/1/songs") return { response: { songs: GENIUS_SONGS, next_page: null } };
  if (u.host === "musicbrainz.org" && p === "/ws/2/artist/") return { artists: [{ id: "mb-1", name: "Lena Vox", score: 100 }] };
  if (u.host === "musicbrainz.org" && p === "/ws/2/recording") {
    return {
      recordings: [
        { id: "r1", title: "Blue Room", isrcs: ["USABC2600001"], "artist-credit": [{ name: "Lena Vox" }] },
        { id: "r2", title: "Lost Tape", "artist-credit": [{ name: "Lena Vox" }] },
      ],
    };
  }
  if (u.host === "itunes.apple.com" && p === "/search") {
    // Two Apple artists share the name; only 78 is her.
    return { results: [{ artistId: 77, artistName: "Lena Vox" }, { artistId: 78, artistName: "Lena Vox" }, { artistId: 79, artistName: "Lena Voxx" }] };
  }
  if (u.host === "itunes.apple.com" && p === "/lookup") {
    const id = u.searchParams.get("id");
    if (id === "77") return { results: [{ wrapperType: "track", trackId: 1, trackName: "Stranger Song", artistName: "Lena Vox" }] };
    if (id === "78") {
      return {
        results: [
          { wrapperType: "track", trackId: 2, trackName: "Blue Room", artistName: "Lena Vox", releaseDate: "2024-03-01T00:00:00Z" },
          { wrapperType: "track", trackId: 3, trackName: "Apple Exclusive", artistName: "Lena Vox" },
        ],
      };
    }
  }
  if (u.host === "api.deezer.com" && p === "/search/artist") return { data: [{ id: 5, name: "Lena Vox", nb_fan: 10 }] };
  if (u.host === "api.deezer.com" && p === "/artist/5/top") return { data: [] };
  if (u.host === "api.deezer.com" && p === "/artist/5/albums") return { data: [{ id: 900 }] };
  if (u.host === "api.deezer.com" && p === "/album/900") {
    return { title: "Drive", release_date: "2023-05-05", artist: { name: "Lena Vox" }, tracks: { data: [{ id: 31, title: "Night Drive", artist: { name: "Lena Vox" } }] } };
  }
  return null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("runDiscovery", () => {
  it("searches every source from one Genius pick, skips a same-name stranger, and merges duplicates", async () => {
    vi.stubEnv("GENIUS_ACCESS_TOKEN", "test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = route(url);
        return { ok: body !== null, status: body === null ? 404 : 200, json: async () => body };
      }),
    );
    const t = convexTest(schema);
    const importId = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "o1", name: "o1", slug: "o1", tier: "growth", status: "active" });
      const memberId = await ctx.db.insert("members", { orgId: "o1", name: "Lena", role: "owner", skills: [], clerkUserId: "u" });
      const identityId = await ctx.db.insert("creditIdentities", {
        orgId: "o1", subjectKind: "member", subjectId: memberId, source: "genius", sourceId: "1", name: "Lena Vox", createdAt: 0,
      });
      return ctx.db.insert("catalogImports", {
        orgId: "o1", subjectKind: "member", subjectId: memberId, identityIds: [identityId], roles: ["Artist"],
        status: "discovering", found: 0, imported: 0, merged: 0, failed: 0, skipped: 0, capped: 0, startedBy: "u", startedAt: 0,
      });
    });

    await t.action(internal.catalogImport.runDiscovery, { importId });

    const { job, items, identities } = await t.run(async (ctx) => {
      const job = (await ctx.db.get(importId))!;
      const items = await ctx.db.query("catalogImportItems").collect();
      const identities = await Promise.all(job.identityIds.map((id) => ctx.db.get(id)));
      return { job, items, identities };
    });
    expect(job.status).toBe("importing");
    expect(identities.map((i) => `${i!.source}:${i!.sourceId}`).sort()).toEqual([
      "apple:78",
      "deezer:5",
      "genius:1",
      "musicbrainz:mb-1",
    ]);
    const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
    expect(Object.keys(byTitle).sort()).toEqual(["Apple Exclusive", "Blue Room", "Lost Tape", "Night Drive"]);
    expect(job.found).toBe(4);
    // One Blue Room from three sources: Genius art, MusicBrainz ISRC.
    expect(byTitle["Blue Room"]).toMatchObject({
      coverUrl: "https://genius/blue.jpg",
      isrc: "USABC2600001",
      sources: ["genius", "musicbrainz", "apple"],
      refs: { geniusSongId: 11, mbRecordingId: "r1", appleTrackId: 2 },
    });
    expect(byTitle["Night Drive"].sources).toEqual(["genius", "deezer"]);
  }, 20_000);
});

describe("appleTrack (the backup for art, album, release and genre)", () => {
  it("takes the hit with the same title and primary artist, not the first one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          results: [
            { wrapperType: "track", trackName: "Blue Room", artistName: "Cover Band", collectionName: "Wrong" },
            { wrapperType: "track", trackName: "Blue Room (feat. Ky)", artistName: "Lena Vox, Ky", collectionName: "Right", primaryGenreName: "R&B/Soul", releaseDate: "2024-03-01T00:00:00Z", artworkUrl100: "https://is1.mzstatic.com/a/100x100bb.jpg" },
          ],
        }),
      })),
    );
    const hit = await appleTrack(undefined, "Blue Room", "Lena Vox");
    expect(hit).toMatchObject({ album: "Right", genre: "R&B/Soul", releaseDate: Date.UTC(2024, 2, 1) });
    expect(hit?.coverUrl).toContain("600x600");
    expect(await appleTrack(undefined, "Blue Room", "Nobody")).toBeNull();
  });
});
