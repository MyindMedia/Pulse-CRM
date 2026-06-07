import { LandingPage } from "@/components/marketing/landing-page";

/* The root URL is the public Pulse marketing site, shown to everyone (signed in
   or out). Signed-in visitors get a "Go to dashboard" link in the nav rather
   than an auto-redirect. `/` is a public route in middleware, so nothing here
   is auth-gated. */
export default function Home() {
  return <LandingPage />;
}
