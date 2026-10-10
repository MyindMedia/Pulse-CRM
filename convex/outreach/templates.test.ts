import { describe, it, expect } from "vitest";
import { renderEmail, PERSONAS, TEMPLATES, SEQUENCE_TEMPLATES, FOLLOWUP_DAYS, THREAD_REPLY_TO, contentHash, templateForStep, type TemplateKey } from "./templates";
import {
  ORIGINAL_ROVERTO, ORIGINAL_LAWRENCE, STATIC_ROVERTO, STATIC_LAWRENCE, signatureHtml, signatureImageHtml, inlineImagesFor, withDataUris,
  type SignatureKey, type SignatureMode,
} from "./signatures";

const HOOK = "Saw that MIX just opened a second live room and books engineers by the hour.";
const ADDRESS = "1 Main St, Los Angeles, CA 90001";
const base = { template: "lawrence_first" as const, studio: "MIX Recording Studio", observation: HOOK, postalAddress: ADDRESS, bookingUrl: "https://studiopulse.tech/demo" };
const reply = (template: TemplateKey) => ({ template, studio: "MIX Recording Studio", threadSubject: "A question about running MIX Recording Studio", postalAddress: ADDRESS, bookingUrl: "https://studiopulse.tech/demo" });
const ALL_TEMPLATES = Object.keys(TEMPLATES) as TemplateKey[];
const MODES: SignatureMode[] = ["image", "animated", "original", "static"];
const BANNED = /grammy|award|nominated/i;

describe("Lawrence's first email", () => {
  it("opens with the hook, then Lawrence, Pulse OS, the Pulse app, the founding offer and the demo", () => {
    const r = renderEmail(base);
    expect(r.persona).toBe("lawrence");
    expect(r.subject).toBe("A question about running MIX Recording Studio");
    const body = r.text.split("\n\n");
    expect(body[0]).toBe("Hi MIX Recording Studio team,");
    expect(body[1]).toBe(HOOK); // the opening line comes first
    expect(r.text).toContain("I’m Lawrence, a producer who’s run studios.");
    expect(r.text).toMatch(/booking app, a spreadsheet and deposit texts/);
    expect(r.text).toContain("Pulse OS, the studio operating system: bookings, deposits, staff scheduling, gear, invoicing and reporting in one place.");
    expect(r.text).toContain("the Pulse app: checklists, clock in/out, session notes.");
    expect(r.text).toContain("50% off the first 3 months");
    expect(r.text).toContain("15-minute demo? Pick a time at studiopulse.tech/demo.");
    expect(r.text).toContain("Lawrence Berment\nFounder, Pulse OS");
    expect(r.html).toContain('href="https://studiopulse.tech/demo"');
    expect(r.html).toContain("Book a 15-minute demo");
    expect(r.html).toContain("Lawrence Berment<br>Founder, Pulse OS");
    expect(r.html).toContain("cid:pulse-signature-lawrence");
  });

  it("is 70 to 110 words with a typical opening line, and never says CRM", () => {
    const r = renderEmail(base);
    expect(r.words).toBeGreaterThanOrEqual(70);
    expect(r.words).toBeLessThanOrEqual(110);
    expect(r.text + r.html).not.toMatch(/\bCRM\b/i);
  });

  it("refuses to render without an opening line", () => {
    expect(() => renderEmail({ ...base, observation: undefined })).toThrow(/opening line/);
    expect(() => renderEmail({ ...base, observation: "   " })).toThrow(/opening line/);
  });

  it("a subject and body override replace only the subject and the middle paragraphs", () => {
    const r = renderEmail({ ...base, subjectOverride: "Four rooms, one calendar", bodyOverride: "First custom paragraph.\n\nSecond <b>custom</b> paragraph." });
    expect(r.subject).toBe("Four rooms, one calendar");
    const body = r.text.split("\n\n");
    expect(body.slice(0, 4)).toEqual(["Hi MIX Recording Studio team,", HOOK, "First custom paragraph.", "Second <b>custom</b> paragraph."]);
    expect(r.text).not.toContain("I’m Lawrence, a producer");
    // Greeting, offer, CTA, footer and opt-out cannot be replaced.
    expect(r.text).toContain("50% off the first 3 months");
    expect(r.text).toContain("Pick a time at studiopulse.tech/demo.");
    expect(r.html).toContain("Reply <strong>unsubscribe</strong>");
    expect(r.html).toContain(ADDRESS);
    // Escaped as plain text.
    expect(r.html).toContain("Second &lt;b&gt;custom&lt;/b&gt; paragraph.");
    expect(r.html).not.toContain("<b>custom</b>");
  });

  it("a studio with no name is greeted \"Hi there,\", never with its web address", () => {
    for (const studio of ["", "   ", "https://apexarts.com", "www.apexarts.com", "apexarts.com"]) {
      const r = renderEmail({ ...base, studio });
      expect(r.text.split("\n\n")[0], studio).toBe("Hi there,");
      expect(r.subject, studio).toBe("A question about running your studio");
      expect(r.text + r.html, studio).not.toMatch(/apexarts|Hi your team/);
    }
    expect(renderEmail({ ...reply("maxb_followup_1"), studio: "" }).text.split("\n\n")[0]).toBe("Hi there,");
    expect(renderEmail({ ...base, studio: "Apex Arts" }).text.split("\n\n")[0]).toBe("Hi Apex Arts team,");
  });

  it("keeps the https validation on the booking link", () => {
    expect(() => renderEmail({ ...base, bookingUrl: "http://insecure.example" })).toThrow(/https/);
    const without = renderEmail({ ...base, bookingUrl: undefined });
    expect(without.blockers).toContain("booking_link_not_verified");
    expect(without.links.some((l) => l.startsWith("mailto:lawrenceb@studiopulse.tech?subject="))).toBe(true);
  });
});

describe("MaxB follow-ups and replies", () => {
  it("each is MaxB, working with Lawrence, under 80 words, threaded under the first subject", () => {
    for (const k of ["maxb_followup_1", "maxb_followup_2", "maxb_followup_3", "maxb_reply"] as const) {
      const r = renderEmail(reply(k));
      expect(r.persona).toBe("maxb");
      expect(r.subject).toBe("Re: A question about running MIX Recording Studio");
      expect(r.text).toMatch(/MaxB/);
      expect(r.text).toMatch(/work with Lawrence/);
      expect(r.words).toBeLessThan(80);
      expect(r.text).toContain("studiopulse.tech/demo");
      expect(r.html).toContain("cid:pulse-signature-roverto");
      expect(r.html).toContain("Reply <strong>unsubscribe</strong>");
    }
  });

  it("day 3 bumps Lawrence's note, day 7 names one feature and the offer, day 14 closes politely", () => {
    expect(renderEmail(reply("maxb_followup_1")).text).toContain("Following up on Lawrence’s note");
    const d7 = renderEmail(reply("maxb_followup_2")).text;
    expect(d7).toContain("a client books and pays the deposit, then the room and engineer show up on everyone’s schedule and in the Pulse app");
    expect(d7).toContain("50% off the first 3 months");
    expect(renderEmail(reply("maxb_followup_3")).text).toContain("reply anytime");
  });

  it("a reply keeps the first subject: no subject override, never Re: Re:", () => {
    expect(() => renderEmail({ ...reply("maxb_followup_1"), subjectOverride: "New subject" })).toThrow(/subject/);
    expect(() => renderEmail({ ...reply("maxb_followup_1"), threadSubject: undefined })).toThrow(/subject/);
    expect(renderEmail({ ...reply("maxb_reply"), threadSubject: "Re: Hello" }).subject).toBe("Re: Hello");
  });

  it("a follow-up override replaces only MaxB's middle paragraph", () => {
    const r = renderEmail({ ...reply("maxb_followup_2"), bodyOverride: "Custom day 7 line from the CSV." });
    expect(r.text).toContain("Custom day 7 line from the CSV.");
    expect(r.text).not.toContain("One thing studios like");
    expect(r.text).toContain("50% off the first 3 months"); // the offer stays
  });
});

describe("personas per step", () => {
  it("step 0 is Lawrence; steps 1 to 3 are MaxB on day 3, 7 and 14", () => {
    expect(SEQUENCE_TEMPLATES).toEqual(["lawrence_first", "maxb_followup_1", "maxb_followup_2", "maxb_followup_3"]);
    expect(FOLLOWUP_DAYS).toEqual([0, 3, 7, 14]);
    expect(TEMPLATES[templateForStep(0)].persona).toBe("lawrence");
    for (const s of [1, 2, 3]) expect(TEMPLATES[templateForStep(s)].persona).toBe("maxb");
    expect(PERSONAS.lawrence).toMatchObject({ fromEmail: "lawrenceb@studiopulse.tech", signature: "lawrence", templates: ["lawrence_first"] });
    expect(PERSONAS.maxb).toMatchObject({ fromEmail: "info@studiopulse.tech", signature: "roverto" });
    expect(PERSONAS.maxb.templates).not.toContain("lawrence_first");
    expect(THREAD_REPLY_TO).toEqual(["lawrenceb@studiopulse.tech", "info@studiopulse.tech"]);
    expect(renderEmail(base).replyTo).toEqual(THREAD_REPLY_TO);
  });
});

describe("award language guard", () => {
  it("no template render, signature HTML, alt text or persona copy mentions an award", () => {
    for (const k of ALL_TEMPLATES) {
      for (const mode of MODES) {
        const r = renderEmail(k === "lawrence_first" ? { ...base, signatureMode: mode } : { ...reply(k), signatureMode: mode });
        expect(r.subject + r.html + r.text, `${k}/${mode}`).not.toMatch(BANNED);
      }
    }
    for (const key of ["lawrence", "roverto"] as SignatureKey[]) {
      for (const mode of MODES) expect(signatureHtml(key, mode), `${key}/${mode}`).not.toMatch(BANNED);
      expect(signatureImageHtml(key)).not.toMatch(BANNED); // alt text
    }
    for (const s of [ORIGINAL_LAWRENCE, ORIGINAL_ROVERTO, STATIC_LAWRENCE, STATIC_ROVERTO]) expect(s).not.toMatch(BANNED);
    expect(JSON.stringify(PERSONAS)).not.toMatch(BANNED);
    for (const t of Object.values(TEMPLATES)) {
      const copy = [t.name, t.subject("X"), t.preheader("X"), t.greeting("X"), ...t.middle, t.offer ?? "", t.closing("d"), t.cta, ...t.signoff].join(" ");
      expect(copy, t.key).not.toMatch(BANNED);
      expect(copy, t.key).not.toMatch(/\bCRM\b/i);
    }
  });

  it("refuses award language or CRM even in an opening line or override", () => {
    expect(() => renderEmail({ ...base, observation: "Loved your award-winning live room." })).toThrow(/Award/);
    expect(() => renderEmail({ ...base, bodyOverride: "A Grammy-nominated producer built it." })).toThrow(/Award/);
    expect(() => renderEmail({ ...reply("maxb_followup_1"), bodyOverride: "Our CRM for studios." })).toThrow(/not a CRM/);
  });

  it("the default signature is the badge-free picture for both personas", () => {
    expect(renderEmail(base).html).toContain("cid:pulse-signature-lawrence");
    expect(renderEmail(reply("maxb_followup_1")).html).toContain("cid:pulse-signature-roverto");
    expect(signatureImageHtml("lawrence")).toContain('alt="Lawrence “ThaMyind” Berment, Founder, Pulse."');
  });
});

describe("layout, signatures and footer", () => {
  it("defaults to the exact picture of the Final signature, because Gmail breaks the HTML", () => {
    const r = renderEmail(reply("maxb_followup_1"));
    expect(r.html).toContain("cid:pulse-signature-roverto");
    expect(r.html).not.toContain(ORIGINAL_ROVERTO);
    expect(r.html).not.toContain("<style>.pw");
  });

  it("can embed the Final HTML verbatim, or the email-safe static rebuild", () => {
    expect(renderEmail({ ...reply("maxb_followup_1"), signatureMode: "original" }).html).toContain(ORIGINAL_ROVERTO);
    expect(renderEmail({ ...base, signatureMode: "original" }).html).toContain(ORIGINAL_LAWRENCE);
    const st = renderEmail({ ...reply("maxb_followup_1"), signatureMode: "static" });
    expect(st.html).toContain(STATIC_ROVERTO);
    expect(st.html).not.toContain(ORIGINAL_ROVERTO);
    expect(signatureHtml("lawrence", "original")).toBe(ORIGINAL_LAWRENCE);
  });

  it("keeps the dark card design that survives phone mail apps", () => {
    const r = renderEmail(base);
    expect(r.html).toContain("The studio operating system");
    expect(r.html).toContain("max-width:620px");
    expect(r.html).toContain('bgcolor="#0d0d0f"');
    expect(r.html).toContain('bgcolor="#0a0a0b"');
    expect(r.html).toContain('bgcolor="#fdb913"');
    expect(r.html).toContain("max-width:480px");
    expect(r.html).toContain('name="color-scheme" content="dark"');
  });

  it("without an address the footer says so and approval is blocked", () => {
    const r = renderEmail({ ...base, postalAddress: undefined });
    expect(r.blockers).toContain("postal_address_missing");
    expect(r.html).toContain("[Business mailing address required before sending]");
    expect(renderEmail(base).blockers).not.toContain("postal_address_missing");
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
    expect(() => renderEmail({ ...base, bodyOverride: "One — two." })).toThrow(/Em dash/);
  });

  it("the hash changes when anything that is sent changes", async () => {
    const a = renderEmail(base), b = renderEmail({ ...base, signatureMode: "static" });
    expect(await contentHash([a.html])).not.toBe(await contentHash([b.html]));
    expect(await contentHash([a.html])).toBe(await contentHash([a.html]));
  });

  it("image mode attaches the inline picture and can be previewed", () => {
    const r = renderEmail(base);
    const imgs = inlineImagesFor(r.html);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toMatchObject({ contentId: "pulse-signature-lawrence", contentType: "image/jpeg" });
    expect(Buffer.from(imgs[0].base64, "base64").subarray(0, 2).toString("hex")).toBe("ffd8"); // a real JPEG
    expect(withDataUris(r.html)).toContain("data:image/jpeg;base64,");
    expect(withDataUris(r.html)).not.toContain("cid:");
    expect(inlineImagesFor(renderEmail({ ...base, signatureMode: "original" }).html)).toEqual([]);
  });

  it("the signature is left-aligned inside the centred layout so it matches the source file", () => {
    expect(renderEmail({ ...reply("maxb_followup_1"), signatureMode: "original" }).html).toContain('text-align:left">' + ORIGINAL_ROVERTO.slice(0, 40));
  });

  it("animated mode points at the hosted GIF, needs no attachment, and keeps the links row", () => {
    const r = renderEmail({ ...reply("maxb_followup_1"), signatureMode: "animated" });
    expect(r.html).toContain("https://studiopulse.tech/email/signature-roverto.gif");
    expect(r.html).not.toContain("cid:");
    expect(r.html).toContain("mailto:info@studiopulse.tech");
    expect(inlineImagesFor(r.html)).toEqual([]);
  });

  it("a retired template key is refused, not rendered", () => {
    expect(() => renderEmail({ ...base, template: "maxb_system" as TemplateKey })).toThrow(/no longer available/);
  });
});
