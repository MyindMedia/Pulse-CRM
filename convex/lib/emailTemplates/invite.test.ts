import { describe, it, expect } from "vitest";
import { inviteEmailHtml, inviteEmailSubject } from "./invite";

describe("invite email template", () => {
  it("embeds studio name, inviter, accept url, and a paste-fallback link", () => {
    const html = inviteEmailHtml({
      ownerName: "Jordan", studioName: "Skyline Records",
      inviterName: "Lawrence at ThaMyind",
      acceptUrl: "https://studiopulse.tech/invite/abc123",
      logoUrl: "https://studiopulse.tech/pulse-logo.png",
    });
    expect(html).toContain("Jordan");
    expect(html).toContain("Skyline Records");
    expect(html).toContain("Lawrence at ThaMyind");
    expect(html).toContain("https://studiopulse.tech/invite/abc123");
    expect(html).toContain("https://studiopulse.tech/pulse-logo.png");
    expect(html.toLowerCase()).toContain("<!doctype html");
  });

  it("escapes HTML in interpolated values (no tag injection)", () => {
    const html = inviteEmailHtml({
      ownerName: "Jordan", studioName: '<script>alert(1)</script>',
      inviterName: "Admin", acceptUrl: "https://studiopulse.tech/invite/x",
      logoUrl: "https://studiopulse.tech/pulse-logo.png",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("subject names the studio", () => {
    expect(inviteEmailSubject("Skyline Records")).toMatch(/Skyline Records/);
  });
});
