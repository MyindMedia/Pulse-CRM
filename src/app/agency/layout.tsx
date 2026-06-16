"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ArrowUpLeft, ShieldAlert } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingPanel } from "@/components/ui/feedback";
import { PulseLogo } from "@/components/brand/pulse-logo";
import { AgencyProfileMenu } from "@/components/agency/agency-profile-menu";

/* The Pulse Agency wordmark - the real brand lockup + the console label. */
function AgencyWordmark() {
  return (
    <Link href="/agency" className="flex items-center gap-3">
      <PulseLogo size="sm" asLink={false} />
      <span className="flex flex-col gap-0.5 border-l border-graphite/60 pl-3 leading-none">
        <span className="font-grotesk text-sm font-bold tracking-tight text-bone">Agency</span>
        <span className="font-meta text-[0.5625rem] uppercase tracking-[0.22em] text-steel/70">
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
        {/* Slim console top bar - distinct from the studio chrome, no sidebar. */}
        <header className="sticky top-0 z-30 border-b border-graphite/50 bg-obsidian/90 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 lg:px-8">
            <AgencyWordmark />
            <nav className="hidden items-center gap-4 text-xs font-medium text-steel sm:flex">
              <Link href="/agency" className="hover:text-bone">Sub-accounts</Link>
              <Link href="/agency/plans" className="hover:text-bone">Plans</Link>
              <Link href="/agency/agents" className="hover:text-bone">Agents</Link>
              <Link href="/agency/autopilot" className="hover:text-bone">Autopilot</Link>
              <Link href="/agency/staff" className="hover:text-bone">Staff</Link>
              <Link href="/agency/branding" className="hover:text-bone">Branding</Link>
              <Link href="/agency/audit" className="hover:text-bone">Audit</Link>
              <Link href="/agency/settings" className="hover:text-bone">Settings</Link>
            </nav>
            <div className="ml-auto flex items-center gap-2">
              {access?.demo && (
                <span className="hidden rounded-sm border border-graphite/60 bg-coal-2 px-2 py-0.5 font-meta text-[0.625rem] uppercase tracking-wide text-steel/70 sm:inline-block">
                  Demo mode
                </span>
              )}
              <AgencyProfileMenu />
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
                    <p className="font-grotesk text-base font-semibold text-bone">
                      You do not have agency access
                    </p>
                    <p className="mx-auto max-w-xs text-sm text-steel">
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
