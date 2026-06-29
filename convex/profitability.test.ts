import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import {
  computeMetricValues,
  buildReport,
  profitLeverCandidates,
  gatherProfitCounts,
  type RawCounts,
} from "./profitability";
import { gatherRiskFlags } from "./risk";

const NOW = 1_700_000_000_000;

/** A studio doing well across the board - every metric has enough data and
 *  sits at healthy or top. */
function healthy(): RawCounts {
  return {
    now: NOW,
    windowDays: 56,
    bookableRoomCount: 3,
    bookedHours: 900, // 900 / (3*56*8=1344) = ~67% util (healthy)
    avgRoomHourlyRateCents: 8000,
    scheduledInWindow: 50,
    noShowInWindow: 3, // 6% (healthy)
    avgSessionValueCents: 20000,
    compedSessionCount: 0,
    compedValueLossCents: 0,
    leadCount: 20,
    bookedLeadCount: 3, // 15% (top)
    depositConsidered: 40,
    depositPaidCount: 36, // 90% (top)
    unprotectedValueCents: 0,
    collectedCents: 95000,
    overdueCents: 5000, // 95% collection (healthy)
    openARCents: 10000,
    arOver30Cents: 1000, // 10% (top)
    clientsWithSession: 30,
    repeatClients: 12, // 40% (top)
    weightedPipelineCents: 300000,
    monthlyBookedCents: 100000, // coverage 3x (healthy)
    activeSongsWithBudget: 10,
    overBudgetSongs: 1, // 10% (healthy)
    nearReleaseSongs: 5,
    executedSplitSongs: 5, // 100% (top)
    unexecutedNearReleaseSongs: 0,
    engineerRevenueCents: [50000, 50000], // 50% concentration (healthy)
  };
}

describe("computeMetricValues", () => {
  it("grades every metric when data is sufficient", () => {
    const v = computeMetricValues(healthy());
    expect(Object.keys(v)).toHaveLength(11);
    expect(Math.round(v.utilization!)).toBe(67);
    expect(v.leadConversion).toBe(15);
    expect(v.pipelineCoverage).toBe(3);
    expect(v.concentrationRisk).toBe(50);
  });

  it("omits metrics whose denominator is too thin (never grades noise)", () => {
    const c = healthy();
    c.leadCount = 4; // below the >=5 floor
    c.scheduledInWindow = 2; // below the >=3 floor
    c.engineerRevenueCents = [50000]; // single engineer => no concentration
    const v = computeMetricValues(c);
    expect(v.leadConversion).toBeUndefined();
    expect(v.noShowRate).toBeUndefined();
    expect(v.concentrationRisk).toBeUndefined();
    expect(v.utilization).toBeDefined();
  });
});

describe("buildReport", () => {
  it("scores a healthy studio high with no levers", () => {
    const r = buildReport(healthy());
    expect(r.graded).toBe(11);
    expect(r.overall).toBeGreaterThanOrEqual(80);
    expect(["healthy", "top"]).toContain(r.band);
    expect(r.levers).toHaveLength(0);
  });

  it("surfaces a dollar-quantified lever for low utilization, weakest metric first", () => {
    const c = healthy();
    c.bookedHours = 300; // ~22% util (critical)
    const r = buildReport(c);
    expect(r.metrics[0].key).toBe("utilization"); // weakest sorts first
    const util = r.levers.find((l) => l.key === "utilization");
    expect(util).toBeDefined();
    expect(util!.band).toBe("critical");
    expect(util!.estImpactCents).toBeGreaterThan(0);
  });

  it("ranks critical levers ahead of warnings", () => {
    const c = healthy();
    c.bookedHours = 300; // utilization critical
    c.overBudgetSongs = 3; // 30% overage -> warning
    const r = buildReport(c);
    const idxUtil = r.levers.findIndex((l) => l.key === "utilization");
    const idxRev = r.levers.findIndex((l) => l.key === "revisionOverageRate");
    expect(idxUtil).toBeGreaterThanOrEqual(0);
    expect(idxRev).toBeGreaterThan(idxUtil);
  });
});

describe("profitLeverCandidates", () => {
  it("maps levers to note_only profit_improvement actions", () => {
    const c = healthy();
    c.bookedHours = 300;
    const cands = profitLeverCandidates(buildReport(c));
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0].type).toBe("profit_improvement");
    expect(cands[0].payload.kind).toBe("note_only");
    expect(cands[0].entityType).toBe("metric");
  });
});

/* ----------------------------------------------------------------
   Tenant isolation: the gather functions must read ONLY the orgId
   they are given. This is the non-negotiable invariant of the whole
   epic, so it gets a real two-org test.
   ---------------------------------------------------------------- */
describe("tenant isolation", () => {
  async function seedTwoOrgs() {
    const t = convexTest(schema);
    const ids = await t.run(async (ctx) => {
      const mkOrg = async (orgId: string, slug: string) =>
        ctx.db.insert("orgs", { orgId, name: slug, slug, plan: "studio", status: "active" });
      const mkArtist = async (orgId: string, name: string) =>
        ctx.db.insert("artists", {
          orgId, name, type: "artist", genres: [], tags: [], status: "active",
          lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
        });
      const mkRoom = async (orgId: string, name: string) =>
        ctx.db.insert("rooms", { orgId, name, status: "available", bookable: true, hourlyRateCents: 8000 });
      const mkSong = async (orgId: string, artistId: any, title: string) =>
        ctx.db.insert("songs", {
          orgId, title, artistId, kind: "single", stage: "mastering",
          moodTags: [], referenceTracks: [], revisionsIncluded: 3, revisionsUsed: 0,
        });

      await mkOrg("orgA", "A");
      await mkOrg("orgB", "B");
      // A: 2 rooms + a near-release song with NO executed split sheet.
      await mkRoom("orgA", "A-1");
      await mkRoom("orgA", "A-2");
      const aArtist = await mkArtist("orgA", "A Artist");
      const aSong = await mkSong("orgA", aArtist, "A Track");
      // B: 5 rooms + its own exposed song. Should never leak into A's reads.
      for (let i = 0; i < 5; i++) await mkRoom("orgB", `B-${i}`);
      const bArtist = await mkArtist("orgB", "B Artist");
      const bSong = await mkSong("orgB", bArtist, "B Track");
      return { aSong, bSong };
    });
    return { t, ...ids };
  }

  it("profitability gather counts only the caller org's rooms", async () => {
    const { t } = await seedTwoOrgs();
    await t.run(async (ctx) => {
      const a = await gatherProfitCounts(ctx, "orgA");
      const b = await gatherProfitCounts(ctx, "orgB");
      expect(a.bookableRoomCount).toBe(2);
      expect(b.bookableRoomCount).toBe(5);
    });
  });

  it("risk gather never references another org's entities", async () => {
    const { t, aSong, bSong } = await seedTwoOrgs();
    await t.run(async (ctx) => {
      const aFlags = await gatherRiskFlags(ctx, "orgA");
      const ids = aFlags.map((f) => f.entityId);
      expect(ids).toContain(aSong); // A's exposed split flagged
      expect(ids).not.toContain(bSong); // B's never appears in A's scan
    });
  });
});
