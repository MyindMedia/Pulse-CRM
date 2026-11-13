import { describe, it, expect } from "vitest";
import { filesReadyEmail, payToUnlockEmail, formatBytes, type DeliveryFile } from "./sessionDelivery";
import { readableEmailInk, studioEmailHtml } from "./layout";

const files: DeliveryFile[] = [
  { name: "Lead vocal comp.wav", size: 58_200_000 },
  { name: "Stems.zip", size: 1_420_000_000 },
  { name: "Lyric sheet.pdf", size: 212_000 },
];
const url = "https://app.example.test/delivery/abc123";

const ready = (over: Partial<Parameters<typeof filesReadyEmail>[0]> = {}) =>
  filesReadyEmail({ firstName: "Jordan", title: "Vocal tracking", sessionDate: "Tue, Nov 10", files, url, expiresOn: "December 13, 2026", ...over });
const pay = (over: Partial<Parameters<typeof payToUnlockEmail>[0]> = {}) =>
  payToUnlockEmail({ firstName: "Jordan", title: "Vocal tracking", sessionDate: "Tue, Nov 10", files, url, balanceCents: 18000, ...over });

describe("session delivery emails", () => {
  it("E-01 files ready: exact subject, heading, button and every file with its size", () => {
    const m = ready({ paidCents: 18000 });
    expect(m.subject).toBe("Your files from Vocal tracking are ready");
    expect(m.ctaLabel).toBe("Download your files");
    expect(m.ctaUrl).toBe(url);
    expect(m.html).toContain("Your files are ready, Jordan");
    expect(m.text).toContain("Everything from your Vocal tracking session on Tue, Nov 10 is ready to download. Payment received: $180. Thank you.");
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
    const html = studioEmailHtml({ studioName: "Studio A", bodyHtml: m.html, ctaLabel: m.ctaLabel, ctaUrl: m.ctaUrl, accent: "#3b63e6", accentInk: readableEmailInk("#3b63e6") });
    expect(html).toContain("Studio A");
    expect(html).toContain("background-color:#3b63e6");
    expect(html).toContain("color:#ffffff;text-decoration:none;\">Download your files</a>");
    expect(html).toContain(`href="${url}"`);
  });

  it("E-02 pay to unlock: exact subject, the amount and the Pay and unlock button", () => {
    const m = pay();
    expect(m.subject).toBe("Your files are ready. One step left");
    expect(m.ctaLabel).toBe("Pay $180 and unlock");
    expect(m.html).toContain("Your files are finished, Jordan");
    expect(m.text).toContain(
      "Your Vocal tracking session from Tue, Nov 10 is finished and waiting. There is a $180 balance on this booking. Once it is paid, your download link arrives right away.",
    );
    expect(m.text).toContain("Already paid? Reply to this email and the studio will sort it out.");
    for (const f of files) expect(m.html).toContain(f.name);
    expect(pay({ balanceCents: 12345 }).ctaLabel).toBe("Pay $123.45 and unlock");
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
  });

  it("E-06 no em dash in any output", () => {
    for (const m of [ready(), ready({ paidCents: 100 }), ready({ firstName: "" }), pay(), pay({ firstName: "" })]) {
      for (const s of [m.subject, m.text, m.html, m.ctaLabel]) expect(s).not.toContain("\u2014");
    }
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
