import { arrayMove } from "@dnd-kit/sortable";

/**
 * The order to send after dragging one jack within one column.
 *
 * Order is a single sequence across the whole device, so every port has to
 * come back exactly once. Concatenating the inputs and outputs lists does
 * NOT do that: a bidirectional jack - a word clock socket, an RJ45, anything
 * that is both - is in both lists, so joining them sends it twice and the
 * server rightly refuses the whole ordering.
 *
 * Rebuilding from the real port list instead guarantees a permutation
 * whatever a jack's direction: the slots held by the dragged column take the
 * new order, and everything else stays exactly where it was.
 */
export function orderAfterDrag<T extends { _id: string; direction: string }>(
  ports: T[],
  group: "inputs" | "outputs",
  activeId: string,
  overId: string,
): string[] {
  const all = ports.map((p) => p._id);
  if (activeId === overId) return all;

  const inGroup = ports
    .filter((p) =>
      group === "inputs"
        ? p.direction === "input" || p.direction === "bidirectional"
        : p.direction === "output" || p.direction === "bidirectional",
    )
    .map((p) => p._id);

  const from = inGroup.indexOf(activeId);
  const to = inGroup.indexOf(overId);
  if (from === -1 || to === -1) return all;

  const moved = arrayMove(inGroup, from, to);
  const claimed = new Set(inGroup);

  let next = 0;
  return all.map((id) => (claimed.has(id) ? moved[next++] : id));
}
