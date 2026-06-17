import { SmoothScroll } from "./smooth-scroll";
import { SiteReveal } from "./site-reveal";
import { SiteBackdrop } from "./site-backdrop";
import { LandingNav } from "./landing-nav";
import { Hero } from "./hero";
import { Chain } from "./chain";
import { Features } from "./features";
import { WorkSection } from "./work-section";
import { LogoMarquee } from "./logo-marquee";
// Pricing is hidden for now - kept in the repo (./pricing) to restore later.
import { Contact } from "./contact";
import { Faq } from "./faq";
import { FinalCta } from "./cta";
import { Footer } from "./footer";

/** The public Pulse marketing site, served at the root URL for logged-out
 *  visitors. (Signed-in users are redirected to /dashboard in page.tsx.)
 *  The wrapper is transparent so the fixed SiteBackdrop loop shows through
 *  every section. */
export function LandingPage() {
  return (
    <div className="relative min-h-dvh overflow-x-hidden text-bone">
      <SmoothScroll />
      <SiteReveal />
      <SiteBackdrop />
      {/* Film-grain texture over the whole page for depth (reuses .grain). */}
      <div aria-hidden className="grain pointer-events-none fixed inset-0 -z-20" />
      <LandingNav />
      <main>
        <Hero />
        <Chain />
        <Features />
        <WorkSection />
        <LogoMarquee />
        <Contact />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
