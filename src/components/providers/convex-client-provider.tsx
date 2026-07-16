"use client";

import { ReactNode, useCallback, useMemo } from "react";
import { ConvexReactClient, ConvexProvider, ConvexProviderWithAuth } from "convex/react";
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

/*
 * Multi-domain: studiopulse.tech is a Clerk SATELLITE of the primary
 * pulse.myindsound.com (see src/middleware.ts). ClerkJS only runs in the
 * browser, so the host check is safe behind a typeof-window guard; the
 * server render just passes the primary-domain defaults.
 */
const PRIMARY_ORIGIN = "https://pulse.myindsound.com";
const SATELLITE_DOMAIN = "studiopulse.tech";
const IS_SATELLITE =
  typeof window !== "undefined" &&
  (window.location.hostname === SATELLITE_DOMAIN ||
    window.location.hostname.endsWith(`.${SATELLITE_DOMAIN}`));
// The primary must allowlist the satellite for the post-sign-in return trip;
// harmless everywhere else.
const ALLOWED_REDIRECT_ORIGINS = [
  `https://${SATELLITE_DOMAIN}`,
  `https://www.${SATELLITE_DOMAIN}`,
];

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

export function ConvexClientProvider({ children }: { children: ReactNode }) {
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
        {...(IS_SATELLITE
          ? {
              isSatellite: true,
              domain: SATELLITE_DOMAIN,
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
