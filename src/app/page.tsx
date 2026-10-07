import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/landing-page";
import {
  SITE_KEYWORDS,
  jsonLdHtml,
  mobileApplicationJsonLd,
  softwareApplicationJsonLd,
} from "@/components/marketing/structured-data";

/* The root URL is the public Pulse marketing site, shown to everyone (signed in
   or out). Signed-in visitors get a "Go to dashboard" link in the nav rather
   than an auto-redirect. `/` is a public route in middleware, so nothing here
   is auth-gated.

   Title, description and the social card come from the root layout; this
   adds the keywords and the structured data (offers read from the pricing
   config). */
export const metadata: Metadata = {
  keywords: SITE_KEYWORDS,
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(softwareApplicationJsonLd()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(mobileApplicationJsonLd()) }}
      />
      <LandingPage />
    </>
  );
}
