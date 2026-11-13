import { describe, it, expect } from "vitest";
import { filesReadyEmail, payToUnlockEmail, formatBytes, sessionWords, type DeliveryFile } from "./sessionDelivery";
import { readableEmailInk, studioEmailHtml, emailButtonHtml } from "./layout";
import { contrastRatio } from "../themeSpec";

const files: DeliveryFile[] = [
  { name: "Lead vocal comp.wav", size: 58_200_000 },
  { name: "Stems.zip", size: 1_420_000_000 },
  { name: "Lyric sheet.pdf", size: 212_000 },
];
const url = "https://app.example.test/delivery/abc123";

const ready = (over: Partial<Parameters<typeof filesReadyEmail>[0]> = {}) =>
  filesReadyEmail({ firstName: "Jordan", title: "Vocal tracking", sessionDate: "Tue, Nov 10", files, url, expiresOn: "December 13, 2026", accent: "#3b63e6", ...over });
const pay = (over: Partial<Parameters<typeof payToUnlockEmail>[0]> = {}) =>
  payToUnlockEmail({ firstName: "Jordan", title: "Vocal tracking", sessionDate: "Tue, Nov 10", files, url, balanceCents: 18000, payOnline: true, invoiceOpen: false, studioName: "Studio A", accent: "#3b63e6", ...over });

/** Where a string sits in the html, failing loudly when it is missing. */
function at(html: string, needle: string): number {
  const i = html.indexOf(needle);
  expect(i, needle).toBeGreaterThanOrEqual(0);
  return i;
}

describe("session delivery emails", () => {
  it("E-01 files ready: exact subject, heading, button and every file with its size", () => {
    const m = ready({ paidCents: 18000 });
    expect(m.subject).toBe("Your files from Vocal tracking are ready");
    expect(m.html).toContain("color:#ffffff;text-decoration:none;\">Download your files</a>");
    expect(m.html).toContain(`href="${url}"`);
    expect(m.html).toContain("Your files are ready, Jordan");
    expect(m.html).toContain("Everything from your Vocal tracking session on Tue, Nov 10 is ready to download. Payment received: $180.00. Thank you.");
    // The plain copy is the booking's message log, which staff without money sight read: no amount.
    expect(m.text).toContain("Everything from your Vocal tracking session on Tue, Nov 10 is ready to download. Payment received. Thank you.");
    expect(m.text).not.toContain("$");
    expect(m.text).toContain("The link works until December 13, 2026. If it stops working, reply to this email for a new one.");
    for (const f of files) {
      expect(m.html).toContain(f.name);
      expect(m.text).toContain(f.name);
    }
    for (const size of ["58.2 MB", "1.42 GB", "212 KB"]) {
      expect(m.html).toContain(size);
      expect(m.text).toContain(size);
    }
    // Without a payment in the same moment, no payment line.
    expect(ready().text).not.toContain("Payment received");
  });

  it("E-01 the wrapped email carries the studio name, its accent and a readable button", () => {
    const m = ready();
    const html = studioEmailHtml({ studioName: "Studio A", bodyHtml: m.html, accent: "#3b63e6", accentInk: readableEmailInk("#3b63e6") });
    expect(html).toContain("Studio A");
    expect(html).toContain("background-color:#3b63e6");
    expect(html).toContain("color:#ffffff;text-decoration:none;\">Download your files</a>");
    expect(html).toContain(`href="${url}"`);
  });

  it("E-02 pay to unlock: exact subject, the amount and the Pay and unlock button", () => {
    const m = pay();
    expect(m.subject).toBe("Your files are ready. One step left");
    expect(m.html).toContain("\">Pay $180.00 and unlock</a>");
    expect(m.html).toContain("Your files are finished, Jordan");
    expect(m.html).toContain(
      "Your Vocal tracking session from Tue, Nov 10 is finished and waiting. There is a $180.00 balance on this booking. Once it is paid, your download link arrives right away.",
    );
    // B-03: the plain copy (the message log) never carries the amount.
    expect(m.text).toContain(
      "Your Vocal tracking session from Tue, Nov 10 is finished and waiting. There is a balance on this booking. Once it is paid, your download link arrives right away.",
    );
    expect(m.text).not.toContain("$");
    expect(m.text).not.toContain("180");
    expect(m.text).toContain("Already paid? Reply to this email and the studio will sort it out.");
    for (const f of files) expect(m.html).toContain(f.name);
    expect(pay({ balanceCents: 12345 }).html).toContain("\">Pay $123.45 and unlock</a>");
  });

  it("drops the comma and the name when there is no first name", () => {
    expect(ready({ firstName: "" }).html).toContain("Your files are ready</h1>");
    expect(pay({ firstName: "  " }).html).toContain("Your files are finished</h1>");
  });

  it("E-03 a hostile name, title or file name is escaped and never raw", () => {
    for (const evil of ["<script>alert(1)</script>", "\"><img src=x>"]) {
      const outs = [
        ready({ firstName: evil }),
        ready({ title: evil }),
        ready({ files: [{ name: evil, size: 10 }] }),
        pay({ firstName: evil }),
        pay({ title: evil }),
        pay({ files: [{ name: evil, size: 10 }] }),
      ];
      for (const m of outs) {
        expect(m.html).not.toContain("<script");
        expect(m.html).not.toContain("<img");
        expect(m.html).not.toContain("\"><img");
        expect(m.html).toMatch(/&lt;(script|img)/);
      }
      // The studio name is escaped by the layout.
      const wrapped = studioEmailHtml({ studioName: evil, bodyHtml: ready().html });
      expect(wrapped).not.toContain("<script");
      expect(wrapped).not.toContain("<img");
    }
  });

  it("E-04 a light accent gets dark button ink and a dark accent gets light ink", () => {
    expect(readableEmailInk("#fdb913")).toBe("#1a1a1f");
    expect(readableEmailInk("#ffffff")).toBe("#1a1a1f");
    expect(readableEmailInk("#0a0a0a")).toBe("#ffffff");
    // F2-12: the ink with the higher WCAG contrast wins, and it is never under
    // 4.5:1. A coral the old brightness cutoff gave white ink (2.8:1) gets the
    // dark ink; a green neither standard ink clears 4.5:1 on gets black.
    expect(readableEmailInk("#ff6b4a")).toBe("#1a1a1f");
    expect(readableEmailInk("#0f8f6f")).toBe("#000000");
    expect(readableEmailInk("#3b63e6")).toBe("#ffffff");
    for (const accent of ["#ff6b4a", "#0f8f6f", "#3b63e6", "#fdb913", "#ffffff", "#0a0a0a", "#808080", "#767676", "#ff0000", "#00ff00", "#0000ff"]) {
      expect(contrastRatio(accent, readableEmailInk(accent))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("E-06 no em dash in any output", () => {
    for (const m of [ready(), ready({ paidCents: 100 }), ready({ firstName: "" }), pay(), pay({ firstName: "" })]) {
      for (const s of [m.subject, m.text, m.html]) expect(s).not.toContain("\u2014");
    }
  });

  it("B-04 the button sits in the body under the file list and above the small print, as in the mockup", () => {
    for (const [m, label, fine] of [
      [ready(), "Download your files", "The link works until"],
      [pay(), "Pay $180.00 and unlock", "Already paid?"],
    ] as const) {
      expect(m).not.toHaveProperty("ctaLabel");
      expect(m).not.toHaveProperty("ctaUrl");
      const button = at(m.html, `">${label}</a>`);
      expect(at(m.html, "Lyric sheet.pdf")).toBeLessThan(button);
      expect(button).toBeLessThan(at(m.html, fine));
      // Exactly one button.
      expect(m.html.match(/<a /g)).toHaveLength(1);
    }
  });

  it("B-04 the button is the layout's own button, in the studio accent with readable ink", () => {
    for (const accent of ["#3b63e6", "#fdb913", "#0a0a0a", "#ffffff"]) {
      const button = emailButtonHtml({ label: "Download your files", url, accent, accentInk: readableEmailInk(accent) });
      expect(ready({ accent }).html).toContain(button);
      expect(button).toContain(`background-color:${accent}`);
      expect(button).toContain(`color:${readableEmailInk(accent)};text-decoration:none;`);
      // The same markup studioEmailHtml puts under a body.
      expect(studioEmailHtml({ studioName: "Studio A", bodyText: "x", ctaLabel: "Download your files", ctaUrl: url, accent, accentInk: readableEmailInk(accent) })).toContain(button);
    }
    // No accent, or one that is not a plain hex: the Pulse gold with its own ink.
    for (const accent of [undefined, "red;background:url(x)"]) {
      const html = ready({ accent }).html;
      expect(html).toContain("background-color:#fdb913");
      expect(html).toContain("color:#241900;text-decoration:none;");
      expect(html).not.toContain("url(x)");
    }
    // A hostile link is escaped inside the href.
    expect(ready({ url: 'https://x.test/"><script>' }).html).not.toContain("<script>");
  });

  it("V3-06 a title that already ends with session is not followed by a second session", () => {
    expect(sessionWords("Writing session")).toBe("Writing session");
    expect(sessionWords("Velvet Hours - writing SESSION")).toBe("Velvet Hours - writing SESSION");
    expect(sessionWords("Vocal tracking")).toBe("Vocal tracking session");
    expect(sessionWords("Sessions demo")).toBe("Sessions demo session");
    for (const title of ["Writing session", "Velvet Hours - writing Session"]) {
      for (const m of [ready({ title }), pay({ title }), pay({ title, payOnline: false })]) {
        expect(m.html.toLowerCase()).not.toContain("session session");
        expect(m.text.toLowerCase()).not.toContain("session session");
      }
    }
    expect(ready({ title: "Writing session" }).text).toContain("Everything from your Writing session on Tue, Nov 10 is ready to download.");
    expect(pay({ title: "Writing session" }).text).toContain("Your Writing session from Tue, Nov 10 is finished and waiting.");
  });

  it("V3-06 the message log copy has a blank line between the heading and the body", () => {
    for (const m of [ready(), pay(), pay({ payOnline: false }), pay({ balanceCents: null })]) {
      const [head, blank, body] = m.text.split("\n");
      expect(head).toMatch(/^Your files are (ready|finished), Jordan$/);
      expect(blank).toBe("");
      expect(body.length).toBeGreaterThan(0);
    }
  });

  it("R3-02 the pay email without an online target: no button, and the studio will send a way to pay", () => {
    const m = pay({ payOnline: false, studioName: "Night Owl Studio" });
    expect(m.html).toContain(
      "Your Vocal tracking session from Tue, Nov 10 is finished and waiting. There is a $180.00 balance on this booking. Night Owl Studio will send you a way to pay it. Once it is paid, your download link arrives right away.",
    );
    expect(m.html).not.toContain("<a ");
    expect(m.text).toContain("There is a balance on this booking. Night Owl Studio will send you a way to pay it.");
    expect(m.text).not.toContain("$");
    // Hidden prices: no amount at all, button or not.
    for (const payOnline of [true, false]) {
      const h = pay({ balanceCents: null, payOnline });
      expect(h.html).toContain("There is a balance on this booking.");
      expect(h.html).not.toMatch(/\$\s?\d/);
      expect(h.html.includes(">Pay and unlock</a>")).toBe(payOnline);
    }
    // A hostile studio name is escaped.
    expect(pay({ payOnline: false, studioName: "<b>X</b>" }).html).toContain("&lt;b&gt;X&lt;/b&gt; will send you a way to pay it.");
  });

  it("P4-03 no online target and an invoice already open: pay it with the invoice the studio sent", () => {
    const m = pay({ payOnline: false, invoiceOpen: true, studioName: "Night Owl Studio" });
    expect(m.html).toContain(
      "Your Vocal tracking session from Tue, Nov 10 is finished and waiting. There is a $180.00 balance on this booking. Pay it with the invoice Night Owl Studio sent you. Once it is paid, your download link arrives right away.",
    );
    expect(m.html).not.toContain("<a ");
    expect(m.html).not.toContain("will send you a way to pay");
    // The log copy: the same line, no amount.
    expect(m.text).toContain(
      "There is a balance on this booking. Pay it with the invoice Night Owl Studio sent you. Once it is paid, your download link arrives right away.",
    );
    expect(m.text).not.toContain("$");
    expect(m.text).not.toContain("will send you a way to pay");
    // Hidden prices: the same line, no amount anywhere.
    const h = pay({ balanceCents: null, payOnline: false, invoiceOpen: true });
    expect(h.html).toContain("There is a balance on this booking. Pay it with the invoice Studio A sent you.");
    expect(h.html).not.toMatch(/\$\s?\d/);
    // A blank studio name and a hostile one.
    expect(pay({ payOnline: false, invoiceOpen: true, studioName: " " }).html).toContain("Pay it with the invoice The studio sent you.");
    expect(pay({ payOnline: false, invoiceOpen: true, studioName: "<b>X</b>" }).html).toContain("Pay it with the invoice &lt;b&gt;X&lt;/b&gt; sent you.");
  });

  it("P4-03 no open invoice: the studio will send a way to pay, as before; with a target: the button, as before", () => {
    const none = pay({ payOnline: false, invoiceOpen: false, studioName: "Night Owl Studio" });
    expect(none.html).toContain("Night Owl Studio will send you a way to pay it. Once it is paid, your download link arrives right away.");
    expect(none.html).not.toContain("Pay it with the invoice");
    // A target (the open invoice itself, for exactly what is owed): unchanged.
    const target = pay({ payOnline: true, invoiceOpen: true });
    expect(target.html).toEqual(pay({ payOnline: true, invoiceOpen: false }).html);
    expect(target.text).toEqual(pay({ payOnline: true, invoiceOpen: false }).text);
    expect(target.html).toContain(">Pay $180.00 and unlock</a>");
    expect(target.html).not.toContain("Pay it with the invoice");
  });

  it("formatBytes: decimal units, three significant figures", () => {
    expect(formatBytes(212_000)).toBe("212 KB");
    expect(formatBytes(58_200_000)).toBe("58.2 MB");
    expect(formatBytes(1_420_000_000)).toBe("1.42 GB");
    expect(formatBytes(5_000_000)).toBe("5 MB");
    expect(formatBytes(999_999)).toBe("1 MB");
    expect(formatBytes(512)).toBe("512 B");
  });
});
