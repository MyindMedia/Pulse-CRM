import { redirect } from "next/navigation";
import { LandingPage } from "@/components/marketing/landing-page";

/* The root URL is the public Pulse marketing site. Signed-in studio owners are
   sent straight to their dashboard; everyone else (and demo mode, where Clerk
   is not configured) sees the landing page. `/` is a public route in
   middleware, so nothing here is auth-gated. */
const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default async function Home() {
  if (CLERK_ENABLED) {
    const { auth } = await import("@clerk/nextjs/server");
    const { userId } = await auth();
    if (userId) redirect("/dashboard");
  }
  return <LandingPage />;
}
