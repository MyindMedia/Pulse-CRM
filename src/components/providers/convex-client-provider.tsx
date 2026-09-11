"use client";

import { ReactNode, useCallback, useMemo } from "react";
import { ConvexReactClient, ConvexProvider, ConvexProviderWithAuth } from "convex/react";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { resolveConvexUrl } from "@/lib/convex-url";

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

import {
  PRIMARY_ORIGIN,
  SATELLITE_PROXY_URL,
  ALLOWED_REDIRECT_ORIGINS,
} from "@/lib/clerk-domains";

const CLERK_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/*
 * Multi-domain. The primary/satellite pair lives in src/lib/clerk-domains.ts;
 * the satellite decision itself comes in as a PROP from the root layout
 * (request Host header) because it must be known during SSR - ClerkJS's script
 * tag is server-rendered with this config baked in, and a window check here
 * would hydrate too late.
 */

/* The Convex deployment URL. See src/lib/convex-url.ts for why the fallback
 * exists and why it lives in one shared place. */
const CONVEX_URL = resolveConvexUrl();

function MissingConvex() {
  return (
    <div className="grid min-h-dvh place-items-center bg-ink p-8 text-center">
      <div className="max-w-md space-y-3">
        <p className="overline">Pulse · setup</p>
        <h1 className="font-grotesk text-2xl font-bold text-bone">Connect Convex to continue</h1>
        <p className="text-sm text-steel">
          Run <code className="rounded bg-coal-2 px-1.5 py-0.5 font-meta text-gold">npx convex dev</code> in the
          project root. It provisions a deployment and writes{" "}
          <code className="font-meta text-steel/70">NEXT_PUBLIC_CONVEX_URL</code> automatically.
        </p>
      </div>
    </div>
  );
}

export function ConvexClientProvider({
  children,
  isSatellite = false,
}: {
  children: ReactNode;
  isSatellite?: boolean;
}) {
  const convex = useMemo(
    () => (CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null),
    [],
  );

  if (!convex) return <MissingConvex />;

  if (CLERK_KEY) {
    return (
      <ClerkProvider
        publishableKey={CLERK_KEY}
        appearance={clerkAppearance}
        allowedRedirectOrigins={ALLOWED_REDIRECT_ORIGINS}
        {...(isSatellite
          ? {
              isSatellite: true,
              proxyUrl: SATELLITE_PROXY_URL,
              signInUrl: `${PRIMARY_ORIGIN}/sign-in`,
              signUpUrl: `${PRIMARY_ORIGIN}/sign-up`,
            }
          : {})}
      >
        <ConvexProviderWithAuth client={convex} useAuth={useClerkSessionTokenAuth}>
          {children}
        </ConvexProviderWithAuth>
      </ClerkProvider>
    );
  }

  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}

/*
 * Convex auth via the PLAIN Clerk session token. This instance has NO "convex"
 * JWT template - the session token itself carries `aud: "convex"` (dashboard
 * session-token customization), which is what convex/auth.config.ts trusts.
 * The stock ConvexProviderWithClerk branches on `sessionClaims.aud`: one bad
 * read (mid token-rotation, stale client) sends it down the nonexistent
 * template path, the 404 is swallowed, it hands Convex `null`, and EVERY query
 * throws UNAUTHENTICATED until a full re-auth - the "dashboard isn't loading"
 * storms of 2026-07-07/08. Fetching the session token directly removes that
 * branch entirely.
 */
function useClerkSessionTokenAuth() {
  const { isLoaded, isSignedIn, getToken, orgId, userId } = useAuth();

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      try {
        return await getToken({ skipCache: forceRefreshToken });
      } catch {
        return null;
      }
    },
    // Rebuild (-> Convex re-auths) when the signed-in user or active org
    // changes; Clerk's getToken reference itself is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getToken, orgId, userId],
  );

  return useMemo(
    () => ({
      isLoading: !isLoaded,
      isAuthenticated: Boolean(isSignedIn),
      fetchAccessToken,
    }),
    [isLoaded, isSignedIn, fetchAccessToken],
  );
}
