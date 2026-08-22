import { describe, it, expect } from "vitest";
import { normalizeEmail, sameEmail, findByEmail } from "./emailKey";

/* An address is the same address in any case. Pulse compared them exactly and
   an owner seat saved as "Info@playbackrecording.com" stopped matching the
   invite for "info@playbackrecording.com" - the studio's owner signed in to an
   error screen with his workspace sitting right there. */

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Info@Playbackrecording.COM ")).toBe("info@playbackrecording.com");
  });

  it("turns nothing into an empty string rather than throwing", () => {
    expect(normalizeEmail(undefined)).toBe("");
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail("   ")).toBe("");
  });
});

describe("sameEmail", () => {
  it("matches across case and whitespace", () => {
    expect(sameEmail("Info@Playback.com", " info@playback.com ")).toBe(true);
    expect(sameEmail("OT@STUDIO.IO", "ot@studio.io")).toBe(true);
  });

  it("does not match different people", () => {
    expect(sameEmail("ot@studio.io", "ot@studio.com")).toBe(false);
  });

  it("never matches on blank - two people with no email are not one person", () => {
    expect(sameEmail("", "")).toBe(false);
    expect(sameEmail(undefined, undefined)).toBe(false);
    expect(sameEmail(null, "")).toBe(false);
    expect(sameEmail("  ", "ot@studio.io")).toBe(false);
  });
});

describe("findByEmail", () => {
  const roster = [
    { email: "Info@Playbackrecording.com", name: "OT" },
    { email: undefined, name: "Seat with no email" },
    { email: "engineer@playback.com", name: "Engineer" },
  ];

  it("finds the seat whatever case either side is in", () => {
    expect(findByEmail(roster, "info@playbackrecording.com")?.name).toBe("OT");
    expect(findByEmail(roster, "  ENGINEER@playback.com ")?.name).toBe("Engineer");
  });

  it("returns nothing for a stranger, and never the empty seat", () => {
    expect(findByEmail(roster, "someone@else.com")).toBeUndefined();
    expect(findByEmail(roster, "")).toBeUndefined();
    expect(findByEmail(roster, undefined)).toBeUndefined();
  });
});
