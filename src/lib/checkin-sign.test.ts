import { describe, it, expect } from "vitest";
import { checkinSignHtml } from "./checkin-sign";

const QR = `<svg viewBox="0 0 29 29"><path d="M0 0h9v9H0z"/></svg>`;
const URL = "https://studiopulse.tech/visit/myind-sound";

describe("checkinSignHtml", () => {
  it("brands the sign with name, tagline, accent and logo", () => {
    const html = checkinSignHtml(
      { name: "Myind Sound", tagline: "Where the record gets made.", accentColor: "#fbae37", logoUrl: "https://cdn.example/logo.png" },
      URL,
      QR,
    );
    expect(html).toContain("MYIND SOUND".length ? "Myind Sound" : "");
    expect(html).toContain("Where the record gets made.");
    expect(html).toContain("--accent: #fbae37");
    expect(html).toContain('src="https://cdn.example/logo.png"');
    expect(html).toContain(QR);
    expect(html).toContain(URL);
    expect(html).toContain("Powered by Pulse");
  });

  it("falls back to a monogram and Pulse gold without logo/accent", () => {
    const html = checkinSignHtml({ name: "echo studios" }, URL, QR);
    expect(html).toContain("--accent: #fdb913");
    expect(html).toContain('class="monogram">E<');
    expect(html).not.toContain('class="logo"');
  });

  it("rejects a non-hex accent (style injection) and escapes HTML in text", () => {
    const html = checkinSignHtml(
      { name: `<script>alert(1)</script>`, accentColor: "red; } body { display:none" },
      URL,
      QR,
    );
    expect(html).toContain("--accent: #fdb913");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
