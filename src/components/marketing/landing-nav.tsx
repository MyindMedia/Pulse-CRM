"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { PulseLogo } from "@/components/brand/pulse-logo";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#workflow", label: "How it works" },
  { href: "#contact", label: "Contact" },
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
      <Link href="#contact" className={goldCls}>Get started</Link>
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
    <>
    <header
      className={cn(
        "theme-dark-island fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        scrolled || menuOpen
          ? "border-b border-graphite/50 bg-obsidian/92 backdrop-blur-xl"
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
          <ThemeToggle />
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
    </header>

    {/* Mobile full-screen menu, rendered in a PORTAL on document.body.
        Why a portal: the marketing site runs Lenis smooth-scroll and pins the
        hero with GSAP, and the header carries a `backdrop-filter`. Any of those
        can establish a containing block / transformed ancestor, which made an
        in-tree `position: fixed` overlay (a) collapse with no background and
        (b) scroll away with the page. Portaling to <body> escapes every
        ancestor stacking + containing-block context, so the overlay is always
        a true viewport-fixed sheet. The background is an inline solid colour
        (not a theme token) so it can never resolve to transparent or a light
        value, and `theme-dark-island` keeps the link/CTA tokens light on the
        dark sheet in both light and dark mode. It owns its own close button
        since it sits above the header. `overscroll-contain` stops scroll
        chaining to the page underneath. */}
    {menuOpen &&
      typeof document !== "undefined" &&
      createPortal(
        <div
          data-lenis-prevent
          className="theme-dark-island fixed inset-0 z-[100] flex flex-col overflow-y-auto overscroll-contain px-6 pb-12 pt-4 backdrop-blur-2xl md:hidden"
          style={{ backgroundColor: "rgba(9,9,11,0.985)" }}
        >
          <div className="flex h-12 shrink-0 items-center justify-between">
            <PulseLogo size="sm" href="/" />
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="grid size-10 place-items-center rounded-chrome text-bone transition-colors hover:bg-graphite/40"
              aria-label="Close menu"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="mt-6 flex flex-col gap-1">
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
            <ThemeToggle />
            <Ctas />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
