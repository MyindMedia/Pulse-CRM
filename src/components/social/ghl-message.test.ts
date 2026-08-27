import { describe, it, expect } from "vitest";
import { isOwnGhlCloseMessage } from "./ghl-message";

/* ConnectButton trusts this predicate to tell its own popup's "done" signal
   apart from every other network's, and from anything else that might post
   a message into the window. These are the cases that matter. */

const wellFormed = { actionType: "close", page: "social-media-posting", accountId: "acc_1", platform: "instagram" };

describe("isOwnGhlCloseMessage", () => {
  it("accepts a well-formed close message for the matching platform", () => {
    expect(isOwnGhlCloseMessage(wellFormed, "instagram")).toBe(true);
  });

  it("rejects a wrong actionType", () => {
    expect(isOwnGhlCloseMessage({ ...wellFormed, actionType: "open" }, "instagram")).toBe(false);
  });

  it("rejects a wrong page", () => {
    expect(isOwnGhlCloseMessage({ ...wellFormed, page: "something-else" }, "instagram")).toBe(false);
  });

  it("rejects a message with no accountId", () => {
    const withoutAccountId = { actionType: "close", page: "social-media-posting", platform: "instagram" };
    expect(isOwnGhlCloseMessage(withoutAccountId, "instagram")).toBe(false);
  });

  it("rejects a message whose platform mismatches the button's own", () => {
    expect(isOwnGhlCloseMessage({ ...wellFormed, platform: "facebook" }, "instagram")).toBe(false);
  });

  it("accepts a message that omits platform - documents current behavior, not a claim GHL always sends one", () => {
    const withoutPlatform = { actionType: "close", page: "social-media-posting", accountId: "acc_1" };
    expect(isOwnGhlCloseMessage(withoutPlatform, "instagram")).toBe(true);
  });

  it("rejects non-object data", () => {
    expect(isOwnGhlCloseMessage(null, "instagram")).toBe(false);
    expect(isOwnGhlCloseMessage(undefined, "instagram")).toBe(false);
    expect(isOwnGhlCloseMessage("not an object", "instagram")).toBe(false);
  });
});
