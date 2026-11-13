import { describe, it, expect } from "vitest";
import { notificationEmailHtml } from "./notifications";
import { studioEmailHtml } from "./lib/emailTemplates/layout";
import { filesReadyEmail } from "./lib/emailTemplates/sessionDelivery";

describe("notificationEmailHtml", () => {
  it("renders a row without html exactly as before", () => {
    const body = "We received $180. Your session is fully paid.\n\nPay here: https://studiopulse.tech/pay/x";
    expect(notificationEmailHtml({ orgName: "Studio A", body })).toBe(studioEmailHtml({ studioName: "Studio A", bodyText: body }));
    // An accent alone (no html) changes nothing either.
    expect(notificationEmailHtml({ orgName: "Studio A", body, accent: "#000000" })).toBe(
      studioEmailHtml({ studioName: "Studio A", bodyText: body }),
    );
  });

  it("wraps a designed body (which carries its own button) with the studio accent on the header bar", () => {
    const email = (accent?: string) =>
      filesReadyEmail({ firstName: "Jordan", title: "Vocal tracking", sessionDate: "Tue, Nov 10", files: [{ name: "a.wav", size: 1000 }], url: "https://app.example.test/delivery/t", expiresOn: "December 13, 2026", accent });
    const light = email("#fdb913");
    const lightHtml = notificationEmailHtml({ orgName: "Studio A", body: light.text, html: light.html, accent: "#fdb913" });
    expect(lightHtml).toContain(light.html);
    expect(lightHtml).toContain("border-bottom:3px solid #fdb913");
    expect(lightHtml).toContain("color:#1a1a1f;text-decoration:none;\">Download your files</a>");
    // B-04: one button, the body's own, with the small print under it.
    expect(lightHtml.match(/text-decoration:none;">/g)).toHaveLength(1);
    expect(lightHtml.indexOf("Download your files</a>")).toBeLessThan(lightHtml.indexOf("The link works until"));
    const dark = email("#0a0a0a");
    expect(notificationEmailHtml({ orgName: "Studio A", body: dark.text, html: dark.html, accent: "#0a0a0a" })).toContain(
      "color:#ffffff;text-decoration:none;\">Download your files</a>",
    );
    // A studio with no accent falls back to the Pulse defaults.
    const none = email();
    expect(notificationEmailHtml({ orgName: "Studio A", body: none.text, html: none.html })).toContain("background-color:#fdb913");
  });
});
