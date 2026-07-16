import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/*
 * Clerk middleware - only enforced when Clerk is configured.
 * In demo mode (no publishable key) requests pass straight through so the
 * app is fully explorable against seeded data.
 */

const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/*
 * Multi-domain: studiopulse.tech is a Clerk SATELLITE of the primary
 * pulse.myindsound.com (different eTLD+1, so the session cookie cannot be
 * shared - Clerk's satellite handshake bridges it). Sign-in itself can only
 * happen on the primary; satellite visitors bounce there and return signed in.
 */
const PRIMARY_ORIGIN = "https://pulse.myindsound.com";
const SATELLITE_DOMAIN = "studiopulse.tech";

function isSatelliteHost(hostname: string): boolean {
  return hostname === SATELLITE_DOMAIN || hostname.endsWith(`.${SATELLITE_DOMAIN}`);
}

const isPublicRoute = createRouteMatcher([
  "/",
  "/opengraph-image(.*)", // social share card - must be scrapeable
  "/twitter-image(.*)", // social share card - must be scrapeable
  "/welcome/activate(.*)", // pay-first signup: reached before the account exists
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  // NOTE: these matchers need the explicit "/" before "(.*)" - a bare
  // "/book(.*)" also matches sibling APP routes (/bookings, /payments,
  // /visitors), silently exempting them from the sign-in redirect.
  "/book", // public studio booking (demo front) - no login
  "/book/(.*)", // public studio booking by slug - no login
  "/pay/(.*)", // public invoice payment link - no login
  "/invite(.*)", // beta invite account-creation screen - no auth required
  "/portal(.*)", // client concierge magic-link portal - token-authed, no login
  "/sign(.*)", // split-sheet e-signature magic-link - token-authed, no login
  "/visit/(.*)", // visitor QR self check-in - org derived from the slug, no login
]);

const handler = CLERK_ENABLED
  ? clerkMiddleware(
      async (auth, req) => {
        if (isSatelliteHost(req.nextUrl.hostname)) {
          // Satellites cannot host Clerk auth flows - forward /sign-in and
          // /sign-up to the primary, keeping the way back to this host.
          const path = req.nextUrl.pathname;
          if (path.startsWith("/sign-in") || path.startsWith("/sign-up")) {
            const target = new URL(
              path.startsWith("/sign-up") ? "/sign-up" : "/sign-in",
              PRIMARY_ORIGIN,
            );
            const back =
              req.nextUrl.searchParams.get("redirect_url") ??
              new URL("/dashboard", req.nextUrl.origin).toString();
            target.searchParams.set("redirect_url", back);
            return NextResponse.redirect(target);
          }
          if (!isPublicRoute(req)) {
            // Default protect(): with the satellite options below, Clerk
            // runs its cross-domain handshake against the primary's signInUrl
            // and returns the visitor here signed in.
            await auth.protect();
          }
          return;
        }
        if (!isPublicRoute(req)) {
          // Send unauthenticated traffic to OUR /sign-in (same origin), not the
          // Clerk-hosted accounts.dev page. Client-side RSC/prefetch fetches that
          // hit an expired session used to get 307'd cross-origin and die as
          // CORS errors in the console; a same-origin redirect resolves cleanly
          // and keeps the return path via redirect_url.
          const signIn = new URL("/sign-in", req.url);
          signIn.searchParams.set("redirect_url", req.url);
          await auth.protect({ unauthenticatedUrl: signIn.toString() });
        }
      },
      (req) =>
        isSatelliteHost(req.nextUrl.hostname)
          ? {
              isSatellite: true,
              domain: SATELLITE_DOMAIN,
              signInUrl: `${PRIMARY_ORIGIN}/sign-in`,
              signUpUrl: `${PRIMARY_ORIGIN}/sign-up`,
            }
          : {},
    )
  : () => NextResponse.next();

export default handler;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm|mov|m4v|mp3|wav|ogg)).*)",
    "/(api|trpc)(.*)",
  ],
};
