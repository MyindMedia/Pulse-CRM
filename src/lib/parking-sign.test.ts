import { describe, it, expect } from "vitest";
import { parkingSignHtml } from "./parking-sign";

describe("parkingSignHtml", () => {
  it("brands the badge with studio logo, accent and the guest name", () => {
    const html = parkingSignHtml(
      { name: "Myind Sound", accentColor: "#fbae37", logoUrl: "https://cdn.example/logo.png" },
      "Mira Quartz",
    );
    expect(html).toContain("Mira Quartz");
    expect(html).toContain("--accent: #fbae37");
    expect(html).toContain('src="https://cdn.example/logo.png"');
    expect(html).toContain("Reserved parking");
    expect(html).toContain("Powered by Pulse");
  });

  it("falls back to a monogram and Pulse gold, and trims the guest name", () => {
    const html = parkingSignHtml({ name: "echo studios" }, "  Nova  ");
    expect(html).toContain("--accent: #fdb913");
    expect(html).toContain('class="monogram">E<');
    expect(html).toContain(">Nova<em>");
  });

  it("escapes HTML in the guest name and rejects a non-hex accent", () => {
    const html = parkingSignHtml(
      { name: "Studio", accentColor: "url(javascript:1)" },
      `<img src=x onerror=alert(1)>`,
    );
    expect(html).toContain("--accent: #fdb913");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});
