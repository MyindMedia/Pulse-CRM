"use client";

import * as React from "react";
import { useConvexAuth } from "convex/react";
import { Disc3 } from "lucide-react";

const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/* Holds the authenticated app tree until the Convex socket has actually
   authenticated. Without this, a fresh sign-in redirect (or the satellite
   handshake) mounts every page query a beat before the token attaches -
   dozens of UNAUTHENTICATED throws hit the error boundary at once and the
   user lands on "Pulse hit a snag". One gate here beats teaching every
   query to tolerate the race.

   Only the FIRST authentication is gated: once the session has attached,
   later token refreshes/org switches never unmount the app. Demo mode
   (no Clerk key) renders straight through. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const [ready, setReady] = React.useState(!CLERK_ENABLED);

  React.useEffect(() => {
    if (isAuthenticated) setReady(true);
  }, [isAuthenticated]);

  if (!ready && (isLoading || !isAuthenticated)) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink">
        <div className="flex flex-col items-center gap-3">
          <Disc3 className="size-8 animate-spin text-gold" aria-hidden />
          <p className="font-meta text-xs uppercase tracking-[0.2em] text-steel/70">
            Opening your studio
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
