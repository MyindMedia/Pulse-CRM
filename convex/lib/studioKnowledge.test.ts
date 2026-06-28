import { describe, it, expect } from "vitest";
import { bandFor, scoreFor, gradeMetric, rollUp, BENCHMARKS, type MetricGrade } from "./studioKnowledge";

describe("bandFor", () => {
  it("classifies a higher-is-better metric (utilization)", () => {
    expect(bandFor("utilization", 75)).toBe("top"); // >= 70
    expect(bandFor("utilization", 60)).toBe("healthy"); // >= 55
    expect(bandFor("utilization", 45)).toBe("warning"); // >= 40
    expect(bandFor("utilization", 20)).toBe("critical");
  });

  it("classifies a lower-is-better metric (no-show rate)", () => {
    expect(bandFor("noShowRate", 3)).toBe("top"); // <= 5
    expect(bandFor("noShowRate", 8)).toBe("healthy"); // <= 10
    expect(bandFor("noShowRate", 15)).toBe("warning"); // <= 20
    expect(bandFor("noShowRate", 30)).toBe("critical");
  });
});

describe("scoreFor", () => {
  it("anchors healthy at 70 and top at 100 for a higher metric", () => {
    expect(scoreFor("utilization", BENCHMARKS.utilization.healthy)).toBe(70);
    expect(scoreFor("utilization", BENCHMARKS.utilization.top)).toBe(100);
    expect(scoreFor("utilization", BENCHMARKS.utilization.warning)).toBe(45);
  });

  it("anchors healthy at 70 and top at 100 for a lower metric", () => {
    expect(scoreFor("noShowRate", BENCHMARKS.noShowRate.healthy)).toBe(70);
    expect(scoreFor("noShowRate", BENCHMARKS.noShowRate.top)).toBe(100);
    expect(scoreFor("noShowRate", BENCHMARKS.noShowRate.warning)).toBe(45);
  });

  it("clamps beyond the edges", () => {
    expect(scoreFor("utilization", 100)).toBe(100);
    expect(scoreFor("noShowRate", 0)).toBe(100);
    expect(scoreFor("utilization", 0)).toBe(0);
  });
});

describe("gradeMetric", () => {
  it("returns band, score, and a signed gap to healthy", () => {
    const g = gradeMetric("utilization", 45);
    expect(g.band).toBe("warning");
    expect(g.gapToHealthy).toBe(45 - BENCHMARKS.utilization.healthy); // negative => short
    expect(g.score).toBeGreaterThan(0);
    expect(g.lever).toContain("idle");
  });

  it("computes the gap correctly for a lower-is-better metric", () => {
    const g = gradeMetric("noShowRate", 25);
    // healthy is 10, value 25 -> 15 points worse, gap = healthy - value = -15
    expect(g.gapToHealthy).toBe(BENCHMARKS.noShowRate.healthy - 25);
    expect(g.band).toBe("critical");
  });
});

describe("rollUp", () => {
  it("defaults to a neutral healthy score with no graded metrics", () => {
    expect(rollUp([])).toEqual({ score: 70, band: "healthy" });
  });

  it("rolls perfect metrics up to a top band", () => {
    const grades: MetricGrade[] = [gradeMetric("utilization", 80), gradeMetric("noShowRate", 2)];
    const { score, band } = rollUp(grades);
    expect(score).toBe(100);
    expect(band).toBe("top");
  });

  it("weights move the score toward the weighted metric", () => {
    const strong = gradeMetric("utilization", 80); // score 100
    const weak = gradeMetric("collectionRate", 80); // below healthy => low score
    const even = rollUp([strong, weak]);
    const tiltWeak = rollUp([strong, weak], { collectionRate: 5 });
    expect(tiltWeak.score).toBeLessThan(even.score);
  });
});
