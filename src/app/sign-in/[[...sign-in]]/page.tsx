"use client";

import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { PulseLogo } from "@/components/brand/pulse-logo";

const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/* Studio owners sign in here once Clerk is configured. With no Clerk key
   the app runs in demo mode and no sign-in is required. */
export default function SignInPage() {
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
          <SignIn
            appearance={clerkAppearance}
            signUpUrl="/sign-up"
            fallbackRedirectUrl="/dashboard"
          />
        ) : (
          <div className="space-y-3 text-center">
            <p className="overline">Pulse · demo mode</p>
            <h1 className="font-display text-2xl font-bold text-bone">No sign-in required</h1>
            <p className="text-sm text-ash">
              Clerk is not configured, so Pulse is running in demo mode. Add your Clerk keys to
              enable real studio logins - see CLERK-SETUP.md.
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
