import { describe, expect, it } from "vitest";
import {
  answerPairs, audienceText, autoColumns, buildArgs, dripText, isIdKey, leadWithMeaning, nameForId, sendWhen, summaryParts, weeklyHours, extractRows, fillTemplate, findDeep, fingerprint, getPath, isSecretKey, mergeExtra, nextPage, prefill, prevPage, redactSecrets, shows, unwrapSingle, visibleColumns, FIRST_PAGE,
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

describe("round 2 helpers", () => {
  it("F-U7: redactSecrets hides secret-looking text at any depth and keeps the named ones", () => {
    const data = { key: { name: "Pulse OS", key_prefix: "zu-ab12", rate_limit_per_min: 600 }, hooks: [{ secret: "whsec_1", url: "https://x.example" }], token: "", has_token: true };
    expect(redactSecrets(data)).toEqual({
      key: { name: "Pulse OS", key_prefix: "hidden", rate_limit_per_min: 600 },
      hooks: [{ secret: "hidden", url: "https://x.example" }],
      token: "",
      has_token: true,
    });
    expect(redactSecrets({ secret: "whsec_once", token: "t" }, ["secret"])).toEqual({ secret: "whsec_once", token: "hidden" });
  });

  it("F-V2: visibleColumns drops a column no row fills, never the first", () => {
    const cols = [{ key: "name" }, { key: "opened" }, { key: "results.clicked" }];
    expect(visibleColumns(cols, [{ opened: 3 }, { results: { clicked: null } }]).map((c) => c.key)).toEqual(["name", "opened"]);
    expect(visibleColumns(cols, [{ results: { clicked: 0 } }]).map((c) => c.key)).toEqual(["name", "results.clicked"]);
    expect(visibleColumns(cols, []).map((c) => c.key)).toEqual(["name"]);
  });

  it("F-U5: audienceText describes who in words; the form's choice wins over the saved row", () => {
    const row = { audience: "tags", tags: ["Studio owner", "Demo booked"], not_booked: true, total_recipients: 18 };
    expect(audienceText({}, row)).toBe("everyone tagged Studio owner and Demo booked who has not booked");
    expect(audienceText({ "body:audience": "everyone" }, row)).toBe("everyone with an email address");
    expect(audienceText({}, { audience: "tags", tags: ["3f1c2a9e-1111-4222-8333-444455556666"] })).toBe("everyone with the campaign's chosen tags");
    expect(audienceText({}, null)).toBe("everyone in the campaign's saved audience");
    expect(audienceText({}, row)).not.toMatch(/\d/);
  });

  it("F-U9: fingerprint is stable under key order and changes with any value", () => {
    expect(fingerprint({ b: 1, a: { y: 2, x: 1 } })).toBe(fingerprint({ a: { x: 1, y: 2 }, b: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
    expect(fingerprint(undefined)).toBe("");
  });
});

describe("round 3 helpers", () => {
  it("R3-R3: id keys never lead and are left out of picked columns", () => {
    expect(isIdKey("id")).toBe(true);
    expect(isIdKey("lead_id")).toBe(true);
    expect(isIdKey("results.lead_id")).toBe(true);
    expect(isIdKey("valid_days")).toBe(false);
    expect(leadWithMeaning([{ key: "id" }, { key: "name" }, { key: "lead_id" }]).map((c) => c.key)).toEqual(["name", "id", "lead_id"]);
    expect(autoColumns([{ id: "1", lead_id: "2", name: "A", status: "sent", meta: {} }])).toEqual(["name", "status"]);
    expect(getPath({ first_name: "Maya", last_name: "Lopez" }, "first_name+last_name|name")).toBe("Maya Lopez");
    expect(getPath({ name: "Kai" }, "first_name+last_name|name")).toBe("Kai");
  });

  it("R3-R3: answers as label: value pairs", () => {
    expect(answerPairs([{ question: "Studio", value: "Northline" }, { key: "sms_ok", value: true }, { question: "Empty", value: "" }]))
      .toEqual([["Studio", "Northline"], ["sms ok", "Yes"]]);
    expect(answerPairs({ budget: 300, lead_id: "x", note: "Mixing" })).toEqual([["Budget", "300"], ["Note", "Mixing"]]);
  });

  it("R3-R4: weekly hours, names for ids, one-line summaries", () => {
    expect(weeklyHours({ sun: [], mon: [["09:00", "17:00"]], tue: ["10:00", "14:00"], wed: [{ start: "08:00", end: "12:00" }] }))
      .toEqual([["Mon", "09:00 to 17:00"], ["Tue", "10:00 to 14:00"], ["Wed", "08:00 to 12:00"], ["Sun", "Closed"]]);
    expect(weeklyHours({ timezone: "x" })).toBeNull();
    expect(nameForId({ calendar_id: "c1", calendar_name: "Studio A" }, "calendar_id", "c1")).toBe("Studio A");
    expect(nameForId({ items: [{ id: "c1", title: "B room" }] }, "x_id", "c1")).toBe("B room");
    expect(nameForId({ calendar_id: "c1" }, "calendar_id", "c1")).toBeNull();
    expect(summaryParts({ id: "1", name: "Mix", price: 300, on: true })).toEqual({ title: "Mix", rest: [["Price", "300"], ["On", "Yes"]] });
  });

  it("R3-R2: when and how a send goes, in words", () => {
    expect(sendWhen({})).toBe("now");
    expect(sendWhen({ "body:schedule_at": "2026-11-20T09:30" })).toMatch(/^at .*Nov 20/);
    expect(dripText({}, { drip: { every: 50, minutes: 90 } })).toBe(" A few at a time: 50 emails every 90 minutes.");
    expect(dripText({ "body:drip": "{bad" }, { drip: { every: 5, minutes: 60 } })).toBe("");
    expect(dripText({}, null)).toBe("");
    expect(audienceText({ "body:audience": "stages", "body:stages": "new", "body:not_booked": "yes" }, null)).toBe("everyone in the stages new who has not booked");
  });

  it("R3 secrets: redaction blanks key strings only, never a whole object", () => {
    expect(redactSecrets({ key: { name: "Pulse OS", access_level: "write", rate_limit_per_min: 600, key_prefix: "zu-ab" } }))
      .toEqual({ key: { name: "Pulse OS", access_level: "write", rate_limit_per_min: 600, key_prefix: "hidden" } });
    expect(redactSecrets({ api_key: { name: "Zap", token: "t" } })).toEqual({ api_key: { name: "Zap", token: "hidden" } });
  });
});
