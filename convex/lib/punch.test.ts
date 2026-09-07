import { describe, it, expect } from "vitest";
import { punchedAt, MAX_BACKDATE_MS } from "./punch";

const NOW = 1_700_000_000_000;

describe("when a clock punch happened", () => {
  it("uses the moment the button was pressed, not the moment it arrived", () => {
    // The whole reason this exists: an engineer clocks in at the start of a
    // session in a room with no signal, and the write lands three hours later
    // when they walk back into the office. Stamped on arrival, that is three
    // hours of somebody's shift gone.
    const pressed = NOW - 3 * 3_600_000;
    expect(punchedAt(pressed, NOW)).toBe(pressed);
  });

  it("falls back to the server clock when the device does not say", () => {
    // The web app sends nothing, and must keep behaving exactly as it did.
    expect(punchedAt(undefined, NOW)).toBe(NOW);
  });

  it("refuses a punch from the future", () => {
    // A phone with a wrong clock could otherwise open a shift that has not
    // started, or park one where no payroll run will find it.
    expect(punchedAt(NOW + 60_000, NOW)).toBe(NOW);
  });

  it("refuses a punch older than the backdate window", () => {
    expect(punchedAt(NOW - MAX_BACKDATE_MS - 1, NOW)).toBe(NOW);
    // And accepts one just inside it, so the boundary is not off by a day.
    expect(punchedAt(NOW - MAX_BACKDATE_MS + 1, NOW)).toBe(NOW - MAX_BACKDATE_MS + 1);
  });

  it("ignores a value that is not a number at all", () => {
    expect(punchedAt(NaN, NOW)).toBe(NOW);
    expect(punchedAt(Infinity, NOW)).toBe(NOW);
  });
});
