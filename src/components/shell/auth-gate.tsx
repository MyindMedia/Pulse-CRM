"use client";

import * as React from "react";
import { useConvexAuth } from "convex/react";
import { BootShell } from "@/components/shell/boot-shell";

const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/* Holds the authenticated app tree until the Convex socket has actually
   authenticated. Without this, a fresh sign-in redirect (or the satellite
   handshake) mounts every page query a beat before the token attaches -
   dozens of UNAUTHENTICATED throws hit the error boundary at once and the
   user lands on "Pulse hit a snag". One gate here beats teaching every
   query to tolerate the race.

   Only the FIRST authentication is gated: once the session has attached,
   later token refreshes/org switches never unmount the app. Demo mode
   (no Clerk key) renders straight through - and must not call useConvexAuth
   at all, because that tree is wrapped in a plain ConvexProvider with no auth
   context and the hook throws "Could not find ConvexProviderWithAuth". The
   split below keeps the hook inside a child that only mounts under Clerk;
   CLERK_ENABLED is a build-time constant, so the branch never flips at
   runtime and hook order stays stable.

   While it holds, the boot preview shows (src/components/shell/boot-shell.tsx)
   rather than a blank logo screen. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  if (!CLERK_ENABLED) return <>{children}</>;
  return <ClerkAuthGate>{children}</ClerkAuthGate>;
}

function ClerkAuthGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (isAuthenticated) setReady(true);
  }, [isAuthenticated]);

  if (!ready && (isLoading || !isAuthenticated)) {
    // Optimistic: the chassis, the studio's cached colors and the last
    // dashboard this person saw, all inert, while the session is confirmed.
    // The middleware already refused this request unless Clerk's session
    // cookie verified, and no write can start from the inert preview.
    return <BootShell />;
  }
  return <>{children}</>;
}
