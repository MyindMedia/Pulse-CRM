"use client";

import { ReactNode, useMemo } from "react";
import { ConvexReactClient, ConvexProvider } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-appearance";

/*
 * Pulse boots in two modes so it runs whether or not Clerk is configured yet:
 *
 *  - AUTH MODE   - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY present → real Clerk auth,
 *                  multi-tenant organizations, ConvexProviderWithClerk.
 *  - DEMO MODE   - no Clerk key → plain ConvexProvider. Convex `requireOrg`
 *                  falls back to the seeded "pulse-demo" workspace.
 *
 * Either way you only need `npx convex dev` to see the app come alive.
 */

const CLERK_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/* The Convex deployment URL. `NEXT_PUBLIC_CONVEX_URL` (written by
 * `npx convex dev` locally) takes precedence; when it is absent - e.g. a
 * hosting environment where the build var was not configured - we fall back
 * to the production deployment. A Convex URL is public by design. */
const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://pastel-corgi-340.convex.cloud";

function MissingConvex() {
  return (
    <div className="grid min-h-dvh place-items-center bg-ink p-8 text-center">
      <div className="max-w-md space-y-3">
        <p className="overline">Pulse · setup</p>
        <h1 className="font-display text-2xl font-bold text-bone">Connect Convex to continue</h1>
        <p className="text-sm text-ash">
          Run <code className="rounded bg-coal-2 px-1.5 py-0.5 font-mono text-gold">npx convex dev</code> in the
          project root. It provisions a deployment and writes{" "}
          <code className="font-mono text-ash-dim">NEXT_PUBLIC_CONVEX_URL</code> automatically.
        </p>
      </div>
    </div>
  );
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const convex = useMemo(
    () => (CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null),
    [],
  );

  if (!convex) return <MissingConvex />;

  if (CLERK_KEY) {
    return (
      <ClerkProvider publishableKey={CLERK_KEY} appearance={clerkAppearance}>
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
          {children}
        </ConvexProviderWithClerk>
      </ClerkProvider>
    );
  }

  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
