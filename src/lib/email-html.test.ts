import { describe, it, expect } from "vitest";
import { sanitizeEmailHtml, emailSrcDoc, hasRemoteImages, EMAIL_IFRAME_SANDBOX } from "./email-html";

describe("sanitizeEmailHtml", () => {
  it("removes scripts, frames, forms and embedded objects", () => {
    const out = sanitizeEmailHtml(
      `<p>Hi</p><script>alert(1)</script><SCRIPT src=x></SCRIPT><iframe src="https://e.vil"></iframe><form action="https://e.vil"><input name=a></form><object data="x"></object><svg><script>1</script></svg>`,
    );
    expect(out).toBe("<p>Hi</p>");
  });

  it("strips event handlers and javascript: URLs", () => {
    const out = sanitizeEmailHtml(`<a href="javascript:alert(1)" onclick="x()">a</a><img src=x onerror=alert(1)><div onmouseover='y'>d</div>`);
    expect(out).not.toMatch(/onclick|onerror|onmouseover|javascript:/i);
    expect(out).toContain('href="#"');
  });

  it("drops meta refresh, base and link tags and comments", () => {
    const out = sanitizeEmailHtml(`<meta http-equiv="refresh" content="0;url=https://e.vil"><base href="https://e.vil/"><link rel=stylesheet href="https://e.vil/x.css"><!-- <script>1</script> --><p>ok</p>`);
    expect(out).toBe("<p>ok</p>");
  });

  it("blocks remote images (tracking pixels) by default and allows them on request", () => {
    const html = `<img src="https://track.example/p.gif" width=1><img src="cid:logo"><div style="background:url('https://x.example/b.png')">x</div>`;
    expect(hasRemoteImages(html)).toBe(true);
    const blocked = sanitizeEmailHtml(html);
    expect(blocked).toContain('data-blocked-src="https://track.example/p.gif"');
    expect(blocked).not.toMatch(/\ssrc="https:/);
    expect(blocked).toContain("url('blocked://");
    const allowed = sanitizeEmailHtml(html, { allowRemoteImages: true });
    expect(allowed).toContain('src="https://track.example/p.gif"');
  });

  it("wraps in a document with a CSP that forbids scripts and remote loads by default", () => {
    const doc = emailSrcDoc("<p>x</p>");
    expect(doc).toContain("default-src 'none'; img-src data:;");
    expect(doc).toContain('<base target="_blank">');
    expect(emailSrcDoc("<p>x</p>", { allowRemoteImages: true })).toContain("img-src data: https:;");
  });

  it("forces every link to open with rel=noopener noreferrer (no reverse tabnabbing)", () => {
    const out = sanitizeEmailHtml(
      `<a href="https://a.example" rel="opener" target="_self">a</a><A HREF='https://b.example'>b</A><area href="https://c.example" target=_top rel=opener>`,
    );
    expect(out).not.toMatch(/rel\s*=\s*["']?opener/i);
    expect(out).not.toMatch(/target\s*=\s*["']?_(?:self|top)/i);
    expect(out.match(/rel="noopener noreferrer"/g)?.length).toBe(3);
    expect(out.match(/target="_blank"/g)?.length).toBe(3);
    expect(out).toContain(">a</a>");
  });

  it("sandboxes the message frame without letting popups escape the sandbox", () => {
    expect(EMAIL_IFRAME_SANDBOX).toBe("allow-popups");
    expect(EMAIL_IFRAME_SANDBOX).not.toMatch(/escape-sandbox|allow-scripts|allow-same-origin|allow-top-navigation/);
  });
});
