import { describe, it, expect } from "vitest";
import { brandCardPath } from "./brandCardUrl";

/* Netlify's CDN keys its cache on path and drops the query string, so the
   old `?kind=...&v=...` shape let whichever kind was fetched first for a
   post win forever, and let `v` do nothing on an edit. Every one of these
   assertions is really the same claim: the path itself, not a query
   parameter, is the cache key now. */

describe("brandCardPath", () => {
  it("is stable for the same post, kind, and updatedAt", () => {
    const a = brandCardPath("post1", "promo", 1000);
    const b = brandCardPath("post1", "promo", 1000);
    expect(a).toBe(b);
  });

  it("changes when updatedAt changes, so an edited post gets a fresh URL", () => {
    const before = brandCardPath("post1", "promo", 1000);
    const after = brandCardPath("post1", "promo", 2000);
    expect(after).not.toBe(before);
  });

  it("gives each kind a distinct path for the same post and version", () => {
    const promo = brandCardPath("post1", "promo", 1000);
    const openSlot = brandCardPath("post1", "open_slot", 1000);
    const rateCard = brandCardPath("post1", "rate_card", 1000);
    const paths = new Set([promo, openSlot, rateCard]);
    expect(paths.size).toBe(3);
  });

  it("puts postId, kind, and version in the path, not a query string", () => {
    expect(brandCardPath("post1", "promo", 1000)).toBe("/api/brand-card/post1/promo/1000");
  });

  it("distinguishes different posts even with the same kind and version", () => {
    const post1 = brandCardPath("post1", "rate_card", 500);
    const post2 = brandCardPath("post2", "rate_card", 500);
    expect(post1).not.toBe(post2);
  });
});
