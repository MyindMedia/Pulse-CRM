import { describe, it, expect } from "vitest";
import { redact, maskPhone, callEligibility, canTransition, readiness, STATUS_MEANING } from "./policy";

describe("outreach policy", () => {
  it("redacts bearer tokens, provider keys and long hex runs", () => {
    const s = redact("Bearer abc.def-123 re_ABCDEFGH1234 " + "a".repeat(40))!;
    expect(s).not.toMatch(/abc\.def|re_ABCDEFGH|aaaaaaaa/);
  });
  it("masks all but two phone digits", () => {
    expect(maskPhone("+14085550123")).toBe("••• 23");
    expect(maskPhone("12")).toBe("unknown");
  });
  it("never turns missing consent into a yes", () => {
    const base = { consent: true, dnd: false, suppressed: false, status: "confirmed" };
    expect(callEligibility({ ...base, consent: false }, true).state).toBe("ineligible");
    expect(callEligibility({ ...base, dnd: true }, true).state).toBe("ineligible");
    expect(callEligibility({ ...base, suppressed: true }, true).state).toBe("ineligible");
    expect(callEligibility({ ...base, status: "cancelled" }, true).state).toBe("ineligible");
    expect(callEligibility(base, false).state).toBe("disabled");
    expect(callEligibility(base, true).state).toBe("eligible");
    expect(callEligibility({ ...base, callId: "c1" }, true).state).toBe("called");
  });
  it("lifecycle is forward-only and terminal states are final", () => {
    expect(canTransition("submitting", "accepted")).toBe(true);
    expect(canTransition("unknown", "delivered")).toBe(true);
    expect(canTransition("delivered", "accepted")).toBe(false);
    expect(canTransition("bounced", "delivered")).toBe(false);
    expect(canTransition("accepted", "draft")).toBe(false);
    expect(canTransition("accepted", "accepted")).toBe(false);
  });
  it("every status has a plain-language meaning and accepted is not delivered", () => {
    expect(STATUS_MEANING.accepted).toMatch(/not inbox delivery/i);
    expect(Object.values(STATUS_MEANING).every((m) => m.length > 10)).toBe(true);
  });
  it("a fresh agency has nothing ready and is paused", () => {
    const items = readiness({ settings: null, approvedTemplates: 0, walkthroughEnabled: false, walkthroughSchemaAudited: false });
    expect(items.filter((i) => i.state === "ready")).toHaveLength(0);
    expect(items.find((i) => i.key === "pause")?.state).toBe("disabled");
  });
});
