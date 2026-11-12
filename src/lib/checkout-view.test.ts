import { describe, it, expect } from "vitest";
import { checkoutView, bookingToast } from "./checkout-view";

/* R15/R23: a 0% deposit booking opened checkout with a $0.00 deposit chosen,
   which payViaStripe refuses, and the page said "Hold your session" for a
   booking the email called booked. */
describe("checkoutView", () => {
  it("a 0% deposit booking that is confirmed offers only pay in full and says booked", () => {
    const v = checkoutView({ paymentMode: "deposit", depositCents: 0, status: "confirmed" });
    expect(v.fullOnly).toBe(true);
    expect(v.heading).toBe("You're booked");
    expect(v.intro).toContain("2 hours before");
  });

  it("a short-notice 0% hold offers only pay in full", () => {
    const v = checkoutView({ paymentMode: "deposit", depositCents: 0, status: "tentative" });
    expect(v.fullOnly).toBe(true);
    expect(v.heading).toBe("Hold your session");
    expect(v.intro).toContain("Pay in full");
  });

  it("a paid-in-full room is full only", () => {
    expect(checkoutView({ paymentMode: "full", depositCents: 20000, status: "tentative" }).fullOnly).toBe(true);
  });

  it("a room with a real deposit still offers the deposit", () => {
    const v = checkoutView({ paymentMode: "deposit", depositCents: 6000, status: "tentative" });
    expect(v.fullOnly).toBe(false);
    expect(v.intro).toContain("deposit");
  });
});

describe("bookingToast", () => {
  it("a confirmed 0% booking is booked, not held", () => {
    expect(bookingToast({ depositCents: 0, status: "confirmed" }, false)).toBe(
      "Booked - pay the balance 2 hours before start.",
    );
  });

  it("a hold still asks to finish payment", () => {
    expect(bookingToast({ depositCents: 6000, status: "tentative" }, false)).toBe(
      "Booking held - finish payment to confirm.",
    );
    expect(bookingToast({ depositCents: 0, status: "tentative" }, false)).toBe(
      "Booking held - finish payment to confirm.",
    );
  });

  it("a link without prices sends a request", () => {
    expect(bookingToast({}, true)).toContain("Request sent");
  });
});
