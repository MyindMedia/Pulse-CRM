import { describe, it, expect } from "vitest";
import { computeRange, DAY_MS, RANGE_OPTIONS } from "./range";

describe("computeRange", () => {
  // A fixed clock - every case below reads this, never `Date.now()`, so the
  // test can't be flaky and can't hide a regression behind whatever day it
  // happens to run on.
  const now = new Date("2026-08-27T18:00:00.000Z").getTime();

  it("computes the last 7 days ending at now", () => {
    expect(computeRange(now, 7)).toEqual({ from: now - 7 * DAY_MS, to: now });
  });

  it("computes the last 30 days ending at now", () => {
    expect(computeRange(now, 30)).toEqual({ from: now - 30 * DAY_MS, to: now });
  });

  it("computes the last 90 days ending at now", () => {
    expect(computeRange(now, 90)).toEqual({ from: now - 90 * DAY_MS, to: now });
  });

  it("always anchors `to` to exactly `now`, regardless of the range width", () => {
    for (const { days } of RANGE_OPTIONS) {
      expect(computeRange(now, days).to).toBe(now);
    }
  });

  it("widens `from` strictly as days grows, so a post inside the 7-day window is also inside 30 and 90", () => {
    const r7 = computeRange(now, 7);
    const r30 = computeRange(now, 30);
    const r90 = computeRange(now, 90);
    expect(r30.from).toBeLessThan(r7.from);
    expect(r90.from).toBeLessThan(r30.from);
    // A post that falls inside the narrowest window falls inside every wider
    // one too - the failure mode this guards against is a chip whose window
    // somehow excludes a post that a wider chip includes.
    const postPublishedAt = now - 6 * DAY_MS;
    expect(postPublishedAt).toBeGreaterThanOrEqual(r7.from);
    expect(postPublishedAt).toBeGreaterThanOrEqual(r30.from);
    expect(postPublishedAt).toBeGreaterThanOrEqual(r90.from);
  });
});
