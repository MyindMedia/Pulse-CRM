"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ShieldAlert, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Error boundary for the whole /agency console. A thrown Convex query (e.g. an
 * access denial that isn't handled gracefully) used to blank the route with the
 * browser's "page couldn't load". This catches it and shows a recoverable,
 * on-brand panel with a retry instead.
 */
export default function AgencyError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[agency] route error:", error);
  }, [error]);

  return (
    <div className="grid min-h-[60dvh] place-items-center px-4">
      <div className="max-w-md space-y-5 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-xl border border-hairline-2 bg-coal-2 text-warning">
          <ShieldAlert className="size-5" />
        </span>
        <div className="space-y-2">
          <h1 className="font-display text-xl font-bold tracking-tight text-bone">
            This view hit a snag
          </h1>
          <p className="text-sm text-ash">
            Something failed while loading this part of the console. It is usually
            transient - try again, or head back to your studios.
          </p>
        </div>
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" onClick={() => reset()}>
            <RotateCcw className="size-3.5" />
            Try again
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link href="/agency">Back to studios</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
