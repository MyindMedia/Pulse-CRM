"use client";

import * as React from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { PulseLogo } from "@/components/brand/pulse-logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#workflow", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
];

// Clerk is only mounted when configured; in demo mode there is no provider, so
// the useUser hook would throw. Gate the auth-aware nav behind this flag.
const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function LoggedOutCtas() {
  return (
    <>
      <Button asChild variant="ghost" size="sm">
        <Link href="/sign-in">Log in</Link>
      </Button>
      <Button asChild size="sm">
        <Link href="/sign-up">Get started</Link>
      </Button>
    </>
  );
}

/** Auth-aware nav CTAs. Signed-in visitors get "Go to dashboard"; everyone else
 *  (including while Clerk is still loading) sees Log in / Get started. Only
 *  rendered when Clerk is configured, so the useUser hook always has a provider. */
function AuthNav() {
  const { isLoaded, isSignedIn } = useUser();
  if (isLoaded && isSignedIn) {
    return (
      <Button asChild size="sm">
        <Link href="/dashboard">Go to dashboard</Link>
      </Button>
    );
  }
  return <LoggedOutCtas />;
}

/** Sticky landing-page header. Transparent over the hero, frosts into glass
 *  once the page scrolls. Logo left; nav anchors center (desktop); Log in +
 *  Get started top-right. */
export function LandingNav() {
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        scrolled ? "material-regular border-b border-hairline" : "border-b border-transparent",
      )}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 lg:px-8">
        <PulseLogo size="sm" href="/" />

        <div className="hidden items-center gap-8 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-ash transition-colors hover:text-bone"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {CLERK_ENABLED ? <AuthNav /> : <LoggedOutCtas />}
        </div>
      </nav>
    </header>
  );
}
