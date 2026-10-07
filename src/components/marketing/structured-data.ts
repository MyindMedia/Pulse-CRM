import { PRICING, TIERS } from "@convex/lib/pricing";
import { PULSE_IOS_APP_URL } from "./app-store";

/* ============================================================
   Search metadata shared by the homepage and /pricing.

   Offers are generated from convex/lib/pricing.ts, so a price change there
   reaches the JSON-LD the next build, with nothing typed twice. Pulse OS is a
   studio operating system: the three-letter customer-relationship acronym is
   never used in keywords, categories or descriptions.
   ============================================================ */

export const SITE_URL = "https://studiopulse.tech";

/** Site keywords, from the pricing build brief. */
export const SITE_KEYWORDS = [
  "recording studio management software",
  "music studio booking software",
  "studio operating system",
  "studio scheduling",
  "session booking",
  "studio staff scheduling and payroll",
  "studio gear and patchbay management",
  "split sheets",
  "multi-studio management",
  "white-label studio software",
  "iOS studio app",
];

export const SOFTWARE_DESCRIPTION =
  "Pulse OS is the studio operating system for recording and music studios: online booking with deposits to your own Stripe account, staff scheduling and payroll, gear and cable maps, song splits, and one screen for every studio you run.";

/** schema.org SoftwareApplication for the web product, one Offer per tier,
 *  monthly, in USD. */
export function softwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Pulse OS",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    description: SOFTWARE_DESCRIPTION,
    publisher: { "@type": "Organization", name: "Pulse", url: SITE_URL },
    offers: TIERS.map((t) => ({
      "@type": "Offer",
      name: PRICING[t].name,
      description: PRICING[t].tagline,
      price: PRICING[t].monthlyUsd.toFixed(2),
      priceCurrency: "USD",
      url: `${SITE_URL}/pricing`,
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: PRICING[t].monthlyUsd.toFixed(2),
        priceCurrency: "USD",
        billingDuration: "P1M",
        unitText: "month",
      },
    })),
  };
}

/** schema.org MobileApplication for the Pulse iPhone app. Free to download;
 *  no plan names, matching the app itself. */
export function mobileApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "MobileApplication",
    name: "My Studio Pulse",
    alternateName: "Pulse app",
    applicationCategory: "BusinessApplication",
    operatingSystem: "iOS",
    installUrl: PULSE_IOS_APP_URL,
    url: `${SITE_URL}/mobile`,
    description:
      "The Pulse app for iPhone. Run your studio from your phone: today's sessions, the calendar, room status, payments in the room and phone alerts.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@type": "Organization", name: "Pulse", url: SITE_URL },
  };
}

/** Serialized for a <script type="application/ld+json">, with "<" escaped so
 *  no string in the data can close the script tag. */
export function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
