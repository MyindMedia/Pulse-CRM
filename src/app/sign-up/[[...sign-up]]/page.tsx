"use client";

import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-appearance";

const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/* New studio owners accept their agency invite and set a password here. */
export default function SignUpPage() {
  return (
    <div className="grid min-h-dvh place-items-center bg-ink p-6">
      {CLERK_ENABLED ? (
        <SignUp appearance={clerkAppearance} signInUrl="/sign-in" fallbackRedirectUrl="/dashboard" />
      ) : (
        <div className="max-w-md space-y-3 text-center">
          <p className="overline">Pulse · demo mode</p>
          <h1 className="font-display text-2xl font-bold text-bone">No sign-up required</h1>
          <p className="text-sm text-ash">
            Clerk is not configured. Add your Clerk keys to enable studio accounts — see
            CLERK-SETUP.md.
          </p>
          <Link href="/dashboard" className="inline-block text-sm font-medium text-gold hover:underline">
            Continue to the dashboard
          </Link>
        </div>
      )}
    </div>
  );
}
