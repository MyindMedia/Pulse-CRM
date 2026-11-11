import { describe, expect, it } from "vitest";
import {
  applyDraftChange, channelOptions, classifyEvent, contactSlots, conversationsQuery, defaultChannel, draftProblem, emptyDraft,
  filterCount, htmlToText, mergeConversations, previewText, safeUrl, searchTerm, sendRequest, socialWindowEnds, threadItems,
  validateSchedule, type ComposerDraft,
} from "./inbox-logic";
import { INBOX_OP } from "./inbox-ops";
import type { Conversation, ThreadEvent } from "./inbox-types";
import type { ConfirmGrant } from "./crm-ui";
import { DEV, MAYA } from "./crm-test-fixtures";

const NOW = Date.parse("2026-11-11T18:00:00Z");
const grant = { confirm: true } as unknown as ConfirmGrant;
let n = 0;
const mk = () => `idem-${++n}`;

describe("list query", () => {
  it("search is sent only from 2 to 80 characters", () => {
    expect(searchTerm(" a ")).toBeUndefined();
    expect(searchTerm(" ma ")).toBe("ma");
    expect(searchTerm("x".repeat(81))).toBeUndefined();
  });

  it("filters map to Zuops query params", () => {
    expect(conversationsQuery("archived", "", null)).toMatchObject({ archived: true, limit: 25 });
    expect(conversationsQuery("unread", "maya", "c1")).toMatchObject({ unread: true, search: "maya", cursor: "c1" });
    expect(conversationsQuery("unassigned", "")).toMatchObject({ assigned_to: "unassigned" });
    expect(conversationsQuery("inbox", "")).toMatchObject({ archived: undefined, unread: undefined });
  });

  it("counts come from Zuops; Unassigned has none", () => {
    const counts = { open: 4, unread: 2, archived: 9 };
    expect(filterCount("inbox", counts, null, null)).toBe("4");
    expect(filterCount("unread", counts, null, null)).toBe("2");
    expect(filterCount("unassigned", counts, null, null)).toBeNull();
    expect(filterCount("scheduled", counts, { n: 100, more: true }, null)).toBe("100+");
  });

  it("later pages never duplicate a conversation", () => {
    const a = { lead_id: "a" } as Conversation, b = { lead_id: "b" } as Conversation;
    expect(mergeConversations([a], [a, b]).map((c) => c.lead_id)).toEqual(["a", "b"]);
  });

  it("preview strips html and marks outbound", () => {
    const c = { lead_id: "a", last_message: { body: "<p>Hi <b>there</b></p>", direction: "outbound", channel: "email" } } as unknown as Conversation;
    expect(previewText(c)).toBe("You: Hi there");
  });
});

describe("thread", () => {
  const events: ThreadEvent[] = [
    { id: "e2", event_type: "sms_outbound", body: "Second", created_at: "2026-11-11T17:00:00Z" } as ThreadEvent,
    { id: "e1", event_type: "sms_inbound", body: "First", created_at: "2026-11-11T16:00:00Z" } as ThreadEvent,
  ];

  it("is oldest first", () => {
    expect(threadItems(events).map((i) => i.id)).toEqual(["e1", "e2"]);
  });

  it("classifies direction", () => {
    expect(classifyEvent({ event_type: "sms_inbound", metadata: null } as ThreadEvent).direction).toBe("inbound");
  });

  it("email html becomes plain text, no script survives", () => {
    const t = htmlToText("<div>Hello<br>World<script>alert(1)</script></div>");
    expect(t).toContain("Hello");
    expect(t).toContain("World");
    expect(t).not.toContain("alert");
  });

  it("only http(s) links are kept", () => {
    expect(safeUrl("https://cdn.example/a.jpg")).toBe("https://cdn.example/a.jpg");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("channels a lead can receive (X-05)", () => {
  it("text and email open with a phone and email", () => {
    const opts = channelOptions(MAYA, "sms", [], NOW);
    expect(opts.find((o) => o.channel === "sms")?.available).toBe(true);
    expect(opts.find((o) => o.channel === "email")?.available).toBe(true);
    expect(defaultChannel(opts, "sms")).toBe("sms");
  });

  it("opt-out and do not contact turn channels off with a reason", () => {
    const optedOut = channelOptions({ ...MAYA, sms_opt_out: true } as typeof MAYA, "sms", [], NOW);
    expect(optedOut.find((o) => o.channel === "sms")).toMatchObject({ available: false, reason: "This lead opted out of texts." });
    const dnc = channelOptions({ ...MAYA, do_not_contact: true } as typeof MAYA, "sms", [], NOW);
    expect(dnc.every((o) => !o.available)).toBe(true);
    const noEmail = channelOptions({ ...MAYA, email: null }, "sms", [], NOW);
    expect(noEmail.find((o) => o.channel === "email")?.reason).toBe("No email address on this lead.");
  });

  it("Instagram only inside 24 hours of their last message", () => {
    const inside = threadItems([{ id: "i1", event_type: "instagram_inbound", body: "hey", created_at: "2026-11-11T10:00:00Z" } as ThreadEvent]);
    expect(inside[0].kind).toBe("instagram");
    expect(socialWindowEnds(inside, "instagram")).toBe(Date.parse("2026-11-12T10:00:00Z"));
    expect(channelOptions(DEV, "instagram", inside, NOW).find((o) => o.channel === "instagram")?.available).toBe(true);
    const later = NOW + 2 * 86_400_000;
    const closed = channelOptions(DEV, "instagram", inside, later).find((o) => o.channel === "instagram");
    expect(closed?.available).toBe(false);
    expect(closed?.reason).toContain("24 hour reply window closed");
  });
});

describe("schedule", () => {
  it("must be future and within 365 days", () => {
    expect(validateSchedule("", NOW).ok).toBe(false);
    expect(validateSchedule("2020-01-01T09:00", NOW)).toMatchObject({ ok: false, reason: "Pick a time in the future." });
    expect(validateSchedule("2028-01-01T09:00", NOW)).toMatchObject({ ok: false });
    expect(validateSchedule("2026-11-20T09:00", NOW).ok).toBe(true);
  });
});

describe("composer draft and idempotency (X-02)", () => {
  const sms = channelOptions(MAYA, "sms", [], NOW).find((o) => o.channel === "sms");

  it("the key stays on retry and changes when the message changes", () => {
    const d0 = emptyDraft("sms", mk);
    const d1 = applyDraftChange(d0, { text: "Hi Maya" }, mk);
    expect(d1.idem).not.toBe(d0.idem);
    const same = applyDraftChange(d1, { text: "Hi Maya" }, mk);
    expect(same.idem).toBe(d1.idem);
    const d2 = applyDraftChange(d1, { sendAt: "2026-11-20T09:00" }, mk);
    expect(d2.idem).not.toBe(d1.idem);
  });

  it("problems block sending", () => {
    const d = emptyDraft("sms", mk);
    expect(draftProblem(d, sms, NOW)).toBe("Write a message first.");
    expect(draftProblem({ ...d, text: "x".repeat(1601) }, sms, NOW)).toContain("1,600");
    expect(draftProblem({ ...d, text: "ok" }, sms, NOW)).toBeNull();
    const email = channelOptions(MAYA, "sms", [], NOW).find((o) => o.channel === "email");
    expect(draftProblem({ ...d, channel: "email", text: "ok" }, email, NOW)).toBe("An email needs a subject.");
  });

  it("a send cannot be built without the confirm grant", () => {
    const d: ComposerDraft = { ...emptyDraft("sms", mk), text: "Hi" };
    expect(() => sendRequest(d, "lead-maya", undefined as unknown as ConfirmGrant, NOW)).toThrow();
    expect(() => sendRequest(d, "lead-maya", {} as ConfirmGrant, NOW)).toThrow();
  });

  it("a confirmed send carries confirm, the draft key and send_at when scheduled", () => {
    const d: ComposerDraft = { ...emptyDraft("sms", mk), text: " Hi ", sendAt: "2026-11-20T09:00" };
    const r = sendRequest(d, "lead-maya", grant, NOW);
    expect(r.op).toBe(INBOX_OP.send);
    expect(r.args.confirm).toBe(true);
    expect(r.args.idem).toBe(d.idem);
    expect(r.args.body).toMatchObject({ lead_id: "lead-maya", channel: "sms", body: "Hi" });
    expect(typeof r.args.body.send_at).toBe("string");
  });

  it("an edited AI suggestion goes out by approving it", () => {
    const d: ComposerDraft = { ...emptyDraft("sms", mk), text: "Edited", suggestionId: "sg1" };
    const r = sendRequest(d, "lead-maya", grant, NOW);
    expect(r.op).toBe(INBOX_OP.approveSuggestion);
    expect(r.args.path).toEqual({ suggestion_id: "sg1" });
    expect(r.args.body).toEqual({ body: "Edited" });
  });
});

describe("contact slots", () => {
  it("the newest write answer wins", () => {
    expect(contactSlots({ daily_unique_contact_cap: 50, unique_contacts_remaining: 40 }, null)).toEqual({ remaining: 40, cap: 50 });
    expect(contactSlots({ daily_unique_contact_cap: 50, unique_contacts_remaining: 40 }, { contactsRemaining: 39, contactsLimit: 50 })).toEqual({ remaining: 39, cap: 50 });
    expect(contactSlots(null, null)).toBeNull();
  });
});
