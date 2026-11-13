import type { Metadata, Viewport } from "next";

/* The client download page (/delivery/<token>). The token in the URL is the
   only credential, so:
   - no-referrer: no request from this page (a logo, the checkout, the legal
     pages, the signed file links) carries the URL in a Referer header;
   - noindex, nofollow: a link that leaks never lands in search.
   next.config.ts sends the same two as response headers. No analytics, pixels
   or third-party scripts are added here. */
export const metadata: Metadata = {
  title: "Your files",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/* The root layout locks pinch zoom for the app's native feel. A client reading
   this page may need to zoom (200% text), so it is allowed here. */
export const viewport: Viewport = {
  themeColor: "#08080a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default function DeliveryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
