import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/* Sync placements: create, drill-down edit (updateSync), and drag-restage
   (moveSyncStage). Demo viewer resolves to a pulse-demo studio owner. */
describe("licensing - sync placements", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active" });
    });
  });

  async function makeSong() {
    return t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: "pulse-demo", name: "Nova", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      return ctx.db.insert("songs", {
        orgId: "pulse-demo", title: "Stillframe", artistId, kind: "single", stage: "mixing",
        moodTags: [], referenceTracks: [], revisionsIncluded: 3, revisionsUsed: 0,
      });
    });
  }

  it("updateSync edits details + moveSyncStage restages; board reflects both", async () => {
    const songId = await makeSong();
    const id = await t.mutation(api.licensing.createSync, {
      songId, supervisorName: "Dana Whitfield", outlet: "Documentary", feeCents: 250000,
    });

    await t.mutation(api.licensing.updateSync, {
      id, supervisorName: "Dana W.", outlet: "Trailer - feature", feeCents: 500000, notes: "Loved the hook.",
    });
    await t.mutation(api.licensing.moveSyncStage, { id, stage: "shortlisted" });

    const board = await t.query(api.licensing.syncBoard, {});
    const row = board.find((b) => b._id === id)!;
    expect(row.supervisorName).toBe("Dana W.");
    expect(row.outlet).toBe("Trailer - feature");
    expect(row.feeCents).toBe(500000);
    expect(row.notes).toBe("Loved the hook.");
    expect(row.stage).toBe("shortlisted");
    expect(row.songTitle).toBe("Stillframe");
  });
});
