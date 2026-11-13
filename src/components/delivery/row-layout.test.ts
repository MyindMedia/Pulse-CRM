import { describe, expect, it } from "vitest";
import {
  CONTROLS_STACKS_ONE,
  CONTROLS_STACKS_TWO,
  NAME_STACKS_ONE,
  NAME_STACKS_TWO,
  STACK_ONE_REM,
  STACK_TWO_REM,
  rowContentPx,
  rowStacks,
  stackThresholdRem,
} from "./row-layout";

/* V4-03: the stacking threshold comes from the real pieces, and a 390 px
   phone shows an audio row on one line at normal text. */

describe("row stacking threshold (V4-03)", () => {
  it("is the icon, gaps, an 8rem name and the controls, in rem", () => {
    // 2.25 icon + 0.75 gap + 8 name + n x (0.75 gap + 2.75 control)
    expect(stackThresholdRem(1)).toBe(14.5);
    expect(stackThresholdRem(2)).toBe(18);
    expect(STACK_ONE_REM).toBe(stackThresholdRem(1));
    expect(STACK_TWO_REM).toBe(stackThresholdRem(2));
  });

  it("the class names carry the computed numbers", () => {
    for (const [classes, rem] of [
      [NAME_STACKS_ONE, 14.5],
      [CONTROLS_STACKS_ONE, 14.5],
      [NAME_STACKS_TWO, 18],
      [CONTROLS_STACKS_TWO, 18],
    ] as const) {
      for (const token of classes.split(" ")) expect(token.startsWith(`@max-[${rem}rem]:`), token).toBe(true);
    }
  });

  it("the controls wrap and may shrink when stacked, and never take a fixed width", () => {
    for (const c of [CONTROLS_STACKS_ONE, CONTROLS_STACKS_TWO]) {
      expect(c).toContain("flex-wrap");
      expect(c).toContain("min-w-0");
      expect(c).not.toMatch(/(^| )@max-\[[^\]]+\]:(w|min-w|basis)-(?!0)/);
    }
  });
});

describe("row layout on a 390 px phone (V4-03)", () => {
  it("the row's container is 328 px at 100% text", () => {
    expect(rowContentPx(390, 16)).toBe(328);
  });

  it("audio row (two controls): one line at 100%, stacked at 150% and 200%", () => {
    expect(rowStacks(rowContentPx(390, 16), 16, 2)).toBe(false); // 288 px needed, 328 there
    expect(rowStacks(rowContentPx(390, 24), 24, 2)).toBe(true);
    expect(rowStacks(rowContentPx(390, 32), 32, 2)).toBe(true);
  });

  it("single-control row: one line at 100%, stacked at 150% and 200%", () => {
    expect(rowStacks(rowContentPx(390, 16), 16, 1)).toBe(false);
    expect(rowStacks(rowContentPx(390, 24), 24, 1)).toBe(true);
    expect(rowStacks(rowContentPx(390, 32), 32, 1)).toBe(true);
  });

  it("inline, the name keeps at least 8rem", () => {
    const px = rowContentPx(390, 16);
    const nameWidth = px - (stackThresholdRem(2) - 8) * 16;
    expect(nameWidth).toBeGreaterThanOrEqual(8 * 16);
  });
});
