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
const SITE_TITLE = "Pulse - the operating system for recording studios";
const SITE_DESCRIPTION =
  "Pulse runs your recording studio: bookings, rooms, staff scheduling, inventory and payments, all in sync and automated.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
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
      className={`${inter.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable} ${plusJakarta.variable} ${anton.variable} ${ibmPlexMono.variable} h-full`}
    >
      <body className="min-h-full antialiased">
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
