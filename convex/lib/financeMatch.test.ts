import { describe, it, expect } from "vitest";
import {
  scorePair,
  rankCandidates,
  autoLinkDecision,
  vendorSimilarity,
  pairKey,
  AUTO_THRESHOLD,
  SUGGEST_THRESHOLD,
  type MatchSide,
} from "./financeMatch";

/* Matching decides which receipt documents which dollar, so it is plain code a
   person can check, never a model's guess. These pin the rules the spec names:
   amount first, then how far apart the dates are, then the vendor, then the
   card digits; money in never matches spending; and nothing links on its own
   unless it is both confident and the only good answer. */

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

const receipt = (over: Partial<MatchSide> = {}): MatchSide => ({
  kind: "receipt", id: "r1", amountCents: 11240, dateMs: day("2026-09-02"), vendor: "Guitar Center", ...over,
});
const txn = (over: Partial<MatchSide> = {}): MatchSide => ({
  kind: "transaction", id: "t1", amountCents: 11240, dateMs: day("2026-09-04"),
  vendor: "GUITAR CENTER #512", direction: "out", ...over,
});
const expense = (over: Partial<MatchSide> = {}): MatchSide => ({
  kind: "expense", id: "e1", amountCents: 11240, dateMs: day("2026-09-02"), vendor: "Guitar Center", ...over,
});

describe("vendorSimilarity", () => {
  it("ignores store numbers, case and card noise", () => {
    expect(vendorSimilarity("Guitar Center", "GUITAR CENTER #512")).toBe(1);
    expect(vendorSimilarity("Sweetwater", "POS DEBIT SWEETWATER SOUND 800-222")).toBeGreaterThanOrEqual(0.6);
  });
  it("scores unrelated vendors low", () => {
    expect(vendorSimilarity("Guitar Center", "Starbucks")).toBe(0);
    expect(vendorSimilarity("", "Starbucks")).toBe(0);
  });
});

describe("scorePair", () => {
  it("exact amount, bank posts two days later, same vendor: strong", () => {
    const s = scorePair(receipt(), txn())!;
    expect(s.score).toBeGreaterThanOrEqual(AUTO_THRESHOLD);
    expect(s.reasons.join(" ")).toMatch(/amount/i);
  });

  it("same amount 30 days apart: not a candidate", () => {
    expect(scorePair(receipt(), txn({ dateMs: day("2026-10-02") }))).toBeNull();
  });

  it("bank line dated well before the receipt: not a candidate", () => {
    expect(scorePair(receipt(), txn({ dateMs: day("2026-08-28") }))).toBeNull();
  });

  it("money in never matches a receipt or an expense", () => {
    expect(scorePair(receipt(), txn({ direction: "in" }))).toBeNull();
    expect(scorePair(expense(), txn({ direction: "in" }))).toBeNull();
  });

  it("a tip on the card charge is a weaker candidate, not a miss", () => {
    const s = scorePair(receipt({ amountCents: 5000, vendor: "Nobu" }), txn({ amountCents: 5900, vendor: "NOBU MALIBU" }))!;
    expect(s).not.toBeNull();
    expect(s.score).toBeGreaterThanOrEqual(SUGGEST_THRESHOLD);
    expect(s.score).toBeLessThan(AUTO_THRESHOLD);
    expect(s.reasons.join(" ")).toMatch(/tip/i);
  });

  it("a charge smaller than the receipt is not a tip", () => {
    expect(scorePair(receipt({ amountCents: 5900 }), txn({ amountCents: 5000 }))).toBeNull();
  });

  it("card last four matching the account adds confidence", () => {
    const plain = scorePair(receipt({ vendor: "Shop" }), txn({ vendor: "Unrelated name", accountMask: "4242" }))!;
    const withCard = scorePair(receipt({ vendor: "Shop", last4: "4242" }), txn({ vendor: "Unrelated name", accountMask: "4242" }))!;
    expect(withCard.score).toBe(plain.score + 10);
  });

  it("receipt to expense uses exact amount and nearby dates", () => {
    expect(scorePair(receipt(), expense())!.score).toBeGreaterThanOrEqual(AUTO_THRESHOLD);
    expect(scorePair(receipt(), expense({ dateMs: day("2026-09-20") }))).toBeNull();
  });

  it("never exceeds 100", () => {
    expect(scorePair(receipt({ last4: "1111" }), txn({ dateMs: day("2026-09-02"), accountMask: "1111" }))!.score).toBeLessThanOrEqual(100);
  });
});

describe("rankCandidates and autoLinkDecision", () => {
  it("links automatically when confident and alone", () => {
    const ranked = rankCandidates(receipt(), [txn(), txn({ id: "t2", amountCents: 999 })], new Set());
    const pick = autoLinkDecision(ranked);
    expect(pick?.candidate.id).toBe("t1");
  });

  it("two identical charges: suggestions only, no automatic link", () => {
    const twins = [txn({ id: "t1" }), txn({ id: "t2" })];
    const ranked = rankCandidates(receipt(), twins, new Set());
    expect(ranked).toHaveLength(2);
    expect(autoLinkDecision(ranked)).toBeNull();
  });

  it("a candidate that is already matched is suggested but never auto-linked", () => {
    const ranked = rankCandidates(receipt(), [txn({ matched: true })], new Set());
    expect(ranked).toHaveLength(1);
    expect(autoLinkDecision(ranked)).toBeNull();
  });

  it("a rejected pair is not suggested again", () => {
    const rejected = new Set([pairKey("receipt", "r1", "transaction", "t1")]);
    expect(rankCandidates(receipt(), [txn()], rejected)).toHaveLength(0);
  });

  it("pair keys ignore order", () => {
    expect(pairKey("receipt", "r1", "transaction", "t1")).toBe(pairKey("transaction", "t1", "receipt", "r1"));
  });

  it("drops candidates under the suggestion threshold and sorts best first", () => {
    const weak = txn({ id: "weak", amountCents: 11240, dateMs: day("2026-09-09"), vendor: "Other" });
    const strong = txn({ id: "strong" });
    const ranked = rankCandidates(receipt(), [weak, strong], new Set());
    expect(ranked[0].candidate.id).toBe("strong");
    for (const r of ranked) expect(r.score).toBeGreaterThanOrEqual(SUGGEST_THRESHOLD);
  });
});
