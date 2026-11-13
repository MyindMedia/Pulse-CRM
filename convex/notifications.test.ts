import { describe, it, expect } from "vitest";
import { notificationEmailHtml } from "./notifications";
import { studioEmailHtml } from "./lib/emailTemplates/layout";
import { filesReadyEmail } from "./lib/emailTemplates/sessionDelivery";

describe("notificationEmailHtml", () => {
  it("renders a row without html exactly as before", () => {
    const body = "We received $180. Your session is fully paid.\n\nPay here: https://studiopulse.tech/pay/x";
    expect(notificationEmailHtml({ orgName: "Studio A", body })).toBe(studioEmailHtml({ studioName: "Studio A", bodyText: body }));
    // Button fields alone (no html) change nothing either.
    expect(notificationEmailHtml({ orgName: "Studio A", body, ctaLabel: "x", ctaUrl: "https://x.test", accent: "#000000" })).toBe(
      studioEmailHtml({ studioName: "Studio A", bodyText: body }),
    );
  });

  it("wraps a designed body with its button, the studio accent and readable ink", () => {
    const m = filesReadyEmail({ firstName: "Jordan", title: "Vocal tracking", sessionDate: "Tue, Nov 10", files: [{ name: "a.wav", size: 1000 }], url: "https://app.example.test/delivery/t", expiresOn: "December 13, 2026" });
    const light = notificationEmailHtml({ orgName: "Studio A", body: m.text, html: m.html, ctaLabel: m.ctaLabel, ctaUrl: m.ctaUrl, accent: "#fdb913" });
    expect(light).toContain(m.html);
    expect(light).toContain("background-color:#fdb913");
    expect(light).toContain("color:#1a1a1f;text-decoration:none;\">Download your files</a>");
    const dark = notificationEmailHtml({ orgName: "Studio A", body: m.text, html: m.html, ctaLabel: m.ctaLabel, ctaUrl: m.ctaUrl, accent: "#0a0a0a" });
    expect(dark).toContain("color:#ffffff;text-decoration:none;\">Download your files</a>");
    // A studio with no accent falls back to the Pulse defaults.
    const none = notificationEmailHtml({ orgName: "Studio A", body: m.text, html: m.html, ctaLabel: m.ctaLabel, ctaUrl: m.ctaUrl });
    expect(none).toContain("background-color:#fdb913");
  });
});
