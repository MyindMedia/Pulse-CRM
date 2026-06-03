import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const ORG = "pulse-demo";

async function seedSong(t: ReturnType<typeof convexTest>, title = "Skyline") {
  return t.run(async (ctx) => {
    const artistId = await ctx.db.insert("artists", {
      orgId: ORG, name: "Nova", type: "artist", genres: [], tags: [],
      status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    return ctx.db.insert("songs", {
      orgId: ORG, title, artistId, kind: "single", stage: "mixing",
      moodTags: [], referenceTracks: [], revisionsIncluded: 2, revisionsUsed: 0,
    });
  });
}

async function activityKinds(t: ReturnType<typeof convexTest>, kind: string) {
  return t.run(async (ctx) =>
    (await ctx.db.query("activity").collect()).filter((a) => a.orgId === ORG && a.kind === kind),
  );
}

const fiftyFifty = [
  { name: "Alice", role: "Songwriter", masterPct: 50, publishingPct: 50, signed: false },
  { name: "Bob", role: "Producer", masterPct: 50, publishingPct: 50, signed: false },
];

describe("split-sheet logging for future records", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("rejects allocations that don't total 100% on both columns", async () => {
    const songId = await seedSong(t);
    await expect(
      t.mutation(api.splitSheets.upsert, {
        songId,
        contributors: [{ name: "Alice", role: "Writer", masterPct: 40, publishingPct: 50, signed: false }],
      }),
    ).rejects.toThrow(/100%/);
  });

  it("create logs split.created with a percentage snapshot", async () => {
    const songId = await seedSong(t);
    await t.mutation(api.splitSheets.upsert, { songId, contributors: fiftyFifty });

    const created = await activityKinds(t, "split.created");
    expect(created).toHaveLength(1);
    expect(created[0].summary).toContain("Skyline");
    expect(created[0].summary).toContain("Alice 50/50");
    expect(created[0].summary).toContain("Bob 50/50");
    expect(created[0].entityType).toBe("song");
    expect(created[0].entityId).toBe(songId);
  });

  it("changing the allocation logs split.updated with the new snapshot", async () => {
    const songId = await seedSong(t);
    await t.mutation(api.splitSheets.upsert, { songId, contributors: fiftyFifty });

    await t.mutation(api.splitSheets.upsert, {
      songId,
      contributors: [
        { name: "Alice", role: "Songwriter", masterPct: 60, publishingPct: 60, signed: false },
        { name: "Bob", role: "Producer", masterPct: 40, publishingPct: 40, signed: false },
      ],
    });

    const updated = await activityKinds(t, "split.updated");
    expect(updated).toHaveLength(1);
    expect(updated[0].summary).toContain("Alice 60/60");
    expect(updated[0].summary).toContain("Bob 40/40");
  });

  it("re-saving an identical allocation logs nothing new", async () => {
    const songId = await seedSong(t);
    await t.mutation(api.splitSheets.upsert, { songId, contributors: fiftyFifty });
    await t.mutation(api.splitSheets.upsert, { songId, contributors: fiftyFifty });

    expect(await activityKinds(t, "split.updated")).toHaveLength(0);
    expect(await activityKinds(t, "split.created")).toHaveLength(1);
  });

  it("forSong returns totals + balanced + allSigned", async () => {
    const songId = await seedSong(t);
    await t.mutation(api.splitSheets.upsert, { songId, contributors: fiftyFifty });

    const sheet = await t.query(api.splitSheets.forSong, { songId });
    expect(sheet).not.toBeNull();
    expect(sheet!.masterTotal).toBe(100);
    expect(sheet!.publishingTotal).toBe(100);
    expect(sheet!.balanced).toBe(true);
    expect(sheet!.allSigned).toBe(false);
  });

  it("a song with no sheet returns null", async () => {
    const songId = await seedSong(t);
    expect(await t.query(api.splitSheets.forSong, { songId })).toBeNull();
  });
});
