import { describe, it, expect } from "vitest";
import { orderAfterDrag } from "./port-order";

/* The reorder that shipped broken. A bidirectional jack belongs to BOTH
   the inputs column and the outputs column, so joining the two lists sent
   it twice and the server refused the whole ordering with what the user
   saw as a bare "Server Error". These pin the rebuild that replaced it. */

const port = (id: string, direction: "input" | "output" | "bidirectional") => ({
  _id: id,
  direction,
});

describe("the order sent after a drag", () => {
  const plain = [port("a", "input"), port("b", "input"), port("c", "output")];

  it("is always a permutation of every port, once each", () => {
    const out = orderAfterDrag(plain, "inputs", "a", "b");
    expect([...out].sort()).toEqual(["a", "b", "c"]);
  });

  it("moves the dragged jack within its own column", () => {
    expect(orderAfterDrag(plain, "inputs", "a", "b")).toEqual(["b", "a", "c"]);
  });

  it("leaves the other column exactly where it was", () => {
    const out = orderAfterDrag(plain, "inputs", "a", "b");
    expect(out[2]).toBe("c");
  });

  // The actual bug: "c" is in both columns, and concatenating them sent it
  // twice for a device that only has three ports.
  it("sends a bidirectional jack once, not once per column", () => {
    const withBidi = [port("a", "input"), port("b", "input"), port("c", "bidirectional")];
    const out = orderAfterDrag(withBidi, "inputs", "a", "b");
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
    expect([...out].sort()).toEqual(["a", "b", "c"]);
  });

  it("handles a drag in the outputs column with a bidirectional jack present", () => {
    const withBidi = [port("a", "input"), port("b", "output"), port("c", "bidirectional")];
    const out = orderAfterDrag(withBidi, "outputs", "b", "c");
    expect(new Set(out).size).toBe(3);
    expect([...out].sort()).toEqual(["a", "b", "c"]);
  });

  it("does nothing when the jack is dropped on itself", () => {
    expect(orderAfterDrag(plain, "inputs", "a", "a")).toEqual(["a", "b", "c"]);
  });

  it("does nothing when an id is not in that column", () => {
    expect(orderAfterDrag(plain, "inputs", "c", "a")).toEqual(["a", "b", "c"]);
  });
});
