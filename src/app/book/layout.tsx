"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Disc3 } from "lucide-react";

/**
 * Public booking chrome — NO app sidebar. A slim wordmark bar and a
 * minimal footer. The root layout already provides Convex + fonts + Toaster.
 */
export default function BookLayout({ children }: { children: React.ReactNode }) {
  const front = useQuery(api.booking.studioFront, {});
  const studioName = front?.org.name ?? "Pulse";

  return (
    <div className="grain relative flex min-h-dvh flex-col bg-ink text-bone">
      {/* ambient gold wash */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgba(253,185,19,0.10),transparent_70%)]"
      />

      <header className="relative z-10 border-b border-hairline bg-ink-2/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 lg:px-8">
          <Link href="/book" className="group flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-md bg-gold text-gold-ink shadow-[0_1px_0_0_rgba(255,255,255,.25)_inset]">
              <Disc3 className="size-5" />
            </span>
            <span className="flex flex-col leading-none">
              <span className="font-display text-sm font-semibold tracking-tight text-bone group-hover:text-gold-bright">
                {studioName}
              </span>
              <span className="overline mt-0.5">Studio booking</span>
            </span>
          </Link>
          <span className="hidden text-xs text-ash-dim sm:block">
            Secured by Pulse
          </span>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 py-8 lg:px-8 lg:py-12">
        {children}
      </main>

      <footer className="relative z-10 border-t border-hairline bg-ink-2/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-ash-dim sm:flex-row lg:px-8">
          <span>
            Powered by <span className="font-medium text-ash">Pulse</span> — the
            operating system for music businesses.
          </span>
          <span>{new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}
