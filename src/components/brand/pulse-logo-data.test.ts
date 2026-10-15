import { describe, expect, it } from "vitest";
import { LOGO_BOUNDS, LOGO_GOLD, OUTLINE_LOOPS, PULSE_POINTS, ARCS } from "./pulse-logo-data";
import { centrelinePaths, CYCLE, loaderCss } from "./pulse-loader-css";

function parse(d: string) {
  const pts = d.replace(/^M/, "").replace(/Z$/, "").split("L").map((p) => p.split(" ").map(Number));
  return pts as [number, number][];
}

describe("Pulse logo path data (ported from pulse-native PulseLogo.swift)", () => {
  const loops = OUTLINE_LOOPS.map(parse);

  it("has 4 closed loops and 1161 points", () => {
    expect(loops.length).toBe(4);
    expect(loops.map((l) => l.length)).toEqual([506, 118, 230, 307]);
    expect(loops.flat().length).toBe(1161);
    for (const d of OUTLINE_LOOPS) expect(d.endsWith("Z")).toBe(true);
  });

  it("every coordinate is finite and the extent matches the logo bounds", () => {
    const all = loops.flat();
    for (const [x, y] of all) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(LOGO_BOUNDS.x, 0);
    expect(Math.min(...ys)).toBeCloseTo(LOGO_BOUNDS.y, 0);
    expect(Math.max(...xs)).toBeCloseTo(LOGO_BOUNDS.x + LOGO_BOUNDS.width, 0);
    expect(Math.max(...ys)).toBeCloseTo(LOGO_BOUNDS.y + LOGO_BOUNDS.height, 0);
  });

  it("uses the logo gold, not the web token", () => {
    expect(LOGO_GOLD).toBe("#FDCE01");
  });

  it("centreline is the pulse polyline plus three arcs", () => {
    expect(PULSE_POINTS.length).toBe(6);
    expect(ARCS.length).toBe(3);
    const paths = centrelinePaths();
    expect(paths.length).toBe(4);
    for (const p of paths) expect(p.length).toBeGreaterThan(0);
  });

  it("loop is 3 to 4 seconds and emits keyframes for every trace", () => {
    expect(CYCLE).toBeGreaterThanOrEqual(3);
    expect(CYCLE).toBeLessThanOrEqual(4);
    const css = loaderCss();
    for (let i = 0; i < 4; i++) expect(css).toContain(`@keyframes pl-trace-${i}`);
    expect(css).toContain("@keyframes pl-mark");
    expect(css).toContain("prefers-reduced-motion:reduce");
  });
});
