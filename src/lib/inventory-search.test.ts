import { describe, it, expect } from "vitest";
import { matchesSearch, searchItems } from "./inventory-search";

const neve = {
  name: "AMS Neve 1073DPX",
  category: "preamp",
  serialNumber: "NV-8842",
  roomName: "Studio A",
  location: "Studio A",
  notes: "Channel 2 intermittent",
};
const sm57 = { name: "Shure SM57", category: "mic", roomName: null, location: "Storage" };
const cable = { name: "XLR 10ft", category: "cable", notes: "black jacket" };

describe("finding a piece of gear", () => {
  it("matches on the model name", () => {
    expect(matchesSearch(neve, "1073")).toBe(true);
    expect(matchesSearch(neve, "neve")).toBe(true);
  });

  // Nobody types a name the way it was entered.
  it("matches words in any order", () => {
    expect(matchesSearch(neve, "1073 neve")).toBe(true);
    expect(matchesSearch(neve, "neve 1073")).toBe(true);
  });

  it("needs every word to appear, not just one", () => {
    expect(matchesSearch(neve, "neve 1176")).toBe(false);
  });

  it("ignores case and punctuation", () => {
    expect(matchesSearch(neve, "NEVE-1073")).toBe(true);
    expect(matchesSearch(neve, "  neve   ")).toBe(true);
  });

  // A serial is what you have when the name is generic.
  it("matches on a serial number", () => {
    expect(matchesSearch(neve, "NV-8842")).toBe(true);
    expect(matchesSearch(neve, "8842")).toBe(true);
  });

  it("matches on the room it lives in", () => {
    expect(matchesSearch(neve, "studio a")).toBe(true);
    expect(matchesSearch(sm57, "storage")).toBe(true);
  });

  it("matches on notes, which is where the fault report lives", () => {
    expect(matchesSearch(neve, "intermittent")).toBe(true);
  });

  it("matches on category", () => {
    expect(matchesSearch(cable, "cable")).toBe(true);
  });

  it("returns everything for an empty query", () => {
    expect(matchesSearch(sm57, "")).toBe(true);
    expect(matchesSearch(sm57, "   ")).toBe(true);
  });

  it("copes with a room that is not set", () => {
    expect(matchesSearch(sm57, "shure")).toBe(true);
    expect(matchesSearch(sm57, "studio a")).toBe(false);
  });
});

describe("filtering the list", () => {
  const all = [neve, sm57, cable];

  it("keeps the list's order", () => {
    expect(searchItems(all, "e").map((i) => i.name)).toEqual([
      "AMS Neve 1073DPX",
      "Shure SM57",
      "XLR 10ft",
    ]);
  });

  it("narrows to the matches", () => {
    expect(searchItems(all, "mic").map((i) => i.name)).toEqual(["Shure SM57"]);
  });

  it("returns the original list untouched when nothing is typed", () => {
    expect(searchItems(all, "")).toBe(all);
  });

  it("returns nothing when nothing matches", () => {
    expect(searchItems(all, "flurbmatic")).toEqual([]);
  });
});
