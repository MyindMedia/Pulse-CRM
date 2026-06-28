import { describe, it, expect } from "vitest";
import { verifyDraft, findMoney } from "./aiVerify";

describe("findMoney", () => {
  it("finds dollar amounts with separators and cents", () => {
    expect(findMoney("Pay $540 now or $1,200 later, plus $75.50.")).toEqual(["$540", "$1,200", "$75.50"]);
    expect(findMoney("no money here")).toEqual([]);
  });
});

describe("verifyDraft", () => {
  it("passes clean copy when no money facts are given", () => {
    expect(verifyDraft("Hi Nova, great session today. Want to lock the next date?")).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("rejects leftover placeholder tokens", () => {
    expect(verifyDraft("Pay here: [payment link]").ok).toBe(false);
    expect(verifyDraft("Hi {{first_name}}, thanks!").ok).toBe(false);
    expect(verifyDraft("TODO: write this").ok).toBe(false);
  });

  it("rejects any amount when allowedMoney is empty", () => {
    const v = verifyDraft("Your balance of $540 is past due.", { allowedMoney: [] });
    expect(v.ok).toBe(false);
    expect(v.issues.join(" ")).toMatch(/unverified amount \$540/);
  });

  it("allows only amounts in the provided set", () => {
    expect(verifyDraft("That is $1,200 total.", { allowedMoney: ["$1,200"] }).ok).toBe(true);
    expect(verifyDraft("That is $1,200 total.", { allowedMoney: ["$540"] }).ok).toBe(false);
    // separator-insensitive: $1200 matches $1,200
    expect(verifyDraft("That is $1200 total.", { allowedMoney: ["$1,200"] }).ok).toBe(true);
  });

  it("does not check money when allowedMoney is omitted", () => {
    expect(verifyDraft("Roughly $300 depending on the room.").ok).toBe(true);
  });

  it("flags forbidden references (cross-tenant safety net)", () => {
    const v = verifyDraft("We are better than Abbey Road Studios.", { forbidden: ["Abbey Road Studios"] });
    expect(v.ok).toBe(false);
  });

  it("rejects an empty draft", () => {
    expect(verifyDraft("   ").ok).toBe(false);
  });
});
