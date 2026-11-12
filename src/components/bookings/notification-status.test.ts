import { describe, it, expect } from "vitest";
import { notificationNotSentNote } from "./types";

/* A text blocked by STOP is logged with status "skipped" (convex/lib/notify.ts).
   The message logs must never present that row as sent. */
describe("notificationNotSentNote", () => {
  it("says a skipped text was not sent and why", () => {
    expect(notificationNotSentNote({ status: "skipped" })).toBe("Not sent: this number replied STOP");
  });

  it("adds nothing for messages handed to the provider", () => {
    for (const status of ["sent", "simulated", "failed"]) {
      expect(notificationNotSentNote({ status })).toBeNull();
    }
  });
});
