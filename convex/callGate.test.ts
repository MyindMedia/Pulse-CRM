import { describe, it, expect } from "vitest";
import { CALL_SCRIPT_APPROVED, buildFirstSentence, buildTask } from "./outreach/callScript";
import { liveBlockers } from "./outreachCalls";

describe("script approval gate", () => {
  it("ships unapproved, so live calling is blocked until the owner flips it", () => {
    expect(CALL_SCRIPT_APPROVED).toBe(false);
    expect(liveBlockers({ BLAND_API_KEY: "k", BLAND_WEBHOOK_SECRET: "s", CONVEX_SITE_URL: "https://x" })).toEqual(["script_unapproved"]);
  });
  it("lists a missing key and webhook too", () => {
    expect(liveBlockers({})).toEqual(["script_unapproved", "bland_key_missing", "webhook_not_configured"]);
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
