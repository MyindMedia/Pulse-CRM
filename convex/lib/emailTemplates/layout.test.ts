import { describe, it, expect } from "vitest";
import { escapeEmailHtml, textToEmailHtml, studioEmailHtml } from "./layout";

describe("branded studio email layout", () => {
  it("escapes HTML so client-controlled text can't inject markup", () => {
    expect(escapeEmailHtml('<img src=x onerror=alert(1)> & "quotes"')).not.toContain("<img");
    const html = textToEmailHtml("Hi <b>there</b>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("keeps invoice/pay URLs clickable after escaping", () => {
    const html = textToEmailHtml("Pay here: https://pulse.myindsound.com/pay/abc?x=1&y=2");
    expect(html).toContain('<a href="https://pulse.myindsound.com/pay/abc?x=1&y=2"');
  });

  it("splits paragraphs and line breaks", () => {
    const html = textToEmailHtml("Line one\nLine two\n\nNew paragraph");
    expect(html).toContain("Line one<br/>Line two");
    expect((html.match(/<p /g) ?? []).length).toBe(2);
  });

  it("frames the STUDIO's name in the header and Pulse only in the footer", () => {
    const html = studioEmailHtml({ studioName: "Myind Sound", bodyText: "Hello" });
    expect(html).toContain("Myind Sound");
    expect(html).toContain("Sent with");
    expect(html).toContain("#fdb913"); // gold accent bar
  });

  it("renders an optional gold CTA", () => {
    const html = studioEmailHtml({
      studioName: "Myind Sound",
      bodyText: "Confirm your session",
      ctaLabel: "Confirm booking",
      ctaUrl: "https://pulse.myindsound.com/book/myind-sound",
    });
    expect(html).toContain("Confirm booking");
    expect(html).toContain('href="https://pulse.myindsound.com/book/myind-sound"');
  });
});
