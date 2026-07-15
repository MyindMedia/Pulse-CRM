import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const ORG = "pulse-demo"; // demo viewer resolves to this org with owner caps

async function seedSong(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const artistId = await ctx.db.insert("artists", {
      orgId: ORG, name: "Nova Reign", type: "artist", genres: [], tags: [],
      status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    const songId = await ctx.db.insert("songs", {
      orgId: ORG, title: "Skyline", artistId, kind: "single", stage: "writing",
      moodTags: [], referenceTracks: [], revisionsIncluded: 3, revisionsUsed: 0,
    });
    return { artistId, songId };
  });
}

const CREDITS = [
  { name: "Jo Writer", role: "Writer" },
  { name: "Pro Ducer", role: "Producer" },
];

describe("songImport.applyToSong", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("fills blank metadata, keeps provenance, and drafts the split sheet", async () => {
    const { songId } = await seedSong(t);

    const { sheetPrefilled } = await t.mutation(api.songImport.applyToSong, {
      songId, sourceUrl: "https://open.spotify.com/track/abc",
      genre: "R&B", releaseDate: 1700000000000, artistName: "Nova Reign", credits: CREDITS,
    });
    expect(sheetPrefilled).toBe(true);

    const { song, sheet } = await t.run(async (ctx) => ({
      song: await ctx.db.get(songId),
      sheet: (await ctx.db.query("splitSheets").collect()).find(
        (s) => s.songId === songId,
      ),
    }));
    expect(song!.genre).toBe("R&B");
    expect(song!.releaseDate).toBe(1700000000000);
    expect(song!.referenceTracks).toEqual([
      { title: "Imported source", url: "https://open.spotify.com/track/abc" },
    ]);
    expect(sheet!.status).toBe("draft");
    // Primary artist + both credited people, balanced to 100/100.
    expect(sheet!.contributors.map((c: { name: string }) => c.name)).toEqual([
      "Nova Reign", "Jo Writer", "Pro Ducer",
    ]);
    expect(sheet!.contributors.reduce((s: number, c: { masterPct: number }) => s + c.masterPct, 0)).toBe(100);
    expect(sheet!.contributors.reduce((s: number, c: { publishingPct: number }) => s + c.publishingPct, 0)).toBe(100);
  });

  it("never overwrites studio-entered metadata or an in-progress sheet", async () => {
    const { songId } = await seedSong(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(songId, { genre: "Trap" });
      await ctx.db.insert("splitSheets", {
        orgId: ORG, songId, status: "draft", updatedAt: Date.now(),
        contributors: [
          { name: "Studio Entry", role: "Writer", masterPct: 100, publishingPct: 100, signed: false },
        ],
      });
    });

    const { sheetPrefilled } = await t.mutation(api.songImport.applyToSong, {
      songId, sourceUrl: "https://x", genre: "R&B", credits: CREDITS,
    });
    expect(sheetPrefilled).toBe(false);

    const { song, sheets } = await t.run(async (ctx) => ({
      song: await ctx.db.get(songId),
      sheets: (await ctx.db.query("splitSheets").collect()).filter((s) => s.songId === songId),
    }));
    expect(song!.genre).toBe("Trap"); // studio value kept
    expect(sheets).toHaveLength(1);
    expect(sheets[0].contributors.map((c: { name: string }) => c.name)).toEqual(["Studio Entry"]);
  });

  it("fills an empty draft sheet and dedupes the source link", async () => {
    const { songId } = await seedSong(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("splitSheets", {
        orgId: ORG, songId, status: "draft", contributors: [], updatedAt: Date.now(),
      });
    });

    await t.mutation(api.songImport.applyToSong, {
      songId, sourceUrl: "https://x", credits: CREDITS,
    });
    const first = await t.mutation(api.songImport.applyToSong, {
      songId, sourceUrl: "https://x", credits: [],
    });
    expect(first.sheetPrefilled).toBe(false); // no credits second time

    const { song, sheet } = await t.run(async (ctx) => ({
      song: await ctx.db.get(songId),
      sheet: (await ctx.db.query("splitSheets").collect()).find(
        (s) => s.songId === songId,
      ),
    }));
    expect(sheet!.contributors.length).toBeGreaterThan(0);
    // The reference-track provenance was added exactly once.
    expect(song!.referenceTracks.filter((r: { url: string }) => r.url === "https://x")).toHaveLength(1);
  });

  it("rejects a song from another org", async () => {
    const songId = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: "org_other", name: "X", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      return ctx.db.insert("songs", {
        orgId: "org_other", title: "Theirs", artistId, kind: "single", stage: "writing",
        moodTags: [], referenceTracks: [], revisionsIncluded: 3, revisionsUsed: 0,
      });
    });
    await expect(
      t.mutation(api.songImport.applyToSong, {
        songId: songId as Id<"songs">, sourceUrl: "https://x", credits: CREDITS,
      }),
    ).rejects.toThrow();
  });
});
