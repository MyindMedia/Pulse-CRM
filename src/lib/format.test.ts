import { describe, it, expect } from "vitest";
import { moneyExact } from "./format";

describe("moneyExact", () => {
  it("always shows two decimals", () => {
    expect(moneyExact(18000)).toBe("$180.00");
    expect(moneyExact(18050)).toBe("$180.50");
    expect(moneyExact(5)).toBe("$0.05");
    expect(moneyExact(0)).toBe("$0.00");
  });

  it("groups thousands", () => {
    expect(moneyExact(123456789)).toBe("$1,234,567.89");
  });

  it("never prints NaN or Infinity", () => {
    expect(moneyExact(Number.NaN)).toBe("$0.00");
    expect(moneyExact(Number.POSITIVE_INFINITY)).toBe("$0.00");
  });
});
