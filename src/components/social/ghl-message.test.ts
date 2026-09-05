import { describe, it, expect } from "vitest";
import { describeUnusableGhlClose, isOwnGhlCloseMessage, isGhlOrigin } from "./ghl-message";

/* ConnectButton trusts this predicate to tell its own popup's "done" signal
   apart from every other network's, from anything else that might post a
   message into the window, and above all from anyone who is not GHL. These
   are the cases that matter. */

const GHL = "https://app.gohighlevel.com";
const wellFormed = { actionType: "close", page: "social-media-posting", accountId: "acc_1", platform: "instagram" };

describe("isGhlOrigin", () => {
  it("accepts GHL's own apexes and their subdomains", () => {
    for (const origin of [
      "https://gohighlevel.com",
      "https://app.gohighlevel.com",
      "https://marketplace.gohighlevel.com",
      "https://leadconnectorhq.com",
      "https://services.leadconnectorhq.com",
      "https://link.msgsndr.com",
    ]) {
      expect(isGhlOrigin(origin)).toBe(true);
    }
  });

  it("rejects a lookalike domain that merely ends in the same letters", () => {
    // The suffix trick: a bare endsWith("gohighlevel.com") would pass all of
    // these. The dot is what makes it a subdomain rather than a prefix.
    expect(isGhlOrigin("https://evil-gohighlevel.com")).toBe(false);
    expect(isGhlOrigin("https://notgohighlevel.com")).toBe(false);
    expect(isGhlOrigin("https://xleadconnectorhq.com")).toBe(false);
  });

  it("rejects a domain that only carries the GHL name as a prefix", () => {
    expect(isGhlOrigin("https://gohighlevel.com.evil.tld")).toBe(false);
    expect(isGhlOrigin("https://leadconnectorhq.com.attacker.io")).toBe(false);
  });

  it("rejects an unrelated origin", () => {
    expect(isGhlOrigin("https://evil.example.com")).toBe(false);
  });

  it("rejects plain http, even on a real GHL host", () => {
    expect(isGhlOrigin("http://app.gohighlevel.com")).toBe(false);
  });

  it("rejects an origin it cannot parse", () => {
    // "null" is what a sandboxed frame reports as its origin.
    expect(isGhlOrigin("null")).toBe(false);
    expect(isGhlOrigin("")).toBe(false);
    expect(isGhlOrigin("app.gohighlevel.com")).toBe(false);
  });
});

describe("isOwnGhlCloseMessage", () => {
  it("accepts a well-formed close message for the matching platform", () => {
    expect(isOwnGhlCloseMessage(GHL, wellFormed, "instagram")).toBe(true);
  });

  it("rejects a perfectly-shaped message from the wrong origin", () => {
    // The whole attack: the popup Pulse opened holds window.opener, so it can
    // post a message that passes every shape check with an accountId the
    // attacker controls. Only the origin separates it from the real thing.
    expect(isOwnGhlCloseMessage("https://evil.example.com", wellFormed, "instagram")).toBe(false);
    expect(isOwnGhlCloseMessage("https://evil-gohighlevel.com", wellFormed, "instagram")).toBe(false);
    expect(isOwnGhlCloseMessage("https://gohighlevel.com.evil.tld", wellFormed, "instagram")).toBe(false);
  });

  it("rejects a wrong actionType", () => {
    expect(isOwnGhlCloseMessage(GHL, { ...wellFormed, actionType: "open" }, "instagram")).toBe(false);
  });

  /* GHL documents this field twice and disagrees with itself: the field table
     says `page` is "social-media-posting", and the working code sample every
     integrator copies compares `e.data.page === 'social_media_posting'`. Only
     the underscored form appears in code that is known to run, so both are
     accepted - and getting this wrong has no error to read, because a rejected
     message leaves the popup open on a blank page and sets nothing. */
  it("accepts the underscored page GHL's own code sample compares against", () => {
    expect(
      isOwnGhlCloseMessage(GHL, { ...wellFormed, page: "social_media_posting" }, "instagram"),
    ).toBe(true);
  });

  it("still accepts the hyphenated page GHL's field table documents", () => {
    expect(
      isOwnGhlCloseMessage(GHL, { ...wellFormed, page: "social-media-posting" }, "instagram"),
    ).toBe(true);
  });

  it("rejects a wrong page", () => {
    expect(isOwnGhlCloseMessage(GHL, { ...wellFormed, page: "something-else" }, "instagram")).toBe(false);
    // Not a loose match on either spelling.
    expect(isOwnGhlCloseMessage(GHL, { ...wellFormed, page: "social media posting" }, "instagram")).toBe(false);
  });

  it("rejects a message with no accountId", () => {
    const withoutAccountId = { actionType: "close", page: "social-media-posting", platform: "instagram" };
    expect(isOwnGhlCloseMessage(GHL, withoutAccountId, "instagram")).toBe(false);
  });

  it("rejects a message whose platform mismatches the button's own", () => {
    expect(isOwnGhlCloseMessage(GHL, { ...wellFormed, platform: "facebook" }, "instagram")).toBe(false);
  });

  it("accepts a message that omits platform - documents current behavior, not a claim GHL always sends one", () => {
    const withoutPlatform = { actionType: "close", page: "social-media-posting", accountId: "acc_1" };
    expect(isOwnGhlCloseMessage(GHL, withoutPlatform, "instagram")).toBe(true);
  });

  it("rejects non-object data", () => {
    expect(isOwnGhlCloseMessage(GHL, null, "instagram")).toBe(false);
    expect(isOwnGhlCloseMessage(GHL, undefined, "instagram")).toBe(false);
    expect(isOwnGhlCloseMessage(GHL, "not an object", "instagram")).toBe(false);
  });
});

/* The guard that stops the next contract change being another blank popup.
   It must speak up for a GHL close message it cannot use, and stay silent for
   everything else on a page that has ten of these listeners running at once. */
describe("describeUnusableGhlClose", () => {
  it("names an unrecognised page value rather than dropping the message", () => {
    const reason = describeUnusableGhlClose(
      GHL, { ...wellFormed, page: "social_posting_v2" }, "instagram",
    );
    expect(reason).toContain("social_posting_v2");
  });

  it("reports a close message that carries no account id", () => {
    const reason = describeUnusableGhlClose(
      GHL, { actionType: "close", page: "social_media_posting", platform: "instagram" }, "instagram",
    );
    expect(reason).toContain("account id");
  });

  it("says nothing about a message it can use", () => {
    expect(describeUnusableGhlClose(GHL, wellFormed, "instagram")).toBeNull();
  });

  it("stays silent for the other nine buttons' popups", () => {
    // Every ConnectButton on the page hears this event. Only the Facebook one
    // may speak for a Facebook message.
    expect(
      describeUnusableGhlClose(GHL, { ...wellFormed, platform: "facebook", page: "x" }, "instagram"),
    ).toBeNull();
  });

  it("stays silent for anything that is not a GHL close signal", () => {
    expect(describeUnusableGhlClose("https://evil.example.com", wellFormed, "instagram")).toBeNull();
    expect(describeUnusableGhlClose(GHL, { ...wellFormed, actionType: "open" }, "instagram")).toBeNull();
    expect(describeUnusableGhlClose(GHL, "not an object", "instagram")).toBeNull();
    expect(describeUnusableGhlClose(GHL, null, "instagram")).toBeNull();
  });
});
