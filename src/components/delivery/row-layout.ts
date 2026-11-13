/* When a file row on the client page stacks (V3-03, V4-03).

   A row is a size container (the <li>). Inline, a row holds: the icon tile, a
   file name, and one or two 44 px round controls, with a gap between each.
   The name must keep at least 8rem. When the container is narrower than the
   sum, the name takes the whole first line and the icon and controls share
   the line under it.

   Everything is in rem, so the threshold follows the reader's text size: at
   150% text the same pieces need more pixels, and the row stacks sooner.

   The class names below are literals because Tailwind reads them from the
   source; row-layout.test.ts checks them against the numbers computed here. */

export const ICON_REM = 2.25; // size-9
export const GAP_REM = 0.75; // gap-3
export const NAME_MIN_REM = 8;
export const CONTROL_REM = 2.75; // size-11

/** The container width, in rem, below which the name would get less than 8rem
 *  inline: icon + gap + name + (gap + control) for each control. */
export function stackThresholdRem(controls: 1 | 2): number {
  return ICON_REM + GAP_REM + NAME_MIN_REM + controls * (GAP_REM + CONTROL_REM);
}

/** One control (Download, or the lock mark): 14.5rem. */
export const STACK_ONE_REM = 14.5;
/** Two controls (Play and Download): 18rem. */
export const STACK_TWO_REM = 18;

/** Classes for the name block. Stacked, it takes the whole first line. */
export const NAME_STACKS_ONE = "@max-[14.5rem]:order-first @max-[14.5rem]:basis-full";
export const NAME_STACKS_TWO = "@max-[18rem]:order-first @max-[18rem]:basis-full";

/** Classes for the controls block. Inline it keeps its size and sits at the
 *  right. Stacked it fills what is left of the line under the name and wraps
 *  inside it, so no control is ever cut off at the row's edge, at any text
 *  size. min-w-0 lets it be narrower than its content. */
export const CONTROLS_STACKS_ONE =
  "@max-[14.5rem]:min-w-0 @max-[14.5rem]:flex-auto @max-[14.5rem]:flex-wrap @max-[14.5rem]:justify-end";
export const CONTROLS_STACKS_TWO =
  "@max-[18rem]:min-w-0 @max-[18rem]:flex-auto @max-[18rem]:flex-wrap @max-[18rem]:justify-end";

/** The row's inner (container) width in px on a viewport, for a root font
 *  size: page side padding 1rem each (narrow layout), the list's 1px borders,
 *  and the row's 0.875rem side padding. For the layout prediction in tests. */
export function rowContentPx(viewportPx: number, rootPx: number): number {
  return viewportPx - 2 * 1 * rootPx - 2 - 2 * 0.875 * rootPx;
}

/** Whether a row stacks, given its container width and the root font size. */
export function rowStacks(containerPx: number, rootPx: number, controls: 1 | 2): boolean {
  return containerPx <= stackThresholdRem(controls) * rootPx;
}
