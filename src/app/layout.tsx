import type { Metadata, Viewport } from "next";
import {
  Inter,
  Space_Grotesk,
  JetBrains_Mono,
  Instrument_Serif,
  Plus_Jakarta_Sans,
} from "next/font/google";
import { ConvexClientProvider } from "@/components/providers/convex-client-provider";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" });
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

const SITE_URL = "https://pulse.myindsound.com";
const SITE_TITLE = "Pulse - the operating system for music businesses";
const SITE_DESCRIPTION =
  "Pulse is the song-centric CRM for recording studios, producers and labels. Sessions, splits, revisions, releases - one unbroken chain from inquiry to royalty.";

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
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable} ${plusJakarta.variable} h-full`}
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
