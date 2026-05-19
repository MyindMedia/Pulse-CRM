"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ArrowUpLeft, ShieldAlert } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingPanel } from "@/components/ui/feedback";

/* The Pulse Agency wordmark — a command-center variant of the studio mark. */
function AgencyWordmark() {
  return (
    <Link href="/agency" className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-md border border-gold-dim/60 bg-gold/10 text-gold">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M2 12h4l3-8 6 16 3-8h4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-display text-base font-bold tracking-tight text-bone">Pulse Agency</span>
        <span className="font-mono text-[0.5625rem] uppercase tracking-[0.22em] text-ash-dim">
          Command center
        </span>
      </span>
    </Link>
  );
}

export default function AgencyLayout({ children }: { children: React.ReactNode }) {
  const access = useQuery(api.agency.access);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-dvh bg-ink">
        {/* Slim console top bar — distinct from the studio chrome, no sidebar. */}
        <header className="sticky top-0 z-30 border-b border-hairline bg-ink-2/90 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 lg:px-8">
            <AgencyWordmark />
            <div className="ml-auto flex items-center gap-2">
              {access?.demo && (
                <span className="hidden rounded-sm border border-hairline-2 bg-coal-2 px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim sm:inline-block">
                  Demo mode
                </span>
              )}
              <Link
                href="/dashboard"
                className="flex h-8 items-center gap-1.5 rounded-md border border-hairline-2 bg-coal/60 px-3 text-xs font-medium text-ash transition-colors hover:border-gold-dim hover:text-bone"
              >
                <ArrowUpLeft className="size-3.5" />
                Back to studio app
              </Link>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-8 lg:px-8 lg:py-10">
          {access === undefined ? (
            <LoadingPanel label="Checking agency access" />
          ) : access.allowed ? (
            children
          ) : (
            <div className="flex min-h-[50vh] items-center justify-center">
              <Card className="max-w-md">
                <CardContent className="flex flex-col items-center gap-3 px-8 py-12 text-center">
                  <span className="grid size-12 place-items-center rounded-lg bg-critical/10 text-critical">
                    <ShieldAlert className="size-6" />
                  </span>
                  <div className="space-y-1">
                    <p className="font-display text-base font-semibold text-bone">
                      You do not have agency access
                    </p>
                    <p className="mx-auto max-w-xs text-sm text-ash">
                      This console is limited to agency administrators. Ask an owner to add your
                      email to the agency allowlist.
                    </p>
                  </div>
                  <Link
                    href="/dashboard"
                    className="mt-1 flex h-9 items-center gap-1.5 rounded-md bg-gold px-4 text-sm font-semibold text-gold-ink transition-colors hover:bg-gold-bright"
                  >
                    <ArrowUpLeft className="size-4" />
                    Return to studio app
                  </Link>
                </CardContent>
              </Card>
            </div>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
