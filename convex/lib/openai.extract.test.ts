import { describe, it, expect } from "vitest";
import { extractJson } from "./openai";

describe("extractJson", () => {
  it("returns a bare JSON object unchanged", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it("strips markdown code fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('```\n{"b":2}\n```')).toBe('{"b":2}');
  });

  it("pulls the object out of surrounding prose", () => {
    const out = extractJson('Sure! Here is the result:\n{"summary":"ok"}\nHope that helps.');
    expect(out).toBe('{"summary":"ok"}');
    expect(JSON.parse(out!)).toEqual({ summary: "ok" });
  });

  it("takes the outermost braces for nested objects", () => {
    const text = '{"a":{"b":2},"c":3}';
    expect(JSON.parse(extractJson(text)!)).toEqual({ a: { b: 2 }, c: 3 });
  });

  it("returns null when there is no object", () => {
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson("")).toBeNull();
  });
});
