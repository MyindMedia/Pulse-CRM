import { describe, it, expect } from "vitest";
import { inviteEmailHtml, inviteEmailSubject } from "./invite";

describe("invite email template", () => {
  it("embeds studio name, inviter, accept url, and a paste-fallback link", () => {
    const html = inviteEmailHtml({
      ownerName: "Jordan", studioName: "Skyline Records",
      inviterName: "Lawrence at Myind Sound",
      acceptUrl: "https://app.pulse.studio/invite/abc123",
      logoUrl: "https://app.pulse.studio/pulse-logo.png",
    });
    expect(html).toContain("Jordan");
    expect(html).toContain("Skyline Records");
    expect(html).toContain("Lawrence at Myind Sound");
    expect(html).toContain("https://app.pulse.studio/invite/abc123");
    expect(html).toContain("https://app.pulse.studio/pulse-logo.png");
    expect(html.toLowerCase()).toContain("<!doctype html");
  });

  it("escapes HTML in interpolated values (no tag injection)", () => {
    const html = inviteEmailHtml({
      ownerName: "Jordan", studioName: '<script>alert(1)</script>',
      inviterName: "Admin", acceptUrl: "https://app.pulse.studio/invite/x",
      logoUrl: "https://app.pulse.studio/pulse-logo.png",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("subject names the studio", () => {
    expect(inviteEmailSubject("Skyline Records")).toMatch(/Skyline Records/);
  });
});
