import { describe, it, expect } from "vitest";
import { foregoneCents, summarizeComps, compLeakageShare, type CompSession } from "./comp";

describe("foregoneCents", () => {
  it("is list minus charged for a comp/discount", () => {
    expect(foregoneCents({ rateCents: 0, listValueCents: 20000, compType: "comped" })).toBe(20000);
    expect(foregoneCents({ rateCents: 12000, listValueCents: 20000, compType: "discounted" })).toBe(8000);
  });
  it("is zero for a normal session or when no list value", () => {
    expect(foregoneCents({ rateCents: 20000 })).toBe(0);
    expect(foregoneCents({ rateCents: 0, compType: "comped" })).toBe(0); // no listValue
  });
  it("never goes negative", () => {
    expect(foregoneCents({ rateCents: 25000, listValueCents: 20000, compType: "discounted" })).toBe(0);
  });
});

describe("summarizeComps", () => {
  const sessions: CompSession[] = [
    { artistId: "a1", rateCents: 0, listValueCents: 20000, compType: "comped", compReason: "artist_development" },
    { artistId: "a1", rateCents: 10000, listValueCents: 20000, compType: "discounted", compReason: "referral" },
    { artistId: "a2", rateCents: 0, listValueCents: 15000, compType: "comped", compReason: "artist_development" },
    { artistId: "a3", rateCents: 20000 }, // normal, ignored
  ];

  it("counts comps/discounts and totals foregone revenue", () => {
    const s = summarizeComps(sessions);
    expect(s.compedCount).toBe(2);
    expect(s.discountedCount).toBe(1);
    expect(s.totalForegoneCents).toBe(20000 + 10000 + 15000); // 45000
  });

  it("breaks down by reason, largest first", () => {
    const s = summarizeComps(sessions);
    expect(s.byReason[0]).toEqual({ reason: "artist_development", count: 2, foregoneCents: 35000 });
    expect(s.byReason.find((r) => r.reason === "referral")?.foregoneCents).toBe(10000);
  });

  it("breaks down by client, largest first", () => {
    const s = summarizeComps(sessions);
    expect(s.byClient[0]).toEqual({ artistId: "a1", count: 2, foregoneCents: 30000 });
    expect(s.byClient[1].artistId).toBe("a2");
  });
});

describe("compLeakageShare", () => {
  it("is foregone over gross billable value", () => {
    expect(compLeakageShare(20000, 80000)).toBeCloseTo(0.2); // 20k of 100k gross
    expect(compLeakageShare(0, 100000)).toBe(0);
    expect(compLeakageShare(0, 0)).toBe(0);
  });
});
