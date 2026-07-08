"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ShieldAlert, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Error boundary for the whole authenticated app shell. Without this, a single
 * thrown Convex query (e.g. an access denial that isn't handled gracefully)
 * blanks the entire route with a white screen - exactly what happened on the
 * Bookings page. This catches it and shows a recoverable, on-brand panel with a
 * retry instead, so one bad query can never take down the page.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] route error:", error);
  }, [error]);

  // A stale/wedged Clerk client can leave the Convex socket unauthenticated -
  // every query then throws UNAUTHENTICATED and retrying can't help. The only
  // real remedy is a fresh sign-in, so say that instead of "try again".
  const isAuthError = /UNAUTHENTICATED|Sign in required/i.test(error.message);

  return (
    <div className="grid min-h-[60dvh] place-items-center px-4">
      <div className="max-w-md space-y-5 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-chrome border border-graphite/60 bg-coal-2 text-warning">
          <ShieldAlert className="size-5" />
        </span>
        <div className="space-y-2">
          <h1 className="font-grotesk text-xl font-bold tracking-tight text-bone">
            {isAuthError ? "Your session needs a refresh" : "This view hit a snag"}
          </h1>
          <p className="text-sm text-steel">
            {isAuthError
              ? "Pulse could not authenticate this browser session. Sign in again and you'll be right back where you were."
              : "Something failed while loading this page. It is usually transient - try again, or head back to your dashboard."}
          </p>
        </div>
        <div className="flex items-center justify-center gap-2">
          {isAuthError ? (
            <Button
              size="sm"
              onClick={() => {
                // Hard navigation on purpose: a full page load re-runs the
                // Clerk handshake and clears the wedged in-memory client.
                window.location.href = "/sign-in";
              }}
            >
              Sign in again
            </Button>
          ) : (
            <Button size="sm" onClick={() => reset()}>
              <RotateCcw className="size-3.5" />
              Try again
            </Button>
          )}
          <Button asChild size="sm" variant="secondary">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
