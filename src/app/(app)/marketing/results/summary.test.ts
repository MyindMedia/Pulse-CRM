import { describe, it, expect } from "vitest";
import { summarizeResults, type ResultRow } from "./summary";

function row(overrides: Partial<ResultRow> & { postId: string }): ResultRow {
  return { clicks: 0, bookings: 0, revenueCents: 0, redemptions: 0, ...overrides };
}

describe("summarizeResults", () => {
  it("returns zeroed totals and no top post for an empty range", () => {
    expect(summarizeResults([])).toEqual({
      postCount: 0,
      totalClicks: 0,
      totalBookings: 0,
      totalRevenueCents: 0,
      totalRedemptions: 0,
      topPostId: null,
    });
  });

  it("sums clicks, bookings, revenue and redemptions across every post", () => {
    const rows = [
      row({ postId: "a", clicks: 6, bookings: 0, revenueCents: 0, redemptions: 0 }),
      row({ postId: "b", clicks: 0, bookings: 1, revenueCents: 20000, redemptions: 1 }),
    ];
    expect(summarizeResults(rows)).toMatchObject({
      postCount: 2,
      totalClicks: 6,
      totalBookings: 1,
      totalRevenueCents: 20000,
      totalRedemptions: 1,
    });
  });

  it("picks the post with the most attributed activity as the top post", () => {
    const rows = [
      row({ postId: "quiet", clicks: 0 }),
      row({ postId: "winner", clicks: 6 }),
    ];
    expect(summarizeResults(rows).topPostId).toBe("winner");
  });

  it("weighs bookings and redemptions the same as clicks, so a lower-click post with real conversions can still lead", () => {
    const rows = [
      row({ postId: "clicky", clicks: 3 }),
      row({ postId: "converted", clicks: 2, bookings: 1, redemptions: 1 }),
    ];
    expect(summarizeResults(rows).topPostId).toBe("converted");
  });

  it("declares no top post when every post scored zero, so a real zero is never dressed up as a leader", () => {
    const rows = [row({ postId: "a" }), row({ postId: "b" })];
    expect(summarizeResults(rows).topPostId).toBeNull();
  });

  it("keeps the single post as top when it is the only one with any activity", () => {
    const rows = [row({ postId: "only", clicks: 1 })];
    expect(summarizeResults(rows).topPostId).toBe("only");
  });
});
