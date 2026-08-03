import { describe, it, expect } from "vitest";
import { parseSmsIntent, parseRating } from "./lib/smsKeywords";

describe("parseSmsIntent (two-way SMS keyword router)", () => {
  it("classifies confirmations however they're typed", () => {
    expect(parseSmsIntent("YES")).toBe("yes");
    expect(parseSmsIntent(" yes! ")).toBe("yes");
    expect(parseSmsIntent("Confirmed.")).toBe("yes");
    expect(parseSmsIntent("y")).toBe("yes");
  });

  it("classifies declines", () => {
    expect(parseSmsIntent("no")).toBe("no");
    expect(parseSmsIntent("N")).toBe("no");
    expect(parseSmsIntent("can't")).toBe("no");
  });

  it("keeps carrier opt-out keywords as stop", () => {
    for (const w of ["STOP", "stopall", "Unsubscribe", "CANCEL", "end", "quit"]) {
      expect(parseSmsIntent(w)).toBe("stop");
    }
  });

  it("START/UNSTOP re-subscribe but a bare YES does not", () => {
    expect(parseSmsIntent("START")).toBe("start");
    expect(parseSmsIntent("unstop")).toBe("start");
    expect(parseSmsIntent("YES")).not.toBe("start");
  });

  it("classifies the flow keywords", () => {
    expect(parseSmsIntent("EXTEND")).toBe("extend");
    expect(parseSmsIntent("approve")).toBe("approve");
    expect(parseSmsIntent("DENY")).toBe("deny");
    expect(parseSmsIntent("Rebook")).toBe("rebook");
    expect(parseSmsIntent("reschedule")).toBe("reschedule");
    expect(parseSmsIntent("running late")).toBe("late");
    expect(parseSmsIntent("HELP")).toBe("help");
  });

  it("classifies CLAIM and 1-5 ratings", () => {
    expect(parseSmsIntent("CLAIM")).toBe("claim");
    expect(parseSmsIntent("claim!")).toBe("claim");
    expect(parseSmsIntent("5")).toBe("rating");
    expect(parseSmsIntent(" 3 ")).toBe("rating");
    expect(parseSmsIntent("6")).toBe("text");
    expect(parseSmsIntent("0")).toBe("text");
    expect(parseRating("5.")).toBe(5);
    expect(parseRating("1")).toBe(1);
    expect(parseRating("10")).toBeNull();
  });

  it("longer sentences stay free text (no accidental confirms)", () => {
    expect(parseSmsIntent("yes we should add a vocal booth")).toBe("text");
    expect(parseSmsIntent("no idea what time works yet")).toBe("text");
    expect(parseSmsIntent("what's the parking situation?")).toBe("text");
  });
});
