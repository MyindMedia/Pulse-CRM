"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { PulseLogo } from "@/components/brand/pulse-logo";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#workflow", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
];

// Clerk is only mounted when configured; in demo mode there is no provider, so
// the useUser hook would throw. Gate the auth-aware nav behind this flag.
const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

const ghostCls =
  "chrome-ghost inline-flex items-center rounded-chrome px-3.5 py-1.5 font-meta text-xs uppercase tracking-[0.04em] text-mist transition-colors hover:text-bone";
const goldCls =
  "chrome-ghost chrome-ghost-gold inline-flex items-center rounded-chrome px-3.5 py-1.5 font-meta text-xs uppercase tracking-[0.04em] text-gold transition-colors hover:text-gold-bright";

function LoggedOutCtas() {
  return (
    <>
      <Link href="/sign-in" className={ghostCls}>Log in</Link>
      <Link href="#pricing" className={goldCls}>Get started</Link>
    </>
  );
}

/** Auth-aware nav CTAs. Signed-in visitors get "Go to dashboard"; everyone else
 *  (including while Clerk is still loading) sees Log in / Get started. */
function AuthCtas() {
  const { isLoaded, isSignedIn } = useUser();
  if (isLoaded && isSignedIn) {
    return <Link href="/dashboard" className={goldCls}>Go to dashboard</Link>;
  }
  return <LoggedOutCtas />;
}

function Ctas() {
  return CLERK_ENABLED ? <AuthCtas /> : <LoggedOutCtas />;
}

export function LandingNav() {
  const [scrolled, setScrolled] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll while the mobile menu is open.
  React.useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        scrolled || menuOpen
          ? "material-regular border-b border-graphite/50"
          : "border-b border-transparent",
      )}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 lg:px-8">
        <PulseLogo size="sm" href="/" />

        <div className="hidden items-center gap-8 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="link-underline font-meta text-xs uppercase tracking-[0.04em] text-steel transition-colors hover:text-gold"
            >
              {l.label}
            </a>
          ))}
        </div>

        {/* Desktop CTAs */}
        <div className="hidden items-center gap-2 md:flex">
          <Ctas />
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="grid size-10 place-items-center rounded-chrome text-bone transition-colors hover:bg-graphite/40 md:hidden"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>

      {/* Mobile full-screen overlay */}
      {menuOpen && (
        <div className="fixed inset-0 top-16 z-40 flex flex-col bg-obsidian/98 px-6 py-8 backdrop-blur-sm md:hidden">
          <div className="flex flex-col gap-1">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className="chrome-display border-b border-graphite/50 py-4 text-3xl text-bone transition-colors hover:text-gold"
              >
                {l.label}
              </a>
            ))}
          </div>
          <div className="mt-8 flex items-center gap-3">
            <Ctas />
          </div>
        </div>
      )}
    </header>
  );
}
