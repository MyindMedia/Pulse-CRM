import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { buildRightsPacket, contributorsCsv, type PacketContributor } from "./rightsExport";

const ORG = "pulse-demo";

const two = (over1: Partial<PacketContributor> = {}, over2: Partial<PacketContributor> = {}): PacketContributor[] => [
  { name: "A", role: "Writer", masterPct: 50, publishingPct: 50, signed: true, ...over1 },
  { name: "B", role: "Producer", masterPct: 50, publishingPct: 50, signed: true, ...over2 },
];

describe("rights packet (pure)", () => {
  it("flags release-ready when everything checks out", () => {
    const p = buildRightsPacket({
      title: "Track", primaryArtist: "Nova", kind: "single",
      isrc: "USABC2500001", iswc: "T-123.456.789-0", sheetStatus: "fully_executed",
      contributors: two(),
    });
    expect(p.validation.releaseReady).toBe(true);
    expect(p.warnings).toHaveLength(0);
  });

  it("warns and blocks when splits do not total 100", () => {
    const p = buildRightsPacket({
      title: "Track", primaryArtist: "Nova", kind: "single",
      isrc: "X", iswc: "Y", sheetStatus: "fully_executed",
      contributors: two({ masterPct: 40 }),
    });
    expect(p.validation.mastersBalanced).toBe(false);
    expect(p.validation.releaseReady).toBe(false);
    expect(p.warnings.some((w) => w.includes("Master split"))).toBe(true);
  });

  it("warns on missing ISRC/ISWC, unsigned, and undelivered sheet", () => {
    const p = buildRightsPacket({
      title: "Track", primaryArtist: "Nova", kind: "single",
      sheetStatus: "draft", contributors: two({ signed: false }),
    });
    expect(p.validation.hasIsrc).toBe(false);
    expect(p.validation.hasIswc).toBe(false);
    expect(p.validation.allSigned).toBe(false);
    expect(p.validation.sheetExecuted).toBe(false);
    expect(p.warnings.length).toBeGreaterThanOrEqual(4);
  });

  it("renders a CSV with a header and escaped fields", () => {
    const csv = contributorsCsv([{ name: "Last, First", role: "Writer", masterPct: 100, publishingPct: 100, pro: "ASCAP", ipi: "123", signed: true }]);
    const [header, row] = csv.split("\n");
    expect(header).toBe("Name,Role,Master %,Publishing %,PRO,IPI,Signed");
    expect(row).toContain('"Last, First"');
    expect(row).toContain("ASCAP");
    expect(row.endsWith("yes")).toBe(true);
  });
});

describe("rights packet query", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { vi.useFakeTimers(); t = convexTest(schema); });
  afterEach(() => { vi.useRealTimers(); });

  it("builds a packet from the song + its split sheet", async () => {
    const songId = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Nova", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const songId = await ctx.db.insert("songs", {
        orgId: ORG, title: "Skyline", artistId, kind: "single", stage: "released",
        moodTags: [], referenceTracks: [], revisionsIncluded: 2, revisionsUsed: 0,
        isrc: "USABC2500001", iswc: "T-123.456.789-0",
      });
      await ctx.db.insert("splitSheets", {
        orgId: ORG, songId, status: "fully_executed", updatedAt: Date.now(),
        contributors: [
          { name: "Nova", role: "Writer", masterPct: 60, publishingPct: 60, signed: true },
          { name: "Mix Guy", role: "Producer", masterPct: 40, publishingPct: 40, signed: true },
        ],
      });
      return songId;
    });

    const p = await t.query(api.rightsExport.packet, { songId });
    expect(p).not.toBeNull();
    expect(p!.song.title).toBe("Skyline");
    expect(p!.validation.releaseReady).toBe(true);
    expect(p!.contributors).toHaveLength(2);
    expect(p!.csv.split("\n")).toHaveLength(3); // header + 2 rows
  });
});
