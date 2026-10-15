import { describe, it, expect } from "vitest";
import { pickVisiblePills } from "./visible-pills";

const s = (id: string, startTime: number, requestStatus?: string) => ({ _id: id, startTime, requestStatus });

describe("pickVisiblePills", () => {
  it("keeps every booking when the cell has room", () => {
    const day = [s("a", 1), s("b", 2)];
    expect(pickVisiblePills(day, 3)).toBe(day);
  });

  it("gives a pending request a slot on a busy day, in time order", () => {
    const day = [s("a", 1), s("b", 2), s("c", 3), s("d", 4), s("req", 5, "pending")];
    expect(pickVisiblePills(day, 3).map((x) => x._id)).toEqual(["a", "b", "req"]);
  });

  it("does not treat an approved or declined request as pending", () => {
    const day = [s("a", 1), s("b", 2), s("c", 3), s("x", 4, "approved")];
    expect(pickVisiblePills(day, 3).map((x) => x._id)).toEqual(["a", "b", "c"]);
  });
});
