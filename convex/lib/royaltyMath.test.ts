import { describe, it, expect } from "vitest";
import { allocate, contributorKey, masterParts } from "./royaltyMath";

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

describe("allocate", () => {
  it("splits $10.00 50/30/20 exactly", () => {
    expect(allocate(1000, [{ key: "a", pct: 50 }, { key: "b", pct: 30 }, { key: "c", pct: 20 }])).toEqual([500, 300, 200]);
  });

  it("gives the rounding remainder to the largest share: $0.10 at 33/33/34", () => {
    const s = allocate(10, [{ key: "a", pct: 33 }, { key: "b", pct: 33 }, { key: "c", pct: 34 }]);
    expect(s).toEqual([3, 3, 4]);
    expect(sum(s)).toBe(10);
  });

  it("first listed wins a tie for largest", () => {
    expect(allocate(1, [{ key: "a", pct: 50 }, { key: "b", pct: 50 }])).toEqual([1, 0]);
  });

  it("always sums exactly, for many amounts and awkward splits", () => {
    const splits = [
      [33.33, 33.33, 33.34],
      [12.5, 12.5, 25, 50],
      [1, 99],
      [70, 15, 15],
      [33.3, 33.3, 33.3],
    ];
    for (const pcts of splits) {
      for (const amount of [0, 1, 2, 7, 99, 100, 12345, 41200, 999999, -1, -257]) {
        const s = allocate(amount, pcts.map((pct, i) => ({ key: String(i), pct })));
        expect(sum(s)).toBe(amount);
        s.forEach((x) => expect(Number.isInteger(x)).toBe(true));
      }
    }
  });

  it("allocates nothing when no one holds master", () => {
    expect(allocate(500, [{ key: "a", pct: 0 }])).toEqual([0]);
    expect(allocate(500, [])).toEqual([]);
  });

  it("refuses fractional cents", () => {
    expect(() => allocate(1.5, [{ key: "a", pct: 100 }])).toThrow();
  });
});

describe("contributors", () => {
  it("keys by email, else name", () => {
    expect(contributorKey({ name: "A", email: " Mike@Dean.COM " })).toBe("mike@dean.com");
    expect(contributorKey({ name: "  Mike   Dean " })).toBe("name:mike dean");
  });

  it("only master holders take a part", () => {
    expect(
      masterParts([
        { name: "Writer", email: "w@x.com", masterPct: 0 },
        { name: "Artist", email: "a@x.com", masterPct: 80 },
        { name: "Producer", masterPct: 20 },
      ]),
    ).toEqual([
      { key: "a@x.com", name: "Artist", pct: 80 },
      { key: "name:producer", name: "Producer", pct: 20 },
    ]);
  });
});
