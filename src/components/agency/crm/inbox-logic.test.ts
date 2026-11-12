import { describe, expect, it } from "vitest";
import {
  applyDraftChange, channelOptions, classifyEvent, contactSlots, conversationsQuery, defaultChannel, draftProblem, emptyDraft,
  filterCount, htmlToText, mergeConversations, previewText, safeUrl, searchTerm, sendRequest, socialWindowEnds, threadItems,
  validateSchedule, parsePolished, parseReplyIdeas, replyIdeasBody, writeFingerprint, SCHEDULE_PASSED, ScheduleExpiredError, TEXT_OPT_OUT_NOTE, type ComposerDraft,
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

  it("F-U2: only real Zuops fields turn channels off; guessed opt-out fields are ignored", () => {
    const guessed = { ...MAYA, sms_opt_out: true, do_not_contact: true, dnc: true, opted_out: true, sms_opted_out: true } as typeof MAYA;
    // Pulse cannot see text opt-outs; Zuops refuses those sends itself.
    expect(channelOptions(guessed, "sms", [], NOW).find((o) => o.channel === "sms")?.available).toBe(true);
    expect(TEXT_OPT_OUT_NOTE).toBe("Pulse cannot see text opt-outs. Zuops blocks a text to anyone who replied STOP or is marked do not contact.");
    const sms = (l: typeof MAYA) => channelOptions(l, "sms", [], NOW).find((o) => o.channel === "sms");
    const email = (l: typeof MAYA) => channelOptions(l, "sms", [], NOW).find((o) => o.channel === "email");
    expect(sms({ ...MAYA, phone_invalid: true })).toMatchObject({ available: false, reason: "Zuops marked this phone number invalid." });
    expect(sms({ ...MAYA, phone: null })).toMatchObject({ available: false, reason: "No phone number on this lead." });
    expect(email({ ...MAYA, email_opt_out: true })).toMatchObject({ available: false, reason: "This lead opted out of email." });
    expect(email({ ...MAYA, email_invalid: true } as typeof MAYA)).toMatchObject({ available: false, reason: "Zuops marked this email address invalid." });
    expect(email({ ...MAYA, email_paused: true } as typeof MAYA)).toMatchObject({ available: false, reason: "Email to this lead is paused in Zuops." });
  });

  it("missing addresses turn channels off with a reason", () => {
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

  it("F-U1: a scheduled draft whose time passed is refused, never sent now (moving clock)", () => {
    const at = NOW + 10 * 60_000; // ten minutes ahead when written
    const local = (() => { const d = new Date(at); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; })();
    const d: ComposerDraft = { ...emptyDraft("sms", mk), text: "Reminder", sendAt: local };
    expect(sendRequest(d, "lead-maya", grant, NOW).args.body.send_at).toBeTypeOf("string");
    // The dialog sat open; the clock moved past the time.
    for (const later of [NOW + 9.5 * 60_000, NOW + 11 * 60_000, NOW + 86_400_000]) {
      expect(() => sendRequest(d, "lead-maya", grant, later)).toThrow(ScheduleExpiredError);
      try { sendRequest(d, "lead-maya", grant, later); } catch (e) { expect((e as Error).message).toBe(SCHEDULE_PASSED); }
    }
    expect(SCHEDULE_PASSED).toBe("That time has passed. Pick a new time.");
  });

  it("F-U1: an AI suggestion with a time is refused rather than sent now", () => {
    const d: ComposerDraft = { ...emptyDraft("sms", mk), text: "Edited", suggestionId: "sg1", sendAt: "2026-11-20T09:00" };
    expect(() => sendRequest(d, "lead-maya", grant, NOW)).toThrow(ScheduleExpiredError);
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

describe("F-U14: the reply window closes as the clock moves", () => {
  it("open now, closed a day later, with the same thread", () => {
    const items = threadItems([{ id: "m1", event_type: "messenger_inbound", body: "hi", created_at: "2026-11-11T17:00:00Z" } as ThreadEvent]);
    const at = (t: number) => channelOptions(DEV, "messenger", items, t).find((o) => o.channel === "messenger")?.available;
    expect(at(NOW)).toBe(true);
    expect(at(Date.parse("2026-11-12T17:00:01Z"))).toBe(false);
  });
});

describe("R3-I6: keys come from the exact body", () => {
  it("same op, path, body and round give the same fingerprint, key order ignored", () => {
    const a = writeFingerprint("update_scheduled_message", { scheduled_message_id: "s1" }, { body: "Hi", scheduled_at: "2027-01-01T10:00:00.000Z" }, 0);
    const b = writeFingerprint("update_scheduled_message", { scheduled_message_id: "s1" }, { scheduled_at: "2027-01-01T10:00:00.000Z", body: "Hi" }, 0);
    expect(a).toBe(b);
  });
  it("any change to the body, path, op or round gives a new one", () => {
    const base = writeFingerprint("update_booking", { booking_id: "b1" }, { status: "completed" }, 0);
    expect(writeFingerprint("update_booking", { booking_id: "b1" }, { status: "no_show" }, 0)).not.toBe(base);
    expect(writeFingerprint("update_booking", { booking_id: "b2" }, { status: "completed" }, 0)).not.toBe(base);
    expect(writeFingerprint("update_booking", { booking_id: "b1" }, { status: "completed" }, 1)).not.toBe(base);
    expect(writeFingerprint("cancel_booking", { booking_id: "b1" }, { status: "completed" }, 0)).not.toBe(base);
  });
});

describe("R3-I2: reply ideas and polish", () => {
  it("new ideas send only the channel; polish sends the draft and how", () => {
    expect(replyIdeasBody("sms")).toEqual({ channel: "sms" });
    expect(replyIdeasBody("sms", "   ")).toEqual({ channel: "sms" });
    expect(replyIdeasBody("email", " hi there ", "shorter")).toEqual({ channel: "email", draft: "hi there", how: "shorter" });
    expect(replyIdeasBody("sms", "x".repeat(5000)).draft).toHaveLength(4000);
  });
  it("three ideas come back usable; empty ones are dropped", () => {
    const ideas = parseReplyIdeas({ kind: "reply", replies: [{ text: "Thursday works." }, { label: "Warm", text: "Happy to help!" }, { text: "" }, { text: "Can I call you?" }, { text: "A fourth" }] });
    expect(ideas.map((i) => i.text)).toEqual(["Thursday works.", "Happy to help!", "Can I call you?"]);
    expect(parseReplyIdeas(undefined)).toEqual([]);
  });
  it("the polished text is read from text", () => {
    expect(parsePolished({ text: "Thursday at 2 works great." })).toBe("Thursday at 2 works great.");
    expect(parsePolished({ text: " " })).toBeNull();
    expect(parsePolished({})).toBeNull();
  });
});
