import type { ReactNode } from "react";
import Link from "next/link";
import { PulseLogo } from "@/components/brand/pulse-logo";

/*
 * Shared chrome for the public legal pages (/privacy, /terms).
 *
 * These pages exist to satisfy A2P 10DLC / TCR campaign review as much as to
 * inform users: the reviewer visits them signed-out, so they MUST stay listed
 * in `isPublicRoute` in src/middleware.ts. A campaign was previously rejected
 * ("a compliant privacy policy can not be verified") because every candidate
 * URL 307'd to /sign-in.
 */

export const LEGAL_ENTITY = "Myind Media LLC";
export const LEGAL_ADDRESS = "835 Wilshire Blvd, Los Angeles, CA 90017, United States";
export const LEGAL_EMAIL = "info@myindmedia.org";
export const LEGAL_PHONE = "+1 (408) 410-0931";

export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-ink">
      <header className="border-b border-graphite/50 px-4 py-5 lg:px-8">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <PulseLogo size="md" href="/" />
          <Link
            href="/"
            className="link-underline font-grotesk text-sm text-mist/75 transition-colors hover:text-gold"
          >
            Back to site
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-14 lg:px-8">
        <p className="chrome-meta text-steel">Legal</p>
        <h1 className="mt-3 text-3xl font-semibold text-mist sm:text-4xl">{title}</h1>
        <p className="chrome-meta mt-3 text-steel/70">Last updated {updated}</p>

        <div className="mt-10 space-y-8">{children}</div>

        <div className="mt-14 border-t border-graphite/50 pt-6">
          <p className="font-grotesk text-sm text-mist/75">
            {LEGAL_ENTITY}
            <br />
            {LEGAL_ADDRESS}
            <br />
            <a href={`mailto:${LEGAL_EMAIL}`} className="text-gold hover:underline">
              {LEGAL_EMAIL}
            </a>
            {" · "}
            {LEGAL_PHONE}
          </p>
        </div>
      </main>
    </div>
  );
}

export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-mist">{heading}</h2>
      <div className="font-grotesk space-y-3 text-sm leading-relaxed text-mist/75">{children}</div>
    </section>
  );
}
