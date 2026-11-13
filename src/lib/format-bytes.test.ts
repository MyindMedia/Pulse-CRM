import { describe, it, expect } from "vitest";
import { formatBytes } from "./format-bytes";
import { formatBytes as backendFormatBytes } from "@convex/lib/emailTemplates/sessionDelivery";

describe("formatBytes (decimal, same as the delivery email)", () => {
  it("uses decimal units and three significant figures", () => {
    expect(formatBytes(212_000)).toBe("212 KB");
    expect(formatBytes(58_200_000)).toBe("58.2 MB");
    expect(formatBytes(1_420_000_000)).toBe("1.42 GB");
    expect(formatBytes(5_000_000)).toBe("5 MB");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("says 1 MB rather than 1000 KB", () => {
    expect(formatBytes(999_999)).toBe("1 MB");
  });

  it("is 0 B for nothing, a negative or a non-number", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });

  it("gives the same text as the backend for every size the app shows", () => {
    const sizes = [1, 999, 1000, 1001, 12_345, 999_499, 999_999, 1_000_000, 58_249_999, 612_000_000, 1_080_000_000, 2_000_000_000, 5e12];
    for (const n of sizes) expect(formatBytes(n)).toBe(backendFormatBytes(n));
  });
});
