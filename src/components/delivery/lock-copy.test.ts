import { describe, expect, it } from "vitest";
import { lockCopy } from "./lock-copy";

/* R3-05 and C-14: the locked page's words, by pay target. */

describe("lockCopy", () => {
  it("with a pay target: the amount, the Pay button and the usual line", () => {
    expect(lockCopy({ studioName: "Myind Sound", balanceCents: 18000, payUrl: "https://x.test/pay" })).toEqual({
      heading: "Pay $180.00 to unlock your files",
      body: "Downloads open on this page as soon as the payment goes through.",
      payUrl: "https://x.test/pay",
    });
  });

  it("no pay target: no button, and the studio will send a way to pay (C-14)", () => {
    expect(lockCopy({ studioName: "Myind Sound", balanceCents: 30000, payUrl: null })).toEqual({
      heading: "Pay $300.00 to unlock your files",
      body: "Myind Sound will send you a way to pay. Your files unlock here as soon as it is paid.",
      payUrl: null,
    });
  });

  it("hidden prices: the heading has no amount and nothing on the page shows one (G-23)", () => {
    for (const payUrl of [null, "https://x.test/invoice"]) {
      const copy = lockCopy({ studioName: "Myind Sound", balanceCents: null, payUrl });
      expect(copy.heading).toBe("Your files are ready once the balance is paid");
      expect(`${copy.heading} ${copy.body}`).not.toMatch(/\$|\d/);
    }
    expect(lockCopy({ studioName: "Myind Sound", balanceCents: null, payUrl: null }).body).toBe(
      "Myind Sound will send you a way to pay. Your files unlock here as soon as it is paid.",
    );
  });

  it("an unusable pay link counts as none", () => {
    const copy = lockCopy({ studioName: "Myind Sound", balanceCents: 18000, payUrl: "javascript:alert(1)" });
    expect(copy.payUrl).toBeNull();
    expect(copy.body).toContain("will send you a way to pay");
  });

  it("a zero or missing amount drops the figure, and a blank studio name reads as The studio", () => {
    expect(lockCopy({ studioName: "  ", balanceCents: 0, payUrl: null })).toEqual({
      heading: "Pay to unlock your files",
      body: "The studio will send you a way to pay. Your files unlock here as soon as it is paid.",
      payUrl: null,
    });
  });
});
