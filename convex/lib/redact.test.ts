import { describe, it, expect } from "vitest";
import { redactText, piiTerms } from "./redact";

describe("redactText", () => {
  it("replaces every term, case-insensitive", () => {
    const out = redactText("Call John Doe at john@x.com or JOHN", ["John Doe", "john@x.com", "John"]);
    expect(out).toBe("Call [erased] at [erased] or [erased]");
  });

  it("leaves empty/undefined untouched and ignores short terms", () => {
    expect(redactText(undefined, ["x"])).toBeUndefined();
    expect(redactText("", ["John"])).toBe("");
    expect(redactText("a J session", ["J"])).toBe("a J session"); // 1-char term ignored
  });

  it("escapes regex metacharacters in terms", () => {
    expect(redactText("reach a.b+c@x.com now", ["a.b+c@x.com"])).toBe("reach [erased] now");
  });

  it("uses a custom marker", () => {
    expect(redactText("hi Nova", ["Nova"], "***")).toBe("hi ***");
  });
});

describe("piiTerms", () => {
  it("collects identifying terms longest-first, dropping blanks", () => {
    expect(piiTerms({ name: "Nova Reign", email: "n@x.com", phone: "" })).toEqual(["Nova Reign", "n@x.com"]);
    expect(piiTerms({ name: "", email: undefined })).toEqual([]);
  });
});
