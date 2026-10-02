import { describe, it, expect } from "vitest";
import { renderEmail, PERSONAS, TEMPLATES, contentHash } from "./templates";
import { ORIGINAL_ROVERTO, ORIGINAL_LAWRENCE, STATIC_ROVERTO, signatureHtml, inlineImagesFor, withDataUris } from "./signatures";

const base = { template: "maxb_system" as const, studio: "MIX Recording Studio", postalAddress: "1 Main St, Los Angeles, CA 90001" };

describe("renderEmail", () => {
  it("keeps the approved MaxB copy and subject exactly", () => {
    const r = renderEmail(base);
    expect(r.subject).toBe("Your studio has a sound. Now give it a system.");
    expect(r.text).toContain("Hey MIX Recording Studio team,");
    expect(r.text).toContain("Your best work happens in the studio. Running the studio shouldn’t take you away from it.");
    expect(r.text).toContain("Open to 15 minutes with Lawrence?");
    // Lawrence's edit: Grammy-nominated producer only, no credits or artist names
    expect(r.text).toContain("I’m MaxB, reaching out for Lawrence “ThaMyind” Berment, a Grammy-nominated producer. He built Pulse for the business behind the music.");
    expect(r.text + r.html).not.toMatch(/Kanye|Pusha|songwriter|credits/i);
    expect(r.html).toContain("See Pulse in action");
    expect(r.html).toContain("The studio operating system");
    expect(r.html).toContain("max-width:620px");
    expect(r.html).toContain('bgcolor="#0d0d0f"'); // table backgrounds survive Gmail on phones
    expect(r.html).toContain('name="color-scheme" content="dark"');
  });

  it("defaults to the exact picture of the Final signature, because Gmail breaks the HTML", () => {
    const r = renderEmail(base);
    expect(r.html).toContain("cid:pulse-signature-roverto");
    expect(r.html).not.toContain(ORIGINAL_ROVERTO);
    expect(r.html).not.toContain("<style>.pw"); // none of the signature's CSS
  });

  it("can embed the Final Roverto HTML verbatim when asked", () => {
    const r = renderEmail({ ...base, signatureMode: "original" });
    expect(r.html).toContain(ORIGINAL_ROVERTO);
    expect(r.html).not.toContain(ORIGINAL_LAWRENCE);
  });

  it("can switch to the email-safe static signature", () => {
    const r = renderEmail({ ...base, signatureMode: "static" });
    expect(r.html).toContain(STATIC_ROVERTO);
    expect(r.html).not.toContain(ORIGINAL_ROVERTO);
  });

  it("maps each persona to its own sender and signature", () => {
    expect(PERSONAS.maxb).toMatchObject({ fromEmail: "info@studiopulse.tech", signature: "roverto" });
    expect(PERSONAS.lawrence).toMatchObject({ fromEmail: "lawrenceb@studiopulse.tech", signature: "lawrence" });
    expect(signatureHtml("lawrence", "original")).toBe(ORIGINAL_LAWRENCE);
    expect(PERSONAS.lawrence.templates).toEqual([]); // no approved Lawrence copy yet
    expect(TEMPLATES.maxb_system.persona).toBe("maxb");
  });

  it("without an address the footer says so and approval is blocked", () => {
    const r = renderEmail({ ...base, postalAddress: undefined });
    expect(r.blockers).toContain("postal_address_missing");
    expect(r.html).toContain("[Business mailing address required before sending]");
    expect(renderEmail(base).blockers).not.toContain("postal_address_missing");
  });

  it("uses the verified booking link, or falls back to a reply and flags it", () => {
    const withLink = renderEmail({ ...base, bookingUrl: "https://api.leadconnectorhq.com/widget/bookings/pulse-walkthrough" });
    expect(withLink.links).toContain("https://api.leadconnectorhq.com/widget/bookings/pulse-walkthrough");
    expect(withLink.blockers).not.toContain("booking_link_not_verified");
    const without = renderEmail(base);
    expect(without.blockers).toContain("booking_link_not_verified");
    expect(without.links.some((l) => l.startsWith("mailto:info@studiopulse.tech?subject="))).toBe(true);
    expect(() => renderEmail({ ...base, bookingUrl: "http://insecure.example" })).toThrow(/https/);
  });

  it("always includes an opt-out line and escapes the studio name", () => {
    const r = renderEmail({ ...base, studio: `A <b>&"Studio"` });
    expect(r.html).toContain("Reply <strong>unsubscribe</strong>");
    expect(r.text).toContain("Reply 'unsubscribe'");
    expect(r.html).not.toContain("<b>&");
  });

  it("refuses em dashes in anything a recipient reads", () => {
    expect(() => renderEmail({ ...base, observation: "Four rooms — two locations." })).toThrow(/Em dash/);
    expect(() => renderEmail({ ...base, studio: "A — B" })).toThrow(/Em dash/);
    expect(renderEmail({ ...base, observation: "Four rooms across two locations." }).text).toContain("Four rooms across two locations.");
  });

  it("the hash changes when anything that is sent changes", async () => {
    const a = renderEmail(base), b = renderEmail({ ...base, signatureMode: "static" });
    expect(await contentHash([a.html])).not.toBe(await contentHash([b.html]));
    expect(await contentHash([a.html])).toBe(await contentHash([a.html]));
  });

  it("image mode references an inline picture, never the original HTML, and can be previewed", () => {
    const r = renderEmail({ ...base, signatureMode: "image" });
    expect(r.html).toContain("cid:pulse-signature-roverto");
    expect(r.html).not.toContain(ORIGINAL_ROVERTO);
    expect(r.html).toContain("mailto:info@studiopulse.tech");
    const imgs = inlineImagesFor(r.html);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toMatchObject({ contentId: "pulse-signature-roverto", contentType: "image/jpeg" });
    expect(Buffer.from(imgs[0].base64, "base64").subarray(0, 2).toString("hex")).toBe("ffd8"); // a real JPEG
    expect(withDataUris(r.html)).toContain("data:image/jpeg;base64,");
    expect(withDataUris(r.html)).not.toContain("cid:");
    expect(inlineImagesFor(renderEmail({ ...base, signatureMode: "original" }).html)).toEqual([]); // original mode needs no attachment
  });

  it("the signature is left-aligned inside the centred layout so it matches the source file", () => {
    expect(renderEmail({ ...base, signatureMode: "original" }).html).toContain('text-align:left">' + ORIGINAL_ROVERTO.slice(0, 40));
  });

  it("the page background and card use bgcolor attributes, not only CSS, for phone mail apps", () => {
    const r = renderEmail(base);
    expect(r.html).toContain('bgcolor="#0a0a0b"');
    expect(r.html).toContain('bgcolor="#fdb913"');
    expect(r.html).toContain("max-width:480px"); // mobile padding rule
  });

  it("animated mode points at the hosted GIF, needs no attachment, and keeps the links row", () => {
    const r = renderEmail({ ...base, signatureMode: "animated" });
    expect(r.html).toContain("https://studiopulse.tech/email/signature-roverto.gif");
    expect(r.html).not.toContain("cid:");
    expect(r.html).toContain("mailto:info@studiopulse.tech");
    expect(inlineImagesFor(r.html)).toEqual([]);
  });
});
