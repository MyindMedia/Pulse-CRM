import { describe, it, expect } from "vitest";
import {
  overlaps,
  bookedUnits,
  gearAvailable,
  engineerAvailable,
  unitsOf,
  addOnsTotalCents,
  type SessionWindow,
} from "./gearRental";

const H = 3_600_000;
const T = 1_700_000_000_000;

describe("overlaps", () => {
  it("detects overlapping and adjacent intervals", () => {
    expect(overlaps(0, 10, 5, 15)).toBe(true);
    expect(overlaps(0, 10, 10, 20)).toBe(false); // half-open: touching is not overlap
    expect(overlaps(0, 10, 11, 20)).toBe(false);
    expect(overlaps(5, 15, 0, 10)).toBe(true);
  });
});

function session(start: number, hours: number, opts: Partial<SessionWindow> = {}): SessionWindow {
  return { startTime: start, endTime: start + hours * H, status: "confirmed", ...opts };
}

describe("bookedUnits", () => {
  const MIC = "mic1";
  const sessions: SessionWindow[] = [
    session(T, 2, { addOns: [{ equipmentId: MIC }] }), // T..T+2h uses the mic
    session(T + 5 * H, 2, { addOns: [{ equipmentId: MIC }] }), // later, no overlap with T..T+1h
    session(T, 2, { status: "cancelled", addOns: [{ equipmentId: MIC }] }), // released
    session(T, 2, { addOns: [{ equipmentId: "other" }] }), // different item
  ];

  it("counts only live, overlapping sessions that use the item", () => {
    expect(bookedUnits(MIC, T, T + H, sessions)).toBe(1); // one live overlap
    expect(bookedUnits(MIC, T + 3 * H, T + 4 * H, sessions)).toBe(0); // gap
    expect(bookedUnits(MIC, T + 5 * H, T + 6 * H, sessions)).toBe(1); // the later one
  });

  it("ignores cancelled/no_show and other items", () => {
    const onlyDead: SessionWindow[] = [
      session(T, 2, { status: "cancelled", addOns: [{ equipmentId: MIC }] }),
      session(T, 2, { status: "no_show", addOns: [{ equipmentId: MIC }] }),
    ];
    expect(bookedUnits(MIC, T, T + H, onlyDead)).toBe(0);
  });
});

describe("gearAvailable", () => {
  it("requires rentable, serviceable status, and a free unit", () => {
    expect(gearAvailable({ rentable: true, status: "available", quantity: 1 }, 0)).toBe(true);
    expect(gearAvailable({ rentable: false, status: "available", quantity: 1 }, 0)).toBe(false);
    expect(gearAvailable({ rentable: true, status: "maintenance", quantity: 1 }, 0)).toBe(false);
    expect(gearAvailable({ rentable: true, status: "retired", quantity: 1 }, 0)).toBe(false);
  });

  it("is quantity-aware: one mic cannot take two overlapping sessions", () => {
    const oneMic = { rentable: true, status: "available", quantity: 1 };
    expect(gearAvailable(oneMic, 0)).toBe(true);
    expect(gearAvailable(oneMic, 1)).toBe(false); // already booked once
    const twoMics = { rentable: true, status: "available", quantity: 2 };
    expect(gearAvailable(twoMics, 1)).toBe(true);
    expect(gearAvailable(twoMics, 2)).toBe(false);
  });
});

describe("engineerAvailable", () => {
  const E = "eng1";
  it("is busy when already engineering an overlapping live session", () => {
    const sessions: SessionWindow[] = [session(T, 3, { engineerId: E })];
    expect(engineerAvailable(E, T + H, T + 2 * H, sessions)).toBe(false);
    expect(engineerAvailable(E, T + 4 * H, T + 5 * H, sessions)).toBe(true); // after
    expect(engineerAvailable("other", T + H, T + 2 * H, sessions)).toBe(true);
  });

  it("ignores cancelled sessions", () => {
    const sessions: SessionWindow[] = [session(T, 3, { engineerId: E, status: "cancelled" })];
    expect(engineerAvailable(E, T + H, T + 2 * H, sessions)).toBe(true);
  });
});

describe("helpers", () => {
  it("unitsOf defaults to 1", () => {
    expect(unitsOf({})).toBe(1);
    expect(unitsOf({ quantity: 0 })).toBe(1);
    expect(unitsOf({ quantity: 3 })).toBe(3);
  });
  it("addOnsTotalCents sums prices", () => {
    expect(addOnsTotalCents([{ priceCents: 7500 }, { priceCents: 2500 }])).toBe(10000);
    expect(addOnsTotalCents([])).toBe(0);
  });
});
