import { describe, it, expect } from "vitest";
import {
  normalizeLayout,
  visibleKeys,
  hideKey,
  showKey,
  reorderVisible,
} from "./dashboard-layout";

const KEYS = ["today", "kpis", "revenue", "catalog", "activity"];
const DEFAULT_HIDDEN = ["catalog"];

describe("dashboard layout", () => {
  it("no save -> registry order with registry default-hidden", () => {
    const l = normalizeLayout(null, KEYS, DEFAULT_HIDDEN);
    expect(l.order).toEqual(KEYS);
    expect(l.hidden).toEqual(["catalog"]);
    expect(visibleKeys(l)).toEqual(["today", "kpis", "revenue", "activity"]);
  });

  it("saved order survives; unknown keys drop; new registry keys append", () => {
    const l = normalizeLayout(
      { order: ["revenue", "ghost-widget", "today"], hidden: ["ghost-widget", "kpis"] },
      KEYS,
      DEFAULT_HIDDEN,
    );
    expect(l.order).toEqual(["revenue", "today", "kpis", "catalog", "activity"]);
    expect(l.hidden).toContain("kpis"); // user choice kept
    expect(l.hidden).not.toContain("ghost-widget"); // unknown dropped
    expect(l.hidden).toContain("catalog"); // newly-appended respects default
  });

  it("an old save predating a default-hidden widget still hides it", () => {
    const l = normalizeLayout({ order: ["today", "kpis"], hidden: [] }, KEYS, DEFAULT_HIDDEN);
    expect(l.hidden).toEqual(["catalog"]);
  });

  it("hide/show round-trips and re-adding lands at the end", () => {
    let l = normalizeLayout(null, KEYS, DEFAULT_HIDDEN);
    l = hideKey(l, "kpis");
    expect(visibleKeys(l)).toEqual(["today", "revenue", "activity"]);
    l = showKey(l, "catalog");
    expect(visibleKeys(l)).toEqual(["today", "revenue", "activity", "catalog"]);
    expect(l.hidden).toEqual(["kpis"]);
  });

  it("reorderVisible keeps hidden widgets parked", () => {
    let l = normalizeLayout(null, KEYS, DEFAULT_HIDDEN);
    l = reorderVisible(l, ["activity", "today", "kpis", "revenue"]);
    expect(visibleKeys(l)).toEqual(["activity", "today", "kpis", "revenue"]);
    expect(l.order.at(-1)).toBe("catalog");
    expect(l.hidden).toEqual(["catalog"]);
  });
});
