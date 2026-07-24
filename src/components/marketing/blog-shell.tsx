import * as React from "react";
import Link from "next/link";
import { SiteBackdrop } from "./site-backdrop";
import { LandingNav } from "./landing-nav";
import { Footer } from "./footer";

/* Shared chrome for /blog and /blog/[slug]: the same backdrop / nav / footer as
   the marketing site, wrapping a centered reading column. Server component -
   no client JS needed for static SEO posts. */

export function BlogShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-x-hidden text-bone">
      <SiteBackdrop />
      <div aria-hidden className="grain pointer-events-none fixed inset-0 -z-20" />
      <LandingNav />
      <main className="mx-auto w-full max-w-3xl px-5 pb-24 pt-32 sm:px-6 sm:pt-36">{children}</main>
      <Footer />
    </div>
  );
}

/* ── Prose primitives ─────────────────────────────────────────────────────
   Post bodies compose these instead of raw tags so every cornerstone post
   inherits one consistent, on-brand reading style. */

export function Prose({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6 text-[1.02rem] leading-relaxed text-mist">{children}</div>;
}

export function Lead({ children }: { children: React.ReactNode }) {
  return <p className="text-lg leading-relaxed text-bone">{children}</p>;
}

export function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2
      id={id}
      className="scroll-mt-28 pt-4 font-grotesk text-2xl font-semibold tracking-[-0.01em] text-bone"
    >
      {children}
    </h2>
  );
}

export function H3({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h3 id={id} className="scroll-mt-28 pt-2 font-grotesk text-lg font-semibold text-bone">
      {children}
    </h3>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-gold">{children}</ul>;
}

export function OL({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-2 pl-5 marker:text-gold">{children}</ol>;
}

export function LI({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>;
}

export function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-bone">{children}</strong>;
}

export function A({ href, children }: { href: string; children: React.ReactNode }) {
  const external = /^https?:\/\//.test(href);
  const cls = "text-gold underline-offset-4 hover:text-gold-bright hover:underline";
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-chrome border border-gold/25 bg-coal/40 p-5 text-mist">{children}</div>
  );
}
