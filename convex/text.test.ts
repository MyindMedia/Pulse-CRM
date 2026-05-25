import { describe, it, expect } from "vitest";
import { stripEmDashes } from "./lib/text";

describe("stripEmDashes (no em dashes egress guard)", () => {
  it("replaces em, en, and horizontal-bar dashes with a hyphen", () => {
    expect(stripEmDashes("Reminder — your session")).toBe("Reminder - your session");
    expect(stripEmDashes("9–5pm")).toBe("9-5pm");
    expect(stripEmDashes("a―b")).toBe("a-b");
  });
  it("leaves plain text + existing hyphens untouched", () => {
    expect(stripEmDashes("Already clean - all good")).toBe("Already clean - all good");
  });
  it("passes through null/undefined", () => {
    expect(stripEmDashes(undefined)).toBeUndefined();
    expect(stripEmDashes(null)).toBeNull();
  });
});
