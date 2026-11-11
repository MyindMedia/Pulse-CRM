import { describe, expect, it } from "vitest";
import {
  buildArgs, extractRows, fillTemplate, findDeep, getPath, isSecretKey, mergeExtra, nextPage, prefill, prevPage, shows, unwrapSingle, FIRST_PAGE,
} from "./resource-utils";
import type { FieldDef } from "./resource-config";

describe("reading answers", () => {
  it("getPath tries dotted paths and alternatives", () => {
    const row = { results: { opened: 4 }, name: "Spring" };
    expect(getPath(row, "stats.opened|results.opened")).toBe(4);
    expect(getPath(row, "subject|name")).toBe("Spring");
    expect(getPath(row, "nope")).toBeUndefined();
  });

  it("extractRows uses rowsKey or the first array", () => {
    expect(extractRows({ has_more: false, campaigns: [{ id: "a" }, 3] })).toEqual([{ id: "a" }]);
    expect(extractRows({ members: [{ id: "m" }], pending_invites: [{ id: "i" }] }, "pending_invites")).toEqual([{ id: "i" }]);
    expect(extractRows(null)).toEqual([]);
    expect(extractRows({ count: 2 })).toEqual([]);
  });

  it("unwrapSingle opens a one-object answer and keeps top-level flags", () => {
    expect(unwrapSingle({ configured: true, ai_texting: { agent_name: "Sarah" }, has_phone_number: false }))
      .toEqual({ configured: true, has_phone_number: false, agent_name: "Sarah" });
    expect(unwrapSingle({ a: { x: 1 }, b: { y: 2 } })).toEqual({ a: { x: 1 }, b: { y: 2 } });
    expect(unwrapSingle("x")).toBeNull();
  });

  it("hides secrets and finds a revealed one", () => {
    expect(isSecretKey("signing_secret")).toBe(true);
    expect(isSecretKey("key_prefix")).toBe(true);
    expect(isSecretKey("name")).toBe(false);
    expect(findDeep({ outbound_webhook: { id: "w1", secret: "whsec_abc" } }, ["signing_secret", "secret"])).toBe("whsec_abc");
    expect(findDeep({ id: "w1" }, ["secret"])).toBeNull();
  });
});

describe("confirm text", () => {
  it("fills count, name and field values", () => {
    expect(fillTemplate("Enroll {count} leads into {name}?", { count: 3, name: "Demo booked" })).toBe("Enroll 3 leads into Demo booked?");
    expect(fillTemplate("Send to {count} people", { count: null })).toBe("Send to an uncounted number of people");
    expect(fillTemplate("Invite {email}?", { values: { email: "a@b.example" } })).toBe("Invite a@b.example?");
  });
});

const F: FieldDef[] = [
  { name: "name", label: "Name", type: "text", required: true },
  { name: "count", label: "Count", type: "number" },
  { name: "on", label: "On", type: "boolean" },
  { name: "tags", label: "Tags", type: "textarea", list: true },
  { name: "items", label: "Items", type: "json", jsonShape: "array" },
  { name: "lead_id", label: "Lead id", type: "text", in: "path" },
  { name: "channel", label: "Channel", type: "select", options: ["sms", "email"], in: "query" },
];

describe("forms", () => {
  it("builds path, query and body, and skips empty fields", () => {
    const out = buildArgs(F, { "body:name": " Maya ", "body:count": "1,200", "body:on": "no", "body:tags": "VIP, Demo\nNew", "body:items": "[1]", "path:lead_id": "lead-1", "query:channel": "sms" }, { fixed: { kind: "x" } });
    expect(out).toEqual({ path: { lead_id: "lead-1" }, query: { channel: "sms" }, body: { kind: "x", name: "Maya", count: 1200, on: false, tags: ["VIP", "Demo", "New"], items: [1] } });
  });

  it("refuses a missing required field, a bad number, bad JSON, the wrong JSON shape and a bad path value", () => {
    expect(buildArgs(F, {})).toEqual({ error: "Name is required." });
    expect(buildArgs(F, { "body:name": "a", "body:count": "ten" })).toEqual({ error: "Count must be a number." });
    expect(buildArgs(F, { "body:name": "a", "body:items": "[1," })).toEqual({ error: "Items is not valid JSON. Check the brackets and quotes." });
    expect(buildArgs(F, { "body:name": "a", "body:items": "{}" })).toEqual({ error: "Items must be a JSON list ([ ... ])." });
    expect(buildArgs(F, { "body:name": "a", "path:lead_id": "../x" })).toEqual({ error: "Lead id has characters that are not allowed." });
  });

  it("a prefilled edit sends only what changed, and null for a cleared text", () => {
    const source = { name: "Maya", count: 2, on: true, tags: ["VIP"] };
    const initial = prefill(F, source);
    expect(initial["body:tags"]).toBe("VIP");
    expect(buildArgs(F, initial, { initial })).toEqual({ error: "Nothing changed." });
    expect(buildArgs(F, { ...initial, "body:count": "3" }, { initial })).toEqual({ path: {}, query: {}, body: { count: 3 } });
    expect(buildArgs(F.slice(1), { ...initial, "body:count": "" }, { initial })).toEqual({ path: {}, query: {}, body: { count: null } });
  });

  it("merges a free JSON object under the named fields", () => {
    expect(mergeExtra({ label: "Won" }, '{"label":"x","hidden":true}')).toEqual({ body: { label: "Won", hidden: true } });
    expect(mergeExtra({}, "[1]")).toEqual({ error: "More fields must be a JSON object ({ ... })." });
    expect(mergeExtra({}, "{")).toEqual({ error: "More fields is not valid JSON. Check the brackets and quotes." });
    expect(mergeExtra({ a: 1 }, "  ")).toEqual({ body: { a: 1 } });
  });
});

describe("paging and conditions", () => {
  it("offset and cursor paging", () => {
    expect(nextPage("offset", FIRST_PAGE, { has_more: true, next_offset: 25 }, 25, 25)).toEqual({ offset: 25, cursors: [] });
    expect(nextPage("offset", FIRST_PAGE, { has_more: false }, 25, 25)).toBeNull();
    const p2 = nextPage("cursor", FIRST_PAGE, { has_more: true, next_cursor: "c2" }, 25, 25);
    expect(p2).toEqual({ offset: 0, cursors: ["c2"] });
    expect(prevPage("cursor", p2!, 25)).toEqual(FIRST_PAGE);
    expect(nextPage("cursor", FIRST_PAGE, { next_cursor: null }, 25, 25)).toBeNull();
    expect(nextPage("none", FIRST_PAGE, { has_more: true }, 25, 25)).toBeNull();
  });

  it("row conditions", () => {
    expect(shows({ key: "status", in: ["draft"] }, { status: "draft" })).toBe(true);
    expect(shows({ key: "status", in: ["draft"] }, { status: "sent" })).toBe(false);
    expect(shows({ key: "enabled", in: [false, null] }, {})).toBe(true);
    expect(shows(undefined, null)).toBe(true);
  });
});
