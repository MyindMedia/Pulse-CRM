import { describe, it, expect } from "vitest";
import { readTrackingParams, withTracking } from "./tracking-links";

/* The studio front page is where a tracked post with no room lands. Every
   link off it has to carry the attribution deeper or the visitor books at
   full price and the post reports nothing. These pin that carry. */

describe("readTrackingParams", () => {
  it("picks up every attribution param off a tracked link", () => {
    expect(readTrackingParams("?src=p1&code=SAVE20&ref=a1&utm_source=ig")).toEqual({
      src: "p1",
      code: "SAVE20",
      ref: "a1",
      utm_source: "ig",
    });
  });

  it("ignores blank and unrelated params", () => {
    // A blank ?ref= must not become a stray "?ref=" on the next link, and the
    // page's own query junk must not ride along.
    expect(readTrackingParams("?ref=&src=%20%20&page=2&code=SAVE20")).toEqual({ code: "SAVE20" });
  });

  it("accepts a URLSearchParams as well as a string", () => {
    const q = new URLSearchParams({ src: "p9" });
    expect(readTrackingParams(q)).toEqual({ src: "p9" });
  });
});

describe("withTracking", () => {
  it("threads src and code onto a deeper link", () => {
    // This is the exact hop C1 dropped: studio front -> room page.
    expect(withTracking("/book/studio/r1", { src: "p1", code: "SAVE20" })).toBe(
      "/book/studio/r1?src=p1&code=SAVE20",
    );
  });

  it("returns a bare path when nothing is being tracked", () => {
    expect(withTracking("/book/studio/r1", {})).toBe("/book/studio/r1");
  });

  it("percent-encodes values", () => {
    expect(withTracking("/book/studio/r1", { ref: "a 1&x" })).toBe(
      "/book/studio/r1?ref=a+1%26x",
    );
  });

  it("keeps a query the path already carries and lets it win", () => {
    // An explicit link beats an inherited tag, and unrelated params survive.
    expect(withTracking("/book/studio/r1?code=OWN&tab=gear", { code: "SAVE20", src: "p1" })).toBe(
      "/book/studio/r1?code=OWN&tab=gear&src=p1",
    );
  });
});
