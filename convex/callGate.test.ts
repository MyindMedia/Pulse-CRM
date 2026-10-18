import { describe, it, expect } from "vitest";
import { CALL_SCRIPT_APPROVED, buildAgentOpener, buildCallReport, buildFirstSentence, extractAnswers, buildTask } from "./outreach/callScript";
import { liveBlockers } from "./outreachCalls";

describe("script approval gate", () => {
  it("is approved by the owner (2026-10-07), so a fully configured env has no live blockers", () => {
    expect(CALL_SCRIPT_APPROVED).toBe(true);
    expect(liveBlockers({ BLAND_API_KEY: "k", BLAND_WEBHOOK_SECRET: "s", CONVEX_SITE_URL: "https://x" })).toEqual([]);
  });
  it("lists a missing key and webhook too", () => {
    expect(liveBlockers({})).toEqual(["bland_key_missing", "webhook_not_configured"]);
  });
  it("the first sentence discloses an AI calling for Pulse; copy has no em dashes", () => {
    const first = buildFirstSentence({ firstName: "Mike Sims", demoTime: "Tuesday, October 13 at 2:00 PM PDT" });
    expect(first).toMatch(/AI assistant calling for Pulse/);
    expect(first).toContain("Hi Mike,");
    expect(first).not.toContain("Sims");
    const task = buildTask({ firstName: "Mike", demoTime: "Tuesday, October 13 at 2:00 PM PDT" });
    expect(task).toContain("Tuesday, October 13 at 2:00 PM PDT");
    expect(task).toContain("do not call");
    expect(first + buildTask({ demoTime: "x" }).slice(task.indexOf("## Objective"))).not.toMatch(/—/);
  });
  it("the MaxB opener discloses the AI first and uses only the first name", () => {
    const o = buildAgentOpener({ firstName: "Mike Sims", demoTime: "x" });
    expect(o.startsWith("Hey Mike, this is MaxB, Pulse's AI assistant.")).toBe(true);
    expect(o).not.toContain("Sims");
    expect(buildAgentOpener({ demoTime: "x" }).startsWith("Hey there,")).toBe(true);
    expect(o).not.toMatch(/—/);
  });
  it("pulls the customer's answers under MaxB's questions, dropping system lines", () => {
    const t = [
      { user: "user", text: "Hello?" },
      { user: "assistant", text: "Hey Mike, this is MaxB. Got a couple minutes?" },
      { user: "user", text: "Gary." },
      { user: "assistant", text: "Alright. How did you hear about Pulse? Was it through Lawrence, or somewhere else?" },
      { user: "agent-action", text: "[Waiting]" },
      { user: "user", text: "Through Lawrence." },
      { user: "user", text: "He showed me." },
      { user: "assistant", text: "yes <backchannel>" },
      { user: "assistant", text: "Got you. The main thing is bookings." },
      { user: "user", text: "Okay." },
    ];
    expect(extractAnswers(t)).toEqual([
      { q: "Got a couple minutes?", a: "Gary." },
      { q: "How did you hear about Pulse? Was it through Lawrence, or somewhere else?", a: "Through Lawrence. He showed me." },
      { q: "The main thing is bookings.", a: "Okay." },
    ]);
    expect(extractAnswers("nope")).toEqual([]);
  });
  it("the owner report leads with who and when, lists the answers, and splits long calls", () => {
    const [one] = buildCallReport({ name: "Mike Sims", demoTime: "Monday, October 26 at 3:00 PM PDT", minutes: 3.16,
      answers: [{ q: "How did you hear about Pulse?", a: "Lawrence." }], brief: "Two rooms.\nWants invoicing \u2014 fast." });
    expect(one).toBe("Pulse demo call: Mike Sims\nDemo: Monday, October 26 at 3:00 PM PDT\nMaxB call, 3 min.\n\nWhat they said:\n\nQ: How did you hear about Pulse?\nA: Lawrence.\n\nBrief: Two rooms. Wants invoicing fast.");
    expect(buildCallReport({ demoTime: "x", answeredBy: "voicemail" })[0]).toContain("MaxB reached voicemail");
    const many = buildCallReport({ demoTime: "x", answers: Array.from({ length: 30 }, (_, i) => ({ q: `Question ${i}?`, a: "y".repeat(120) })) });
    expect(many.length).toBeGreaterThan(1);
    expect(many[0].startsWith(`(1/${many.length}) Pulse demo call`)).toBe(true);
    expect(many.every((m) => m.length <= 1410)).toBe(true);
  });
});
