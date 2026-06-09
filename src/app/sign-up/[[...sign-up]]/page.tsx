"use client";

import Link from "next/link";
import { PulseLogo } from "@/components/brand/pulse-logo";

const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/* New studio owners accept their agency invite and set a password here.
   Open sign-up is disabled - Pulse is invite-only during private beta. */
export default function SignUpPage() {
  return (
    <div className="relative grid min-h-dvh place-items-center bg-ink p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(60% 40% at 50% 30%, rgba(253,185,19,0.08), transparent 70%)",
        }}
      />
      <div className="relative flex w-full max-w-md flex-col items-center gap-6">
        <PulseLogo size="lg" asLink={false} />
        {CLERK_ENABLED ? (
          <div className="space-y-3 text-center">
            <p className="overline">Pulse · private beta</p>
            <h1 className="font-grotesk text-2xl font-bold text-bone">Invitation required</h1>
            <p className="text-sm text-steel">Pulse is in private beta. New studios join from an emailed invitation. If you have one, open the link in that email.</p>
            <Link href="/sign-in" className="inline-block text-sm font-medium text-gold hover:underline">Already have an account? Sign in</Link>
          </div>
        ) : (
          <div className="space-y-3 text-center">
            <p className="overline">Pulse · demo mode</p>
            <h1 className="font-grotesk text-2xl font-bold text-bone">No sign-up required</h1>
            <p className="text-sm text-steel">
              Clerk is not configured. Add your Clerk keys to enable studio accounts - see
              CLERK-SETUP.md.
            </p>
            <Link
              href="/dashboard"
              className="inline-block text-sm font-medium text-gold hover:underline"
            >
              Continue to the dashboard
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
