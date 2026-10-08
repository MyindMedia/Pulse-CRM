import { describe, it, expect } from "vitest";
import { normalizeSubject, parseMessageIds, lookupOrder, chooseBySubject, buildReferences, replySubject, SUBJECT_THREAD_WINDOW_MS } from "./threading";

describe("threading helpers", () => {
  it("normalizes reply and forward prefixes", () => {
    expect(normalizeSubject("Re: Fwd: RE:  Hello   World")).toBe("hello world");
    expect(normalizeSubject("AW: SV: [ext] Booking")).toBe("booking");
    expect(normalizeSubject("Re[2]: Rates")).toBe("rates");
    expect(normalizeSubject("Regarding the session")).toBe("regarding the session");
    expect(normalizeSubject(undefined)).toBe("");
  });

  it("parses message ids from header values", () => {
    expect(parseMessageIds("<a@x> <b@y>\r\n <c@z>")).toEqual(["<a@x>", "<b@y>", "<c@z>"]);
    expect(parseMessageIds("bare@id.example")).toEqual(["<bare@id.example>"]);
    expect(parseMessageIds(undefined)).toEqual([]);
  });

  it("looks up In-Reply-To first, then References newest first", () => {
    expect(lookupOrder("<c>", ["<a>", "<b>", "<c>"])).toEqual(["<c>", "<b>", "<a>"]);
    expect(lookupOrder(undefined, ["<a>", "<b>"])).toEqual(["<b>", "<a>"]);
  });

  it("subject fallback needs the sender as a participant, inside the window", () => {
    const now = 10 * SUBJECT_THREAD_WINDOW_MS;
    const c = [
      { id: "old", participants: ["jane@x.com"], lastMessageAt: now - SUBJECT_THREAD_WINDOW_MS - 1, status: "open" },
      { id: "other", participants: ["bob@x.com"], lastMessageAt: now - 10, status: "open" },
      { id: "hit", participants: ["jane@x.com"], lastMessageAt: now - 100, status: "archived" },
    ];
    expect(chooseBySubject(c, "jane@x.com", now)).toBe("hit");
    expect(chooseBySubject(c, "nobody@x.com", now)).toBeNull();
    expect(chooseBySubject(c, null, now)).toBeNull();
  });

  it("builds References latest last and Re: once", () => {
    expect(buildReferences(["<a>", "<b>"], "<c>")).toEqual(["<a>", "<b>", "<c>"]);
    expect(buildReferences(["<a>", "<c>"], "<c>")).toEqual(["<a>", "<c>"]);
    expect(replySubject("Hello")).toBe("Re: Hello");
    expect(replySubject("RE: Hello")).toBe("RE: Hello");
  });
});
