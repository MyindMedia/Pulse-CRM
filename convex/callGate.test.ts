import { describe, it, expect } from "vitest";
import { CALL_SCRIPT_APPROVED, buildFirstSentence, buildTask } from "./outreach/callScript";
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
});
