import { describe, expect, it } from "vitest";
import { CARD, ISLAND, createIslandStore, islandGeometry, islandLayout, mixHex, neckProfile } from "./dynamic-island";

describe("island layout", () => {
  it("sits 12px from the top without a notch and caps the card width", () => {
    const L = islandLayout(1280, 0);
    expect(L.islandTop).toBe(12);
    expect(L.cardWidth).toBe(CARD.maxWidth);
    expect(L.cardTop).toBeCloseTo(12 + ISLAND.height + CARD.gap);
  });

  it("lines up with the hardware island on a notched phone and fits a narrow screen", () => {
    const L = islandLayout(390, 59);
    expect(L.islandTop).toBe(12); // max(59 - 37.33 - 11, 12)
    expect(islandLayout(390, 80).islandTop).toBeCloseTo(80 - ISLAND.height - 11);
    expect(L.cardWidth).toBe(390 - 32);
  });
});

describe("island geometry", () => {
  const L = islandLayout(390, 0);

  it("is an empty drop at rest and exactly the card when fully expanded", () => {
    const rest = islandGeometry(0, 0, L);
    expect(rest.width).toBe(0);
    expect(rest.height).toBe(0);
    const full = islandGeometry(1, 1, L);
    expect(full.width).toBeCloseTo(L.cardWidth);
    expect(full.height).toBeCloseTo(CARD.height);
    expect(full.offsetY).toBeCloseTo(0);
    expect(full.neckWidth).toBe(0); // the neck has snapped by the time the card lands
  });

  it("stretches a neck between island and drop partway through the fall", () => {
    const mid = islandGeometry(0.44, 0, L);
    expect(mid.neckWidth).toBeGreaterThan(20);
    expect(mid.height).toBeGreaterThan(mid.width); // stretched as it falls
    expect(neckProfile(0, 1.6, 1.4)).toBe(0);
    expect(neckProfile(1, 1.6, 1.4)).toBe(0);
    expect(neckProfile(1.6 / 3, 1.6, 1.4)).toBeCloseTo(1);
  });

  it("never produces negative sizes on a spring overshoot or undershoot", () => {
    for (const [d, e] of [[-0.1, -0.2], [1.15, 1.1], [0.2, -0.05]]) {
      const g = islandGeometry(d, e, L);
      expect(g.width).toBeGreaterThanOrEqual(0);
      expect(g.height).toBeGreaterThanOrEqual(0);
      expect(g.radius).toBeGreaterThanOrEqual(0);
    }
  });

  it("blends the drop from island black to the card colour", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 2)).toBe("#ffffff");
    expect(mixHex("#000000", "#fefefe", 0.5)).toBe("#7f7f7f");
  });
});

describe("island store", () => {
  it("queues notices in order and updates one in place", () => {
    const s = createIslandStore();
    const a = s.show({ title: "Uploading", loading: true });
    const b = s.show({ title: "New booking" });
    expect(s.getSnapshot().map((n) => n.id)).toEqual([a, b]);
    expect(s.update(a, { title: "Attached", loading: false })).toBe(true);
    expect(s.getSnapshot()[0]).toMatchObject({ id: a, title: "Attached", loading: false });
    expect(s.update("missing", { title: "x" })).toBe(false);
    s.dismiss(a);
    expect(s.getSnapshot().map((n) => n.id)).toEqual([b]);
  });

  it("replaces a notice shown again with the same id", () => {
    const s = createIslandStore();
    s.show({ id: "x", title: "One" });
    s.show({ id: "x", title: "Two" });
    expect(s.getSnapshot()).toHaveLength(1);
    expect(s.getSnapshot()[0].title).toBe("Two");
  });

  it("keeps the notice on screen and the newest few behind it during a burst", () => {
    const s = createIslandStore();
    const first = s.show({ title: "first" });
    for (let i = 0; i < 10; i++) s.show({ title: `n${i}` });
    const items = s.getSnapshot();
    expect(items).toHaveLength(6);
    expect(items[0].id).toBe(first);
    expect(items.at(-1)?.title).toBe("n9");
  });

  it("tracks whether a host is mounted", () => {
    const s = createIslandStore();
    expect(s.hasHost()).toBe(false);
    const detach = s.attachHost();
    expect(s.hasHost()).toBe(true);
    detach();
    expect(s.hasHost()).toBe(false);
  });
});
