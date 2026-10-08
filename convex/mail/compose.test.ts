import { describe, it, expect } from "vitest";
import { buildOutboundPayload } from "./compose";
import { signatureHtml, SIGNATURE_CONTENT_ID } from "../outreach/signatures";
import { BRANDED_META } from "../lib/emailLayout";

const support = { address: "support@studiopulse.tech", fromName: "Pulse Support", kind: "shared" as const };
const lawrence = { address: "lawrenceb@studiopulse.tech", fromName: "Lawrence Berment", kind: "personal" as const, signature: "lawrence" as const };

describe("buildOutboundPayload", () => {
  it("replies carry In-Reply-To and References, latest last", () => {
    const { payload } = buildOutboundPayload({
      mailbox: support, to: ["jane@x.com"], subject: "Re: Booking", body: "Hi",
      inReplyTo: "<c@x>", references: ["<a@x>", "<b@x>", "<c@x>"],
    });
    expect(payload.headers).toEqual({ "In-Reply-To": "<c@x>", References: "<a@x> <b@x> <c@x>" });
    expect(payload.from).toBe("Pulse Support <support@studiopulse.tech>");
    expect(payload.to).toEqual(["jane@x.com"]);
  });

  it("a first reply with no References uses In-Reply-To as References", () => {
    const { payload } = buildOutboundPayload({ mailbox: support, to: ["a@x.com"], subject: "Re: x", body: "y", inReplyTo: "<m@x>" });
    expect(payload.headers?.References).toBe("<m@x>");
  });

  it("a new message has no threading headers and no cc when empty", () => {
    const { payload } = buildOutboundPayload({ mailbox: support, to: ["a@x.com"], cc: [], subject: "Hello", body: "Hi" });
    expect(payload.headers).toBeUndefined();
    expect("cc" in payload).toBe(false);
  });

  it("shared mail wears the Pulse layout and strips em dashes", () => {
    const { payload } = buildOutboundPayload({ mailbox: support, to: ["a@x.com"], subject: "Your booking — confirmed", body: "Thanks — see you <soon>" });
    expect(payload.html).toContain(BRANDED_META);
    expect(payload.subject).toBe("Your booking - confirmed");
    for (const s of [payload.subject, payload.html, payload.text]) expect(s).not.toMatch(/[—–]/);
    expect(payload.html).toContain("&lt;soon&gt;");
  });

  it("personal mail is plain, carries Lawrence's outreach signature unchanged plus the Pulse footer", () => {
    const { payload } = buildOutboundPayload({ mailbox: lawrence, to: ["a@x.com"], subject: "Quick note", body: "Hey,\n\nTalk soon." });
    expect(payload.from).toBe("Lawrence Berment <lawrenceb@studiopulse.tech>");
    expect(payload.html).not.toContain(BRANDED_META);
    expect(payload.html).toContain(signatureHtml("lawrence", "image"));
    expect(payload.html).toContain("Pulse, the studio operating system");
    expect(payload.attachments?.map((a) => a.content_id)).toEqual([SIGNATURE_CONTENT_ID.lawrence]);
    expect(payload.text).toContain("Talk soon.");
  });

  it("quotes a display name with specials", () => {
    const { payload } = buildOutboundPayload({ mailbox: { ...support, fromName: "Pulse, Support" }, to: ["a@x.com"], subject: "s", body: "b" });
    expect(payload.from).toBe('"Pulse, Support" <support@studiopulse.tech>');
  });
});
