import { describe, expect, it } from "vitest";
import { lockCopy, type LockCopy } from "./lock-copy";

/* The locked client page's words, driven by payUrl, balanceCents and
   nothingOwed (Addendum 5, page table). Every cell is pinned below. */

const STUDIO = "Myind Sound";
const PAY = "https://x.test/pay";

describe("lockCopy: the page table (Addendum 5)", () => {
  const ROWS: Array<{ situation: string; input: Parameters<typeof lockCopy>[0]; expected: LockCopy }> = [
    {
      situation: "exact-match target",
      input: { studioName: STUDIO, balanceCents: 18000, payUrl: PAY, nothingOwed: false },
      expected: {
        heading: "Pay $180.00 to unlock your files",
        body: "Downloads open on this page as soon as the payment goes through.",
        payUrl: PAY,
        balanceDue: true,
      },
    },
    {
      situation: "no target, amount visible",
      input: { studioName: STUDIO, balanceCents: 30000, payUrl: null, nothingOwed: false },
      expected: {
        heading: "There is a $300.00 balance on this booking",
        body: "Myind Sound will be in touch about payment. Your files unlock here as soon as the balance is paid.",
        payUrl: null,
        balanceDue: true,
      },
    },
    {
      situation: "no target, prices hidden",
      input: { studioName: STUDIO, balanceCents: null, payUrl: null, nothingOwed: false },
      expected: {
        heading: "Your files are ready once the balance is paid",
        body: "Myind Sound will be in touch about payment. Your files unlock here as soon as the balance is paid.",
        payUrl: null,
        balanceDue: true,
      },
    },
    {
      situation: "nothing owed, amount visible",
      input: { studioName: STUDIO, balanceCents: 0, payUrl: null, nothingOwed: true },
      expected: {
        heading: "Payment received",
        body: "Myind Sound is sending your files. This page unlocks as soon as they do.",
        payUrl: null,
        balanceDue: false,
      },
    },
    {
      situation: "nothing owed, prices hidden",
      input: { studioName: STUDIO, balanceCents: null, payUrl: null, nothingOwed: true },
      expected: {
        heading: "Payment received",
        body: "Myind Sound is sending your files. This page unlocks as soon as they do.",
        payUrl: null,
        balanceDue: false,
      },
    },
  ];

  for (const row of ROWS) {
    it(`${row.situation}`, () => {
      expect(lockCopy(row.input)).toEqual(row.expected);
    });
  }
});

describe("lockCopy: edge cases", () => {
  it("a blank studio name reads as The studio", () => {
    expect(lockCopy({ studioName: " ", balanceCents: 30000, payUrl: null, nothingOwed: false }).body).toBe(
      "The studio will be in touch about payment. Your files unlock here as soon as the balance is paid.",
    );
    expect(lockCopy({ studioName: " ", balanceCents: 0, payUrl: null, nothingOwed: true }).body).toBe(
      "The studio is sending your files. This page unlocks as soon as they do.",
    );
  });

  it("an unusable pay link counts as none", () => {
    const copy = lockCopy({ studioName: STUDIO, balanceCents: 18000, payUrl: "javascript:alert(1)", nothingOwed: false });
    expect(copy.payUrl).toBeNull();
    expect(copy.heading).toBe("There is a $180.00 balance on this booking");
  });

  it("a missing pay link (undefined) counts as none", () => {
    expect(lockCopy({ studioName: STUDIO, balanceCents: 18000, payUrl: undefined, nothingOwed: false }).payUrl).toBeNull();
  });

  it("nothing owed never shows a stray pay link", () => {
    expect(lockCopy({ studioName: STUDIO, balanceCents: 0, payUrl: PAY, nothingOwed: true }).payUrl).toBeNull();
  });

  it("hidden prices never show an amount or a digit, with or without a link", () => {
    for (const payUrl of [null, PAY]) {
      const copy = lockCopy({ studioName: STUDIO, balanceCents: null, payUrl, nothingOwed: false });
      expect(`${copy.heading} ${copy.body}`).not.toMatch(/\$|\d/);
    }
  });

  it("a pay button never appears without an amount shown", () => {
    expect(lockCopy({ studioName: STUDIO, balanceCents: null, payUrl: PAY, nothingOwed: false }).payUrl).toBeNull();
  });
});

describe("lockCopy: the client page never says invoice or sent you", () => {
  it("no string lockCopy can return contains invoice or sent you", () => {
    const studios = [STUDIO, " ", ""];
    const cents = [null, 0, 1, 18000, 3000000];
    const payUrls = [null, undefined, PAY, "javascript:alert(1)"];
    const seen: string[] = [];
    for (const studioName of studios)
      for (const balanceCents of cents)
        for (const payUrl of payUrls)
          for (const nothingOwed of [true, false]) {
            const copy = lockCopy({ studioName, balanceCents, payUrl, nothingOwed });
            seen.push(copy.heading, copy.body);
          }
    expect(seen.length).toBe(2 * studios.length * cents.length * payUrls.length * 2);
    for (const text of seen) {
      expect(text).not.toMatch(/invoice/i);
      expect(text).not.toMatch(/sent you/i);
    }
  });
});
