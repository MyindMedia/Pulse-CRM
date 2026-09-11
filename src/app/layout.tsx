import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import {
  Inter,
  JetBrains_Mono,
  Instrument_Serif,
  Plus_Jakarta_Sans,
  Anton,
  IBM_Plex_Mono,
} from "next/font/google";
import { ConvexClientProvider } from "@/components/providers/convex-client-provider";
import { NativeShellBridge } from "@/components/shell/native-shell-bridge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isSatelliteHost } from "@/lib/clerk-domains";
import { Toaster } from "sonner";
import "./globals.css";
import { fromPriceLabel } from "@/components/marketing/pricing-tiers";

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

const SITE_URL = "https://studiopulse.tech";
const SITE_TITLE = "Pulse: Recording Studio Management Software";
// What a shared link says. The page <title> stays keyword-shaped for search;
// the social card leads with the category line instead, and every shared link
// resolves to studiopulse.tech.
const SHARE_TITLE = "Pulse. The studio operating system.";
// The entry price is derived, so a search result can never quote a number the
// pricing section stopped charging. It sat at "$49/mo" for months after the
// ladder moved.
const SITE_DESCRIPTION =
  "Recording studio management software with a built-in AI manager: online booking with deposits to your own Stripe (keep 100%), staff scheduling, inventory tracking, song splits and rights, and invoicing, all in one place. " +
  `${fromPriceLabel()}.`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  applicationName: "Pulse",
  // Installable-to-home-screen support on iOS (Next auto-links app/manifest.ts).
  appleWebApp: { capable: true, title: "Pulse", statusBarStyle: "black-translucent" },
  icons: { apple: "/apple-touch-icon.png" },
  authors: [{ name: "ThaMyind" }],
  openGraph: {
    type: "website",
    siteName: "Pulse",
    url: SITE_URL,
    title: SHARE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SHARE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#08080a",
  width: "device-width",
  initialScale: 1,
  // One locked size on mobile: no pinch/double-tap zoom, no input-focus
  // auto-zoom - the app always renders at device width like a native screen.
  // (Safari-the-browser can still accessibility-override pinch; the installed
  // PWA honors the lock fully. touch-action in globals.css kills double-tap.)
  maximumScale: 1,
  userScalable: false,
  // Draw edge-to-edge in standalone/notched iOS; safe-area insets are handled
  // where it matters (the mobile tab bar pads env(safe-area-inset-bottom)).
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /*
   * Clerk multi-domain: the satellite decision MUST be made server-side, per
   * request. ClerkJS's <script> tag is SSR-rendered with the provider's
   * config baked into data- attributes; a client-only window.location check
   * leaves the satellite with primary-domain config and
   * ClerkJS dies with "Missing domain and proxyUrl". Reading the Host header
   * makes routes render dynamically - acceptable: the landing page already
   * is, and everything else is an auth-gated client-data app.
   */
  const host = (await headers()).get("host") ?? "";
  const isSatellite = isSatelliteHost(host);
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable} ${plusJakarta.variable} ${anton.variable} ${ibmPlexMono.variable} h-full`}
    >
      {/* Same guard the html element already carries. Browser extensions
          write attributes onto body before React hydrates - `isolation:
          isolate` is a common one - and React then reports a mismatch for
          markup this app never rendered. */}
      <body className="min-h-full antialiased" suppressHydrationWarning>
        {/* No-flash theme: set data-theme before paint. Dark is the default;
            only a saved choice ("light"/"dark") overrides it. The toggle updates
            it at runtime. */}
        {/* Deploy-skew self-heal: with frequent deploys, an open tab's next
            navigation can request old chunk hashes that no longer exist
            (ChunkLoadError / failed dynamic import / React #310) and Chrome
            shows "This page couldn't load". Catch those failures and recover
            with ONE automatic reload (sessionStorage-guarded so it can never
            loop). Same pattern proven on the Overwatch app. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var K='pulse-heal-at';function heal(){try{var l=+sessionStorage.getItem(K)||0;if(Date.now()-l<30000)return;sessionStorage.setItem(K,String(Date.now()));location.reload();}catch(e){}}" +
              "addEventListener('error',function(e){var t=e.target;if(t&&(t.tagName==='SCRIPT'||t.tagName==='LINK')&&String(t.src||t.href||'').indexOf('/_next/')!==-1)heal();},true);" +
              "addEventListener('unhandledrejection',function(e){var m=String((e.reason&&e.reason.message)||e.reason||'');if(/ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed|Minified React error #310/.test(m))heal();});})();",
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('pulse-theme');document.documentElement.dataset.theme=(t==='light'||t==='dark')?t:'dark';}catch(e){document.documentElement.dataset.theme='dark';}})();",
          }}
        />
        {/* Tooltips live at the root, not just inside the app shell, so the
            public surfaces (booking, kiosk, portal) can label their icon
            controls too. */}
        <TooltipProvider delayDuration={300}>
          <ConvexClientProvider isSatellite={isSatellite}>
            {/* Turns pulse:// links into navigation inside the macOS/iOS app. A
                no-op in a browser (src/lib/shell.ts). */}
            <NativeShellBridge />
            {children}
          </ConvexClientProvider>
        </TooltipProvider>
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
