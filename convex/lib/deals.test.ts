import { describe, it, expect } from "vitest";
import { canGetDealText, decideGapDeal, nextSendTime, DEAL_TEXT_COOLDOWN_MS } from "./deals";
import { freeBlocks, padSessions, cleanGoogleReviewUrl, MIN_GAP_MS } from "./gaps";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("deal-text consent and cap", () => {
  const now = 100 * DAY;
  it("needs an opt-in and a phone, and skips erased clients", () => {
    expect(canGetDealText({ phone: "+14045550100" }, now)).toBe(false);
    expect(canGetDealText({ dealsOptInAt: 1 }, now)).toBe(false);
    expect(canGetDealText({ dealsOptInAt: 1, phone: "+14045550100", erasedAt: 2 }, now)).toBe(false);
    expect(canGetDealText({ dealsOptInAt: 1, phone: "+14045550100" }, now)).toBe(true);
  });

  it("allows at most 4 texts in any 31 days", () => {
    expect(canGetDealText({ dealsOptInAt: 1, phone: "x", lastDealTextAt: now - 7 * DAY }, now)).toBe(false);
    expect(canGetDealText({ dealsOptInAt: 1, phone: "x", lastDealTextAt: now - DEAL_TEXT_COOLDOWN_MS }, now)).toBe(true);
    expect(Math.floor(31 * DAY / DEAL_TEXT_COOLDOWN_MS) + 1).toBeLessThanOrEqual(4);
  });
});

describe("the agent's verdict", () => {
  it("drops a confident skip, inboxes an unsure one", () => {
    expect(decideGapDeal({ choice: "skip", confidence: 0.5 }, "auto")).toBe("drop");
    expect(decideGapDeal({ choice: "skip", confidence: 0.2 }, "auto")).toBe("inbox");
  });
  it("auto-sends only a confident send in Auto mode", () => {
    expect(decideGapDeal({ choice: "send", confidence: 0.8 }, "auto")).toBe("auto");
    expect(decideGapDeal({ choice: "send", confidence: 0.5 }, "auto")).toBe("inbox");
    expect(decideGapDeal({ choice: "send", confidence: 0.99 }, "approve")).toBe("inbox");
  });
  it("leaves it to a person when the agent is unreachable", () => {
    expect(decideGapDeal(null, "auto")).toBe("inbox");
  });
});

describe("send window", () => {
  const hourOf = (ts: number) => Math.floor(ts / HOUR) % 24; // a UTC studio
  it("sends now inside 10am-7pm", () => {
    expect(nextSendTime(12 * HOUR + 5, hourOf)).toBe(12 * HOUR + 5);
  });
  it("waits for 10am when it is early or late", () => {
    expect(nextSendTime(8 * HOUR + 30_000, hourOf)).toBe(10 * HOUR);
    expect(nextSendTime(20 * HOUR, hourOf)).toBe(DAY + 10 * HOUR);
  });
});

describe("free blocks", () => {
  const open = { start: 9 * HOUR, end: 22 * HOUR };
  it("finds the gaps of 3+ hours between busy time", () => {
    const busy = [
      { start: 10 * HOUR, end: 12 * HOUR },
      { start: 11 * HOUR, end: 13 * HOUR }, // overlaps, merged
      { start: 15 * HOUR, end: 16 * HOUR },
    ];
    expect(freeBlocks(busy, open, MIN_GAP_MS)).toEqual([{ start: 16 * HOUR, end: 22 * HOUR }]);
  });
  it("pads sessions by the reset buffer only", () => {
    const padded = padSessions([
      { start: 12 * HOUR, end: 13 * HOUR, kind: "session" },
      { start: 15 * HOUR, end: 16 * HOUR, kind: "block" },
    ]);
    expect(padded[0]).toEqual({ start: 12 * HOUR - 15 * 60_000, end: 13 * HOUR + 15 * 60_000 });
    expect(padded[1]).toEqual({ start: 15 * HOUR, end: 16 * HOUR, kind: "block" });
  });
  it("returns the whole day when nothing is booked", () => {
    expect(freeBlocks([], open)).toEqual([open]);
  });
});

describe("Google review link", () => {
  it("accepts Google links and clears on empty", () => {
    expect(cleanGoogleReviewUrl("https://g.page/r/abc123/review")).toEqual({ url: "https://g.page/r/abc123/review" });
    expect(cleanGoogleReviewUrl(" https://search.google.com/local/writereview?placeid=X ")).toMatchObject({ url: expect.stringContaining("search.google.com") });
    expect(cleanGoogleReviewUrl("")).toEqual({ url: null });
  });
  it("refuses anything else", () => {
    expect(cleanGoogleReviewUrl("http://g.page/r/abc")).toHaveProperty("error");
    expect(cleanGoogleReviewUrl("https://evil.com/?google.com")).toHaveProperty("error");
    expect(cleanGoogleReviewUrl("https://google.com.evil.com/x")).toHaveProperty("error");
    expect(cleanGoogleReviewUrl("not a link")).toHaveProperty("error");
  });
});
