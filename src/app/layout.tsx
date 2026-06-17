import type { Metadata, Viewport } from "next";
import {
  Inter,
  JetBrains_Mono,
  Instrument_Serif,
  Plus_Jakarta_Sans,
  Anton,
  IBM_Plex_Mono,
} from "next/font/google";
import { ConvexClientProvider } from "@/components/providers/convex-client-provider";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  variable: "--font-instrument-serif",
  display: "swap",
});
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
});
// Chrome redesign: Anton = monolithic display face (ABC Gravity substitute),
// IBM Plex Mono = system metadata voice.
const anton = Anton({ subsets: ["latin"], weight: "400", variable: "--font-anton", display: "swap" });
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

const SITE_URL = "https://pulse.myindsound.com";
const SITE_TITLE = "Pulse: Recording Studio Management Software";
const SITE_DESCRIPTION =
  "Recording studio management software: online booking with deposits to your own Stripe, room and staff scheduling, gear tracking and invoicing. From $49/mo.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  applicationName: "Pulse",
  authors: [{ name: "Myind Sound" }],
  openGraph: {
    type: "website",
    siteName: "Pulse",
    url: SITE_URL,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#08080a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable} ${plusJakarta.variable} ${anton.variable} ${ibmPlexMono.variable} h-full`}
    >
      <body className="min-h-full antialiased">
        {/* No-flash theme: set data-theme before paint from saved choice or
            the OS preference (default dark). The toggle updates it at runtime. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('pulse-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();",
          }}
        />
        <ConvexClientProvider>{children}</ConvexClientProvider>
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--color-coal-2)",
              border: "1px solid var(--color-hairline-2)",
              color: "var(--color-bone)",
              borderRadius: "12px",
              fontFamily: "var(--font-sans)",
            },
          }}
        />
      </body>
    </html>
  );
}
