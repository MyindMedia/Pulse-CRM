import { SiteBackdrop } from "./site-backdrop";
import { LandingNav } from "./landing-nav";
import { Hero } from "./hero";
import { Chain } from "./chain";
import { Features } from "./features";
import { Pricing } from "./pricing";
import { FinalCta } from "./cta";
import { Footer } from "./footer";

/** The public Pulse marketing site, served at the root URL for logged-out
 *  visitors. (Signed-in users are redirected to /dashboard in page.tsx.)
 *  The wrapper is transparent so the fixed SiteBackdrop loop shows through
 *  every section. */
export function LandingPage() {
  return (
    <div className="relative min-h-dvh overflow-x-hidden text-bone">
      <SiteBackdrop />
      {/* Film-grain texture over the whole page for depth (reuses .grain). */}
      <div aria-hidden className="grain pointer-events-none fixed inset-0 -z-20" />
      <LandingNav />
      <main>
        <Hero />
        <Chain />
        <Features />
        <Pricing />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
