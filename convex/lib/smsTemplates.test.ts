import { describe, it, expect } from "vitest";
import {
  renderSms,
  displayPhone,
  CLIENT_REMINDER,
  STAFF_REMINDER,
  MANUAL_CLIENT,
} from "./smsTemplates";

describe("displayPhone", () => {
  it("formats US numbers for a human to dial", () => {
    expect(displayPhone("+12138232720")).toBe("(213) 823-2720");
    expect(displayPhone("2138232720")).toBe("(213) 823-2720");
    expect(displayPhone("213-823-2720")).toBe("(213) 823-2720");
  });

  it("passes non-US numbers through instead of mangling them", () => {
    expect(displayPhone("+44 20 7946 0018")).toBe("+44 20 7946 0018");
  });

  it("returns null when there is nothing on file", () => {
    expect(displayPhone(undefined)).toBeNull();
    expect(displayPhone(null)).toBeNull();
    expect(displayPhone("   ")).toBeNull();
  });
});

describe("renderSms", () => {
  it("substitutes variables", () => {
    expect(renderSms("Pulse: {studio} says hi", { studio: "Aurum" })).toBe("Pulse: Aurum says hi");
  });

  it("keeps an optional block when every var inside resolves", () => {
    expect(renderSms("a[[ call {phone}.]] b", { phone: "(213) 823-2720" })).toBe(
      "a call (213) 823-2720. b",
    );
  });

  it("drops the whole optional block when a var is missing or blank", () => {
    expect(renderSms("a[[ call {phone}.]] b", { phone: null })).toBe("a b");
    expect(renderSms("a[[ call {phone}.]] b", { phone: "  " })).toBe("a b");
    expect(renderSms("a[[ call {phone}.]] b", {})).toBe("a b");
  });

  it("never ships an unresolved placeholder to a recipient", () => {
    const out = renderSms(CLIENT_REMINDER, {
      studio: "Aurum Sound Studio",
      title: "Vocal tracking",
      soon: "in about 2 hours",
      date: "Sat Aug 2",
      phone: null,
    });
    expect(out).not.toMatch(/[{}]/);
    expect(out).not.toMatch(/Questions\? Call/);
  });
});

describe("registered message shapes", () => {
  const vars = {
    studio: "Aurum Sound Studio",
    title: "Vocal tracking",
    soon: "in about 2 hours",
    date: "Sat Aug 2",
    phone: "(213) 823-2720",
  };

  it("client reminder matches the A2P sample shape", () => {
    expect(renderSms(CLIENT_REMINDER, vars)).toBe(
      'Pulse: Reminder - "Vocal tracking" at Aurum Sound Studio starts in about 2 hours (Sat Aug 2). ' +
        "Questions? Call (213) 823-2720. Reply STOP to opt out, HELP for help.",
    );
  });

  it("carries the studio's own callback number, not the 10DLC sender", () => {
    expect(renderSms(CLIENT_REMINDER, vars)).toContain("(213) 823-2720");
  });

  it("every automated body leads with the registered brand and offers opt-out", () => {
    for (const tpl of [CLIENT_REMINDER, STAFF_REMINDER]) {
      const body = renderSms(tpl, vars);
      expect(body.startsWith("Pulse:")).toBe(true);
      expect(body).toContain("Reply STOP to opt out");
    }
  });

  it("staff reminder now carries opt-out too (it did not before)", () => {
    expect(renderSms(STAFF_REMINDER, vars)).toBe(
      'Pulse: Aurum Sound Studio - you are booked for "Vocal tracking" in about 2 hours (Sat Aug 2). ' +
        "Reply STOP to opt out.",
    );
  });

  it("manual texts identify Pulse and the studio, then the operator's words", () => {
    expect(renderSms(MANUAL_CLIENT, { studio: "Aurum Sound Studio", body: "Your stems are ready." })).toBe(
      "Pulse: Aurum Sound Studio: Your stems are ready.",
    );
  });
});
