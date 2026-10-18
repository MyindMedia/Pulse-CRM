import { describe, it, expect } from "vitest";
import { CALL_SCRIPT_APPROVED, buildAgentOpener, buildBriefSms, buildFirstSentence, buildTask } from "./outreach/callScript";
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
  it("the owner brief text names the contact and demo, and says why a brief is missing", () => {
    const t = buildBriefSms({ name: "Mike Sims", demoTime: "Monday, October 26 at 3:00 PM PDT", brief: "Two rooms.\nWants invoicing \u2014 fast.", minutes: 3.16 });
    expect(t.startsWith("Pulse demo brief: Mike Sims\nDemo: Monday, October 26 at 3:00 PM PDT\n\nTwo rooms. Wants invoicing fast.")).toBe(true);
    expect(t).toContain("MaxB call, 3 min.");
    expect(t).not.toMatch(/\u2014/);
    expect(buildBriefSms({ demoTime: "x", answeredBy: "voicemail" })).toContain("MaxB reached voicemail");
    expect(buildBriefSms({ demoTime: "x" })).toContain("Unknown contact");
  });
});
