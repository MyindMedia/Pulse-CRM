import { describe, it, expect } from "vitest";
import {
  displayName, initialsOf, hostName, needsAction, matchesFilter, matchesSearch, latestActivity, mergeTimeline,
  latestOpenable, defaultOpen, previewLine, type InboxRow, type TimelineItem,
} from "./inbox";

const row = (extra: Partial<InboxRow> = {}): InboxRow => ({
  id: "p1" as InboxRow["id"], name: "MIX Recording", handle: "mixrec", host: "mix.com", websiteUrl: "https://mix.com",
  primaryEmail: "jane@mix.com", emails: ["jane@mix.com", "info@mix.com"], status: "queued", note: null, createdAt: 1,
  lastActivityAt: 1, lastKind: "status", lastDirection: null, lastSnippet: null, hasUnreadReply: false, replied: false,
  replyIntent: null, bookedAt: null, optedOut: false, routingConfirmed: false, sequence: { step: 0, status: "active" }, ...extra,
});

const ev = (id: string, at: number): TimelineItem => ({ id, at, kind: "event", direction: null, text: id });
const dm = (id: string, at: number): TimelineItem => ({ id, at, kind: "dm", direction: "out", status: "sent", handle: "mix", text: "hi", snippet: "hi" });

describe("outreach inbox rules", () => {
  it("names a studio by its name, then its handle, then its website", () => {
    expect(displayName({ name: " Ice Cream Sound ", handle: "ics" })).toBe("Ice Cream Sound");
    expect(displayName({ name: "", handle: "mixrec", websiteUrl: "https://mix.com" })).toBe("@mixrec");
    expect(displayName({ websiteUrl: "https://www.unionsound.com/la" })).toBe("unionsound.com");
    expect(displayName({})).toBe("Unnamed studio");
    expect(hostName("not a url")).toBe("not a url");
  });

  it("makes two-letter initials from a name, a handle or a host", () => {
    expect(initialsOf("Ice Cream Sound")).toBe("IC");
    expect(initialsOf("@mixstudio")).toBe("MI");
    expect(initialsOf("unionsound.com")).toBe("UN");
    expect(initialsOf("Studio Élan")).toBe("SÉ");
    expect(initialsOf("!!!")).toBe("?");
  });

  it("needs action: a reply to read or answer, a website to confirm, a site to read, a studio to queue or email", () => {
    expect(needsAction(row({ hasUnreadReply: true }))).toBe(true);
    expect(needsAction(row({ lastDirection: "in" }))).toBe(true);
    for (const status of ["needs_website", "ready_to_scrape", "scraped", "unreachable"]) expect(needsAction(row({ status, sequence: null }))).toBe(true);
    expect(needsAction(row({ status: "queued", sequence: null }))).toBe(true); // not emailed yet
    expect(needsAction(row({ status: "queued", lastDirection: "out" }))).toBe(false); // emailed, waiting on them
    expect(needsAction(row({ status: "blocked", sequence: null }))).toBe(false);
    expect(needsAction(row({ optedOut: true, hasUnreadReply: true }))).toBe(false); // opted out never needs action
  });

  it("filters and searches rows", () => {
    expect(matchesFilter(row({ replied: true }), "replied")).toBe(true);
    expect(matchesFilter(row(), "replied")).toBe(false);
    expect(matchesFilter(row({ bookedAt: 5 }), "booked")).toBe(true);
    expect(matchesFilter(row({ optedOut: true }), "opted_out")).toBe(true);
    expect(matchesFilter(row(), "all")).toBe(true);
    expect(matchesSearch(row(), "@MIXREC")).toBe(true);
    expect(matchesSearch(row(), "info@mix")).toBe(true);
    expect(matchesSearch(row(), "union")).toBe(false);
    expect(matchesSearch(row(), "  ")).toBe(true);
  });

  it("latest activity is the newest message; with none it is when the studio was added", () => {
    expect(latestActivity([], 42)).toEqual({ at: 42, kind: "status", direction: null, snippet: null });
    const out = { at: 10, kind: "email" as const, direction: "out" as const, snippet: "Hi" };
    const reply = { at: 10, kind: "mail" as const, direction: "in" as const, snippet: "Thanks" };
    expect(latestActivity([out, reply], 1)).toBe(reply); // a tie goes to the received message
    expect(latestActivity([reply, { ...out, at: 11 }], 1).snippet).toBe("Hi");
  });

  it("previews collapse whitespace and stop at a length", () => {
    expect(previewLine("Hi  MIX team,\n\nSaw the new room.")).toBe("Hi MIX team, Saw the new room.");
    expect(previewLine("x".repeat(200), 10)).toBe(`${"x".repeat(9)}…`);
    expect(previewLine(null)).toBe("");
  });

  it("merges the timeline oldest first, drops duplicates, and keeps the newest when capped", () => {
    const merged = mergeTimeline([dm("dm:2", 20), ev("event:added", 5), ev("event:read", 20), dm("dm:2", 99), dm("dm:1", 10)]);
    expect(merged.items.map((i) => i.id)).toEqual(["event:added", "dm:1", "event:read", "dm:2"]);
    expect(merged.truncated).toBe(false);
    const capped = mergeTimeline([ev("a", 1), ev("b", 2), ev("c", 3)], 2);
    expect(capped.items.map((i) => i.id)).toEqual(["b", "c"]);
    expect(capped.truncated).toBe(true);
  });

  it("opens the newest message, the newest email behind a waiting draft, and every unread reply", () => {
    const email = (id: string, at: number, unread = false): TimelineItem => ({
      id, at, kind: "email", source: "mail", direction: "in", from: "a@b.c", to: [], cc: [], subject: "s", snippet: "", text: null, html: null,
      htmlTruncated: false, bodyOmitted: false, bodyPending: false, label: null, draftId: null, messageId: null, threadId: null, unread,
      delivery: null, intent: null, attachments: [], authFailed: false,
    });
    const draft: TimelineItem = { id: "pending:1", at: 9, kind: "draft", direction: "out", draftId: "d" as never, status: "draft", holdReason: null, label: "l", from: "f", to: [], subject: "s", snippet: "", text: "" };
    expect([...defaultOpen([email("mail:1", 1, true), email("mail:2", 2), email("mail:3", 3), draft])]).toEqual(["pending:1", "mail:3", "mail:1"]);
    expect([...defaultOpen([email("mail:1", 1), dm("dm:1", 2)])]).toEqual(["dm:1", "mail:1"]);
    expect([...defaultOpen([ev("a", 1)])]).toEqual(["a"]);
  });

  it("opens the newest message by default, else the newest item", () => {
    expect(latestOpenable([ev("a", 1), dm("dm:1", 2), ev("b", 3)])).toBe("dm:1");
    expect(latestOpenable([ev("a", 1), ev("b", 3)])).toBe("b");
    expect(latestOpenable([])).toBeNull();
  });
});
