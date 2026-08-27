import { describe, it, expect } from "vitest";
import { composeSubline } from "./subline";

describe("composeSubline", () => {
  it("reproduces and fixes the real broken card: a promo label that repeats the room name", () => {
    // The exact draft the critic found: room "Studio A - Live Room" plus a
    // promo labeled "Studio A, Tuesday evenings" used to render literally as
    // "Studio A - Live Room, Studio A, Tuesday evenings" on the studio's own
    // Instagram and Facebook.
    const out = composeSubline(["Studio A - Live Room", "Studio A, Tuesday evenings"]);
    expect(out).toBe("Studio A - Live Room, Tuesday evenings");
  });

  it("dedupes regardless of which side carries the repeat", () => {
    const out = composeSubline(["Studio A", "Studio A - Live Room, Tuesday evenings"]);
    expect(out).toBe("Studio A - Live Room, Tuesday evenings");
  });

  it("does not treat a word that merely starts the same as a repeat", () => {
    // "Studio A" must not match inside "Studio Anytime deals" - that is a
    // different room, not the same one repeated.
    const out = composeSubline(["Studio A", "Studio Anytime deals"]);
    expect(out).toBe("Studio A, Studio Anytime deals");
  });

  it("collapses two segments that are exactly the same", () => {
    expect(composeSubline(["Studio A", "Studio A"])).toBe("Studio A");
    expect(composeSubline(["studio a", "Studio A"])).toBe("studio a");
  });

  it("joins two genuinely different phrases unchanged", () => {
    expect(composeSubline(["Studio A", "Weekend special"])).toBe("Studio A, Weekend special");
  });

  it("drops missing parts without leaving a stray comma", () => {
    expect(composeSubline([null, "Tuesday evenings"])).toBe("Tuesday evenings");
    expect(composeSubline(["Studio A", undefined])).toBe("Studio A");
    expect(composeSubline([null, undefined])).toBe("");
    expect(composeSubline(["", "Tuesday evenings"])).toBe("Tuesday evenings");
  });

  it("splits a label with its own extra segments and dedupes just the repeat", () => {
    const out = composeSubline(["Studio A - Live Room", "Studio A - Live Room, Tuesday evenings, weekly"]);
    expect(out).toBe("Studio A - Live Room, Tuesday evenings, weekly");
  });
});
