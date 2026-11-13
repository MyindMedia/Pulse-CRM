import { describe, expect, it } from "vitest";
import { lockCopy } from "./lock-copy";

/* R3-05 and C-14: the locked page's words, by pay target. */

describe("lockCopy", () => {
  it("with a pay target: the amount, the Pay button and the usual line", () => {
    expect(lockCopy({ studioName: "Myind Sound", balanceCents: 18000, payUrl: "https://x.test/pay" })).toEqual({
      heading: "Pay $180.00 to unlock your files",
      body: "Downloads open on this page as soon as the payment goes through.",
      payUrl: "https://x.test/pay",
      balanceDue: true,
    });
  });

  it("no pay target: no button, and the studio will send a way to pay (C-14)", () => {
    expect(lockCopy({ studioName: "Myind Sound", balanceCents: 30000, payUrl: null })).toEqual({
      heading: "Pay $300.00 to unlock your files",
      body: "Myind Sound will send you a way to pay. Your files unlock here as soon as it is paid.",
      payUrl: null,
      balanceDue: true,
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

  it("R4-04: nothing owed: Payment received, no Balance due pill, no pay wording, no button", () => {
    const copy = lockCopy({ studioName: "Myind Sound", balanceCents: 0, payUrl: null });
    expect(copy).toEqual({
      heading: "Payment received",
      body: "Myind Sound is sending your files. This page unlocks as soon as they do.",
      payUrl: null,
      balanceDue: false,
    });
    expect(`${copy.heading} ${copy.body}`).not.toMatch(/pay to|way to pay|balance/i);
    // A stray link is never shown when nothing is owed.
    expect(lockCopy({ studioName: "Myind Sound", balanceCents: 0, payUrl: "https://x.test/pay" }).payUrl).toBeNull();
  });

  it("R4-04: a blank studio name reads as The studio in the nothing-owed line", () => {
    expect(lockCopy({ studioName: " ", balanceCents: 0, payUrl: null }).body).toBe(
      "The studio is sending your files. This page unlocks as soon as they do.",
    );
  });

  it("P4-02: no pay target and an open invoice: pay with the invoice the studio sent", () => {
    const LINE = "Pay with the invoice Myind Sound sent you. Your files unlock here as soon as it is paid.";
    expect(lockCopy({ studioName: "Myind Sound", balanceCents: 30000, payUrl: null, invoiceOpen: true })).toEqual({
      heading: "Pay $300.00 to unlock your files",
      body: LINE,
      payUrl: null,
      balanceDue: true,
    });
    // Hidden prices: still no amount anywhere.
    const hidden = lockCopy({ studioName: "Myind Sound", balanceCents: null, payUrl: null, invoiceOpen: true });
    expect(hidden.body).toBe(LINE);
    expect(`${hidden.heading} ${hidden.body}`).not.toMatch(/\$|\d/);
    // An unusable link counts as none here too.
    expect(lockCopy({ studioName: "Myind Sound", balanceCents: 18000, payUrl: "javascript:alert(1)", invoiceOpen: true }).body).toBe(LINE);
    // A blank studio name.
    expect(lockCopy({ studioName: " ", balanceCents: 18000, payUrl: null, invoiceOpen: true }).body).toBe(
      "Pay with the invoice The studio sent you. Your files unlock here as soon as it is paid.",
    );
  });

  it("P4-02: no open invoice: the studio will send a way to pay, as before", () => {
    for (const invoiceOpen of [false, undefined]) {
      expect(lockCopy({ studioName: "Myind Sound", balanceCents: 30000, payUrl: null, invoiceOpen }).body).toBe(
        "Myind Sound will send you a way to pay. Your files unlock here as soon as it is paid.",
      );
    }
  });

  it("P4-02: with a pay target, an open invoice changes nothing", () => {
    expect(lockCopy({ studioName: "Myind Sound", balanceCents: 18000, payUrl: "https://x.test/pay", invoiceOpen: true })).toEqual({
      heading: "Pay $180.00 to unlock your files",
      body: "Downloads open on this page as soon as the payment goes through.",
      payUrl: "https://x.test/pay",
      balanceDue: true,
    });
  });

  it("P4-02: nothing owed stays Payment received, open invoice or not (R4-04)", () => {
    expect(lockCopy({ studioName: "Myind Sound", balanceCents: 0, payUrl: null, invoiceOpen: true })).toEqual({
      heading: "Payment received",
      body: "Myind Sound is sending your files. This page unlocks as soon as they do.",
      payUrl: null,
      balanceDue: false,
    });
  });

  it("balanceDue is true for an amount, and for hidden prices", () => {
    expect(lockCopy({ studioName: "S", balanceCents: 100, payUrl: null }).balanceDue).toBe(true);
    expect(lockCopy({ studioName: "S", balanceCents: null, payUrl: null }).balanceDue).toBe(true);
  });
});
