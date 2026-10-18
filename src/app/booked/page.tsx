import type { Metadata } from "next";
import { LandingNav } from "@/components/marketing/landing-nav";
import { Footer } from "@/components/marketing/footer";
import { BookedExperience } from "./booked-experience";

/* studiopulse.tech/booked: where a studio lands after booking a Pulse demo.

   The Zuops booking form cannot redirect, so the link rides in the Zuops
   confirmation text. The page shows the booking the way Pulse shows a client's
   booking, lets the studio pick what the demo should focus on (sent back by
   text to the same Zuops thread, so nothing is stored here), and plays the
   film while they wait. No personal data in the URL or on the page. */

export const metadata: Metadata = {
  title: "Your Pulse demo is booked",
  description: "Your 30-minute Pulse demo is confirmed. Tell us what to focus on, and watch one session, start to finish.",
  alternates: { canonical: "/booked" },
  robots: { index: false, follow: false },
};

export default function BookedPage() {
  return (
    <div className="theme-dark-island relative min-h-dvh overflow-x-hidden bg-ink text-bone">
      <LandingNav />
      <main className="px-4 pb-24 pt-32 sm:pt-36 lg:px-8">
        <BookedExperience />
      </main>
      <Footer />
    </div>
  );
}
